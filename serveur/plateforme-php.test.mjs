// Tests du mode plusieurs sociétés (version PHP). Lancés par serveur/test-php.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cinetpayToken } from "./paiement.mjs";

const ROOT = process.env.KGP_TEST_ROOT;
const DATA = process.env.KGP_TEST_DATA;
const skip = !ROOT && "uniquement avec npm run test:php";

function client(){
  const jar = new Map();
  return async function call(method, url, body){
    const res = await fetch(ROOT + url, { method, redirect: "manual",
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()){ const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    let data = null; const text = await res.text(); try{ data = JSON.parse(text); }catch(e){ data = text; }
    return { status: res.status, data, headers: res.headers };
  };
}
const consoleClient = client();
const prov = {};   // codes provisoires des administrateurs créés par la console
async function consoleLogin(){
  const r = await consoleClient("POST", "/console/api/login", { password: process.env.KGP_CONSOLE_PASSWORD });
  assert.equal(r.status, 200);
}

test("console : code d'installation consommé, accès protégé", { skip }, async () => {
  assert.equal(fs.existsSync(path.join(DATA, "CODE-CONSOLE.txt")), false);
  assert.equal((await client()("GET", "/console/api/societes")).status, 401);
  assert.equal((await client()("POST", "/console/api/setup", { code: "AAAAAAAAAA", password: "Pirate-Console-1" })).status, 409);
  assert.equal((await client()("POST", "/console/api/login", { password: "mauvais" })).status, 401);
  await consoleLogin();
});

test("création de sociétés : codes contrôlés", { skip }, async () => {
  await consoleLogin();
  for (const slug of ["Mauvais Code", "console", "-x", "a".repeat(41)]){
    assert.equal((await consoleClient("POST", "/console/api/societes", { slug, nom: "X" })).status, 422, slug);
  }
  const ra = await consoleClient("POST", "/console/api/societes", { slug: "alpha", nom: "Alpha SARL" });
  const rb = await consoleClient("POST", "/console/api/societes", { slug: "beta", nom: "Beta SA" });
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);
  // La console crée l'administrateur de la société et renvoie un code provisoire.
  assert.match(ra.data.login, /^admin$/);
  assert.match(ra.data.codeProvisoire, /^Kgp-/);
  prov.alpha = ra.data.codeProvisoire;
  prov.beta = rb.data.codeProvisoire;
  assert.equal((await consoleClient("POST", "/console/api/societes", { slug: "alpha", nom: "Doublon" })).status, 422);
  assert.ok(fs.existsSync(path.join(DATA, "societes", "alpha.sqlite")));
  assert.ok(fs.existsSync(path.join(DATA, "societes", "beta.sqlite")));

  // La société n'est plus « à prendre » : plus de setup public possible.
  assert.equal((await client()("GET", "/alpha/api/status")).data.needsSetup, false);
  assert.equal((await client()("POST", "/alpha/api/setup", { login: "pirate", password: "Pirate-Secret-2026" })).status, 409);
});

test("chaque société a sa propre base, sans interférence", { skip }, async () => {
  const a = client(), b = client();
  // Première connexion avec le code provisoire de la console, puis choix du code définitif.
  assert.equal((await a("POST", "/alpha/api/login", { login: "admin", password: prov.alpha })).data.user.doitChangerMotDePasse, true);
  assert.equal((await a("POST", "/alpha/api/password", { password: "Alpha-Secret-2026" })).status, 200);
  assert.equal((await b("POST", "/beta/api/login", { login: "admin", password: prov.beta })).data.user.doitChangerMotDePasse, true);
  assert.equal((await b("POST", "/beta/api/password", { password: "Beta-Secret-2026" })).status, 200);

  assert.equal((await a("PUT", "/alpha/api/data/clients", { nom: "Client d'Alpha" })).status, 200);
  assert.equal((await b("PUT", "/beta/api/data/clients", { nom: "Client de Beta" })).status, 200);
  assert.deepEqual((await a("GET", "/alpha/api/data/clients")).data.map(c => c.nom), ["Client d'Alpha"]);
  assert.deepEqual((await b("GET", "/beta/api/data/clients")).data.map(c => c.nom), ["Client de Beta"]);

  // Même identifiant « admin » dans les deux sociétés, mais comptes distincts.
  assert.equal((await client()("POST", "/beta/api/login", { login: "admin", password: "Alpha-Secret-2026" })).status, 401);

  // La session d'Alpha n'ouvre rien chez Beta (cookie propre à chaque société).
  const cookieA = (await client()("POST", "/alpha/api/login", { login: "admin", password: "Alpha-Secret-2026" })).headers.get("set-cookie");
  assert.match(cookieA, /path=\/alpha\//i);
  const token = /kgp_s_alpha=([^;]+)/.exec(cookieA)[1];
  const forged = await fetch(ROOT + "/beta/api/data/clients", { headers: { Cookie: `kgp_s_alpha=${token}; kgp_s_beta=${token}` } });
  assert.equal(forged.status, 401);

  // Une référence ne peut pas viser une fiche d'une autre société.
  const r = await b("PUT", "/beta/api/data/factures", { client: "Client d'Alpha", date: "2026-01-10", lignes: [{ designation: "x", quantite: 1, prixUnitaire: 1 }] });
  assert.equal(r.status, 422);
});

test("page de chaque société et société inconnue", { skip }, async () => {
  const page = await client()("GET", "/alpha/");
  assert.match(page.data, /window\.KGP_SOCIETE = \{"slug":"alpha","nom":"Alpha SARL"\}/);
  assert.equal((await client()("GET", "/alpha")).status, 301);
  assert.equal((await client()("GET", "/inconnue/")).status, 404);
  assert.equal((await client()("GET", "/inconnue/api/status")).status, 404);
  assert.equal((await client()("GET", "/api/status")).status, 404);
  assert.match((await client()("GET", "/")).data, /Code société/);
});

test("suspension d'une société et code admin oublié", { skip }, async () => {
  await consoleLogin();
  const a = client();
  await a("POST", "/alpha/api/login", { login: "admin", password: "Alpha-Secret-2026" });
  assert.equal((await consoleClient("POST", "/console/api/societes/alpha/statut", { statut: "Suspendue" })).status, 200);
  assert.equal((await a("GET", "/alpha/api/data/clients")).status, 403);
  assert.equal((await client()("GET", "/alpha/")).status, 403);
  assert.equal((await client()("GET", "/beta/api/status")).status, 200); // Beta n'est pas touchée
  assert.equal((await consoleClient("POST", "/console/api/societes/alpha/statut", { statut: "Active" })).status, 200);

  const reset = await consoleClient("POST", "/console/api/societes/alpha/reinitialiser", {});
  assert.equal(reset.status, 200);
  const c = client();
  const login = await c("POST", "/alpha/api/login", { login: reset.data.login, password: reset.data.codeProvisoire });
  assert.equal(login.data.user.doitChangerMotDePasse, true);
  assert.equal((await c("GET", "/alpha/api/data/clients")).status, 403);
  assert.equal((await c("POST", "/alpha/api/password", { password: "Alpha-Nouveau-2026" })).status, 200);
  assert.equal((await c("GET", "/alpha/api/data/clients")).data.length, 1); // données intactes

  const list = (await consoleClient("GET", "/console/api/societes")).data;
  const alpha = list.find(s => s.slug === "alpha");
  assert.equal(alpha.administrateurConfigure, true);
  assert.equal(alpha.utilisateurs, 1);
});

test("clés d'activation émises par la console", { skip }, async () => {
  const crypto = await import("node:crypto");
  assert.equal((await client()("GET", "/console/api/licences")).status, 401);
  await consoleLogin();
  let r = await consoleClient("GET", "/console/api/licences");
  assert.equal(r.data.configured, false);
  assert.equal((await consoleClient("POST", "/console/api/licences", { slug: "alpha", expiration: "2027-12-31" })).status, 422);

  r = await consoleClient("POST", "/console/api/licences/cle-signature", {});
  assert.equal(r.status, 200);
  const pub = r.data.publicKey;
  assert.match(pub, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await consoleClient("POST", "/console/api/licences/cle-signature", {})).status, 409);
  assert.ok(fs.existsSync(path.join(DATA, "licence-signature.key")));

  for (const expiration of ["2020-01-01", "2027-02-30", "2150-01-01", ""]){
    assert.equal((await consoleClient("POST", "/console/api/licences", { slug: "alpha", expiration })).status, 422, expiration);
  }
  r = await consoleClient("POST", "/console/api/licences", { slug: "alpha", expiration: "2027-12-31" });
  assert.equal(r.status, 200);
  assert.equal(r.data.structure, "Alpha SARL");
  const cle = r.data.cle;
  assert.match(cle, /^KGP2-271231-[A-Za-z0-9_-]{86}$/);

  // Signature vérifiée par Node.js (Ed25519 standard)
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64url")]), format: "der", type: "spki" });
  assert.ok(crypto.verify(null, Buffer.from("KGP2|ALPHASARL|271231"), key, Buffer.from(cle.slice(12), "base64url")));

  // La page de la société embarque la clé publique, et le vérificateur de l'application accepte la clé
  const page = (await client()("GET", "/alpha/")).data;
  assert.match(page, new RegExp(`const KGP_LICENSE_PUBLIC_KEY = "${pub}";`));
  const a = page.indexOf("/* ================= LICENCE D'ACTIVATION"), b = page.indexOf("function kgpGetStoredLicense");
  const verif = new Function(page.slice(a, b) + ";return kgpValidateKey;")();
  assert.ok(verif("Alpha SARL", cle));
  assert.ok(verif("alpha sarl", cle));
  assert.equal(verif("Beta SA", cle), null);

  // Structure libre avec accents (version installée sur un poste)
  r = await consoleClient("POST", "/console/api/licences", { slug: "", structure: "Boulangerie Étoile", expiration: "2028-06-30" });
  assert.equal(r.status, 200);
  assert.ok(verif("Boulangerie Étoile", r.data.cle));

  const hist = (await consoleClient("GET", "/console/api/licences")).data.licences;
  assert.equal(hist.length, 2);
});

test("mot de passe de la console oublié : réinitialisation par fichier", { skip }, async () => {
  const avant = (await (async () => { await consoleLogin(); return (await consoleClient("GET", "/console/api/societes")).data.length; })());
  fs.writeFileSync(path.join(DATA, "REINITIALISER-CONSOLE"), "");
  const st = await client()("GET", "/console/api/status");
  assert.equal(st.data.configured, false);
  assert.equal(fs.existsSync(path.join(DATA, "REINITIALISER-CONSOLE")), false, "fichier de demande supprimé");
  assert.equal((await client()("POST", "/console/api/login", { password: process.env.KGP_CONSOLE_PASSWORD })).status, 409, "ancien mot de passe inutilisable");
  assert.equal((await consoleClient("GET", "/console/api/societes")).status, 401, "anciennes sessions fermées");
  const code = /^\s{4}([A-F0-9]{10})$/m.exec(fs.readFileSync(path.join(DATA, "CODE-CONSOLE.txt"), "utf8"))[1];
  assert.equal((await consoleClient("POST", "/console/api/setup", { code, password: process.env.KGP_CONSOLE_PASSWORD })).status, 200);
  assert.equal((await consoleClient("GET", "/console/api/societes")).data.length, avant, "sociétés conservées");
  assert.equal((await client()("GET", "/alpha/api/status")).status, 200, "sociétés toujours accessibles");
});

test("journaux et données : aucune information personnelle", { skip }, async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { spawnSync } = await import("node:child_process");
  // 1. Compteur anti-force brute : uniquement des empreintes (pas d'IP ni d'identifiant)
  for (let i = 0; i < 2; i++) assert.equal((await client()("POST", "/test/api/login", { login: "gerant", password: "mauvais-code" })).status, 401);
  const db = new DatabaseSync(path.join(DATA, "societes", "test.sqlite"));
  const cles = db.prepare("SELECT k FROM login_fails").all().map(r => r.k);
  db.close();
  assert.ok(cles.length > 0, "des tentatives échouées ont bien été enregistrées");
  for (const k of cles){ assert.match(k, /^[0-9a-f]{64}$/); assert.doesNotMatch(k, /gerant|127\.0\.0\.1/); }
  // 2. Journal d'incident : référence, message nettoyé, aucune trace ni argument
  const php = `require "php/lib/app.php";
    function verifier($secret){ throw new RuntimeException("Échec pour jean.kouassi@exemple.ci, tél. 07 07 12 34 56, fichier /home/kayely/htdocs/donnees/x.sqlite"); }
    try { verifier("CodeSecret-123"); } catch (Throwable $e) { echo kgp_message_incident(kgp_incident($e, "test")); }`;
  const r = spawnSync("php", ["-d", "error_log=/dev/stderr", "-r", php], { encoding: "utf8" });
  assert.match(r.stdout, /^Erreur interne du serveur \(réf\. [0-9A-F]{8}\)/);
  assert.match(r.stderr, /\[KGP [0-9A-F]{8}\] test — RuntimeException : .*\[email\].*\[numéro\].*\[chemin\]/);
  for (const fuite of ["jean.kouassi", "07 07 12", "/home/kayely", "CodeSecret-123", "Stack trace", "#0 "]) assert.ok(!r.stderr.includes(fuite), "fuite dans le journal : " + fuite);
  // 3. Erreurs PHP jamais affichées dans les réponses
  const affiche = spawnSync("php", ["-r", `require "php/lib/app.php"; echo ini_get("display_errors");`], { encoding: "utf8" });
  assert.equal(affiche.stdout.trim(), "0");
});

test("paiement en ligne (CinetPay) : configuration et signature", { skip }, async () => {
  const a = client();
  await a("POST", "/alpha/api/login", { login: "admin", password: "Alpha-Nouveau-2026" });
  // Configuration absente au départ
  assert.equal((await a("GET", "/alpha/api/paiement/config")).data.configure, false);
  // L'administrateur configure CinetPay ; la réponse ne contient jamais l'apikey ni la clé secrète
  const set = await a("PUT", "/alpha/api/paiement/config", { siteId: "12345", apikey: "APIKEY", secretKey: "secret-test-123", moyen: "Mobile Money" });
  assert.equal(set.status, 200);
  assert.deepEqual(set.data, { configure: true, siteId: "12345", moyen: "Mobile Money" });
  const vue = (await a("GET", "/alpha/api/paiement/config")).data;
  assert.equal(vue.apikey, undefined); assert.equal(vue.secretKey, undefined);
  // La clé secrète est hors de la base (fichier du dossier de données, jamais servi)
  assert.ok(fs.existsSync(path.join(DATA, "societes", "alpha.paiement.json")));

  const post = { cpm_site_id: "12345", cpm_trans_id: "alpha-F1-1", cpm_trans_date: "2026-02-02", cpm_amount: "1000",
    cpm_currency: "XOF", signature: "s", payment_method: "OM", cel_phone_num: "", cpm_phone_prefixe: "", cpm_language: "fr",
    cpm_version: "v3", cpm_payment_config: "", cpm_page_action: "PAYMENT", cpm_custom: "", cpm_designation: "F", cpm_error_message: "" };
  const body = new URLSearchParams(post).toString();
  const envoyer = token => fetch(ROOT + "/alpha/api/paiement/webhook", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-token": token }, body });
  // Signature invalide : rejetée
  assert.equal((await envoyer("deadbeef")).status, 403);
  // Signature valide : acceptée (puis reconfirmation CinetPay ; ici l'API n'est pas joignable -> aucun règlement)
  assert.equal((await envoyer(cinetpayToken(post, "secret-test-123"))).status, 200);
  assert.equal((await a("GET", "/alpha/api/data/reglements")).data.filter(r => r.reference === "CinetPay alpha-F1-1").length, 0);
});
