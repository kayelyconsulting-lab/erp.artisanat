#!/usr/bin/env node
// Serveur KAYELY GESTION PRO : sert l'application et vérifie côté serveur
// l'authentification, les droits par rôle et CHAQUE donnée enregistrée.
//
//   node serveur/server.mjs            (variables : PORT, HOST, KGP_DB_FILE, KGP_APP_FILE)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema } from "./schema.mjs";
import { validateRecord, ValidationError } from "./validation.mjs";
import { openDatabase } from "./db.mjs";
import {
  hashPassword, verifyPassword, DUMMY_HASH, passwordProblem, LEGACY_DEFAULT_PASSWORDS,
  newToken, tokenHash, createLoginLimiter,
} from "./auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COOKIE = "kgp_session";
const IDLE_MS = 12 * 3600 * 1000;      // déconnexion après 12 h d'inactivité
const ABSOLUTE_MS = 7 * 24 * 3600 * 1000;
const MAX_BODY = 8 * 1024 * 1024;
const ADMIN = "Administrateur", GERANT = "Gérant";

class HttpError extends Error { constructor(status, message){ super(message); this.status = status; } }

export function createApp({ appFile = path.join(ROOT, "kgpro.html"), dbFile = ":memory:" } = {}){
  const schema = loadSchema(appFile);
  const db = openDatabase(dbFile);
  const limiter = createLoginLimiter();
  const appHtml = () => fs.readFileSync(appFile, "utf8")
    .replace("<head>", "<head>\n<script>window.KGP_SERVER = true;</script>");

  /* ---------- utilisateurs ---------- */
  const publicUser = u => { if (!u) return null; const { motDePasseHash, ...rest } = u; return { ...rest, motDePasse: "" }; };
  const isExpired = u => {
    if (!u.dateExpiration) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return new Date(u.dateExpiration + "T00:00:00") < today;
  };
  const isActive = u => u && (u.statut || "Actif") === "Actif" && !isExpired(u);
  const findByLogin = login => db.all("utilisateurs")
    .find(u => (u.login || "").toLowerCase() === String(login || "").trim().toLowerCase());

  /* ---------- sessions ---------- */
  function readCookie(req){
    const m = (req.headers.cookie || "").split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
    return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
  }
  const isHttps = req => req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
  function setSessionCookie(req, res, token, maxAgeSec){
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${isHttps(req) ? "; Secure" : ""}`);
  }
  function startSession(req, res, user){
    const token = newToken();
    db.sessions.create(tokenHash(token), user.id);
    setSessionCookie(req, res, token, ABSOLUTE_MS / 1000);
  }
  function currentSession(req){
    const token = readCookie(req);
    if (!token) return null;
    const hash = tokenHash(token);
    const s = db.sessions.get(hash);
    const now = Date.now();
    if (!s || now - s.last_seen > IDLE_MS || now - s.created_at > ABSOLUTE_MS){ if (s) db.sessions.delete(hash); return null; }
    const user = db.get("utilisateurs", s.user_id);
    if (!isActive(user)){ db.sessions.delete(hash); return null; }
    db.sessions.touch(hash);
    return { hash, user };
  }
  function requireUser(req){
    const s = currentSession(req);
    if (!s) throw new HttpError(401, "Session expirée : reconnectez-vous.");
    if (s.user.doitChangerMotDePasse && !req.url.startsWith("/api/password") && !req.url.startsWith("/api/logout") && !req.url.startsWith("/api/me")){
      throw new HttpError(403, "Changez d'abord votre code secret.");
    }
    return s;
  }

  /* ---------- droits par rôle (mêmes règles que l'interface) ---------- */
  const isAdmin = u => u.role === ADMIN;
  const isGerantOrAdmin = u => u.role === ADMIN || u.role === GERANT;
  function moduleOr404(store){
    const mod = schema.modules.get(store);
    if (!mod) throw new HttpError(404, "Module inconnu");
    return mod;
  }
  function assertCanWrite(user, mod){
    const ok = mod.key === "utilisateurs" || mod.adminOnly ? isAdmin(user)
      : mod.section === "parametres" ? isGerantOrAdmin(user) : true;
    if (!ok) throw new HttpError(403, "Action non autorisée pour votre rôle.");
  }

  /* ---------- lecture / écriture des données ---------- */
  function list(user, store){
    const mod = moduleOr404(store);
    if (mod.key === "utilisateurs"){
      const all = db.all("utilisateurs").map(publicUser);
      return isGerantOrAdmin(user) ? all : all.filter(u => u.id === user.id);
    }
    return db.all(mod.key);
  }

  function activeAdminsExcept(id, replacement){
    return db.all("utilisateurs").map(u => u.id === id ? replacement : u)
      .filter(u => u && u.role === ADMIN && isActive(u)).length;
  }

  function put(user, store, input, sessionHash = ""){
    const mod = moduleOr404(store);
    assertCanWrite(user, mod);
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new ValidationError(["Enregistrement invalide"]);

    return db.transaction(() => {
      let id = input.id;
      if (mod.single) id = 1;
      if (id !== undefined && id !== null && !(Number.isInteger(id) && id > 0 && id < 2 ** 31)) throw new ValidationError(["Identifiant invalide"]);
      const existing = id ? db.get(mod.key, id) : null;
      if (!id) id = db.nextId(mod.key);

      const lookups = new Map();
      const record = validateRecord(mod, input, {
        existing,
        lookup(source, field){
          const k = source + "." + field;
          if (!lookups.has(k)) lookups.set(k, new Set(db.all(source).map(r => r[field]).filter(v => typeof v === "string")));
          return lookups.get(k);
        },
        numeroPrefix: schema.numeroPrefixes[mod.key],
        numeroTaken: numero => db.all(mod.key).some(r => r.numero === numero && r.id !== id),
      });

      if (mod.key === "utilisateurs"){
        const other = findByLogin(record.login);
        if (other && other.id !== id) throw new ValidationError([`L'identifiant « ${record.login} » est déjà utilisé`]);
        const pw = input.motDePasse;
        if (pw){
          const problem = passwordProblem(pw);
          if (problem) throw new ValidationError([problem]);
          record.motDePasseHash = hashPassword(pw);
          // Un administrateur qui fixe le code d'un autre compte : celui-ci devra le changer.
          record.doitChangerMotDePasse = id !== user.id;
          if (existing) db.sessions.deleteOthers(id, id === user.id ? sessionHash : "");
        } else if (existing && existing.motDePasseHash){
          record.motDePasseHash = existing.motDePasseHash;
          record.doitChangerMotDePasse = !!existing.doitChangerMotDePasse;
        } else {
          throw new ValidationError(["Code secret : champ obligatoire"]);
        }
        if (activeAdminsExcept(id, { ...record, id }) === 0) throw new ValidationError(["Il doit rester au moins un administrateur actif."]);
      }

      db.put(mod.key, id, record, user.id);
      db.audit(user.id, existing ? "update" : "create", mod.key, id);
      return id;
    });
  }

  function remove(user, store, id){
    const mod = moduleOr404(store);
    if (!isAdmin(user)) throw new HttpError(403, "Suppression réservée à l'administrateur.");
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError(["Identifiant invalide"]);
    return db.transaction(() => {
      if (mod.key === "utilisateurs"){
        if (id === user.id) throw new ValidationError(["Vous ne pouvez pas supprimer votre propre compte."]);
        if (activeAdminsExcept(id, null) === 0) throw new ValidationError(["Il doit rester au moins un administrateur actif."]);
        db.sessions.deleteOthers(id, "");
      }
      const ok = db.delete(mod.key, id);
      if (ok) db.audit(user.id, "delete", mod.key, id);
      return ok;
    });
  }

  /* ---------- HTTP ---------- */
  function readBody(req){
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", c => { size += c.length; if (size > MAX_BODY){ reject(new HttpError(413, "Données trop volumineuses")); req.destroy(); } else chunks.push(c); });
      req.on("end", () => {
        if (!chunks.length) return resolve({});
        try{ resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch(e){ reject(new HttpError(400, "JSON invalide")); }
      });
      req.on("error", reject);
    });
  }
  function send(res, status, body, headers = {}){
    const isJson = typeof body !== "string";
    res.writeHead(status, {
      "Content-Type": isJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
  }
  // Anti-CSRF : écritures uniquement en JSON et depuis la même origine.
  function assertSameOrigin(req){
    if (!["POST", "PUT", "DELETE"].includes(req.method)) return;
    // DELETE n'a pas de corps ; c'est une méthode « non simple » : un autre site ne peut
    // pas l'envoyer sans autorisation CORS (jamais accordée ici).
    if (req.method !== "DELETE" && !(req.headers["content-type"] || "").startsWith("application/json")) throw new HttpError(415, "JSON attendu");
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, "Origine refusée");
  }

  async function handleApi(req, res, url){
    assertSameOrigin(req);
    const p = url.pathname;
    const m = req.method;

    if (p === "/api/status" && m === "GET") return send(res, 200, { server: true, needsSetup: db.count("utilisateurs") === 0 });

    if (p === "/api/setup" && m === "POST"){
      const { login, password } = await readBody(req);
      const user = db.transaction(() => {
        if (db.count("utilisateurs") > 0) throw new HttpError(409, "L'administrateur a déjà été créé.");
        const problem = passwordProblem(password);
        if (problem) throw new ValidationError([problem]);
        const clean = validateRecord(schema.modules.get("utilisateurs"),
          { nom: "Administrateur", prenom: "Système", login, role: ADMIN, statut: "Actif", dateExpiration: "" },
          { lookup: () => new Set(), numeroTaken: () => false });
        const u = { ...clean, motDePasseHash: hashPassword(password), doitChangerMotDePasse: false };
        db.put("utilisateurs", 1, u, null);
        db.audit(1, "setup", "utilisateurs", 1);
        return { ...u, id: 1 };
      });
      startSession(req, res, user);
      return send(res, 200, { user: publicUser(user) });
    }

    if (p === "/api/login" && m === "POST"){
      const { login, password } = await readBody(req);
      const key = (req.socket.remoteAddress || "") + "|" + String(login || "").toLowerCase();
      if (limiter.blocked(key)) throw new HttpError(429, "Trop de tentatives : réessayez dans 15 minutes.");
      const user = findByLogin(login);
      const ok = verifyPassword(String(password || ""), user ? user.motDePasseHash : DUMMY_HASH) && !!user;
      if (!ok){ limiter.fail(key); throw new HttpError(401, "Identifiant ou code secret incorrect."); }
      if ((user.statut || "Actif") !== "Actif") throw new HttpError(403, "Ce compte est désactivé. Contactez l'administrateur.");
      if (isExpired(user)) throw new HttpError(403, "Votre durée d'accès a expiré. Contactez l'administrateur.");
      limiter.reset(key);
      if (LEGACY_DEFAULT_PASSWORDS.includes(password) && !user.doitChangerMotDePasse){
        user.doitChangerMotDePasse = true;
        db.put("utilisateurs", user.id, user, user.id);
      }
      startSession(req, res, user);
      db.audit(user.id, "login", null, null);
      return send(res, 200, { user: publicUser(user) });
    }

    if (p === "/api/logout" && m === "POST"){
      const token = readCookie(req);
      if (token) db.sessions.delete(tokenHash(token));
      setSessionCookie(req, res, "", 0);
      return send(res, 200, { ok: true });
    }

    const session = requireUser(req);
    const user = session.user;

    if (p === "/api/me" && m === "GET") return send(res, 200, { user: publicUser(user) });

    if (p === "/api/password" && m === "POST"){
      const { current, password } = await readBody(req);
      if (!user.doitChangerMotDePasse && !verifyPassword(String(current || ""), user.motDePasseHash)){
        throw new ValidationError(["Code secret actuel incorrect."]);
      }
      const problem = passwordProblem(password);
      if (problem) throw new ValidationError([problem]);
      if (verifyPassword(password, user.motDePasseHash)) throw new ValidationError(["Choisissez un code secret différent de l'actuel."]);
      const updated = { ...user, motDePasseHash: hashPassword(password), doitChangerMotDePasse: false };
      db.put("utilisateurs", user.id, updated, user.id);
      db.sessions.deleteOthers(user.id, session.hash);
      db.audit(user.id, "password", "utilisateurs", user.id);
      return send(res, 200, { user: publicUser(updated) });
    }

    const dm = /^\/api\/data\/([A-Za-z_]+)(?:\/(\d+))?$/.exec(p);
    if (dm){
      const [, store, idStr] = dm;
      if (m === "GET" && !idStr) return send(res, 200, list(user, store));
      if (m === "PUT" && !idStr) return send(res, 200, { id: put(user, store, await readBody(req), session.hash) });
      if (m === "DELETE" && idStr) return send(res, 200, { ok: remove(user, store, Number(idStr)) });
    }
    throw new HttpError(404, "Route inconnue");
  }

  async function handler(req, res){
    const url = new URL(req.url, "http://localhost");
    // L'hébergeur peut monter l'application dans un sous-dossier (ex. /kgpro/) sans retirer
    // ce préfixe : on ne garde que la partie utile du chemin.
    const apiAt = url.pathname.indexOf("/api/");
    if (apiAt > 0) url.pathname = url.pathname.slice(apiAt);
    try{
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      if (req.method === "GET" && (url.pathname.endsWith("/") || url.pathname.endsWith("/kgpro.html"))) return send(res, 200, appHtml());
      return send(res, 404, { error: "Introuvable" });
    }catch(e){
      if (e instanceof ValidationError) return send(res, 422, { error: e.message, errors: e.errors });
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: "Erreur interne du serveur" });
    }
  }

  setInterval(() => db.sessions.purge(Date.now() - IDLE_MS), 3600 * 1000).unref();
  return { handler, db, schema };
}

// Démarre le serveur. Appelé directement (npm start) ou par app.cjs (Phusion Passenger,
// utilisé par les hébergements cPanel comme LWS : Passenger intercepte listen()).
export function startServer(){
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)){
    throw new Error(`Node.js ${process.versions.node} trop ancien : choisissez Node.js 22.13 ou plus récent (24 conseillé).`);
  }
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || "127.0.0.1";
  const dbFile = path.resolve(process.env.KGP_DB_FILE || path.join(ROOT, "donnees", "kgpro.sqlite"));
  const { handler } = createApp({ appFile: process.env.KGP_APP_FILE || path.join(ROOT, "kgpro.html"), dbFile });
  const server = http.createServer(handler);
  server.listen(port, host, () => {
    console.log(`KAYELY GESTION PRO : http://${host}:${port}  (base : ${dbFile})`);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
