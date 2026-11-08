// Tests du serveur : npm test
// Les mêmes tests valident la version PHP (php/) : voir test-php.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "./server.mjs";

let server, base;
before(async () => {
  if (process.env.KGP_TEST_BASE){ base = process.env.KGP_TEST_BASE; return; }
  const { handler } = createApp({ dbFile: ":memory:" });
  server = http.createServer(handler);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

function client(){
  let cookie = "";
  return async function call(method, path, body, extraHeaders = {}){
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    let data = null; try{ data = await res.json(); }catch(e){}
    return { status: res.status, data, headers: res.headers };
  };
}

const admin = client();
const PASS = "Admin-Secret-2026";

test("premier lancement : création de l'administrateur", async () => {
  assert.equal((await admin("GET", "/api/status")).data.needsSetup, true);
  assert.equal((await admin("POST", "/api/setup", { login: "admin", password: "court" })).status, 422);
  assert.equal((await admin("POST", "/api/setup", { login: "admin", password: "kayely123" })).status, 422);
  const r = await admin("POST", "/api/setup", { login: "admin", password: PASS });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, "Administrateur");
  assert.equal(r.data.user.motDePasseHash, undefined);
  // impossible de recréer un administrateur ensuite
  assert.equal((await client()("POST", "/api/setup", { login: "pirate", password: "Pirate-2026!" })).status, 409);
});

test("sans session, aucune donnée n'est accessible", async () => {
  const anon = client();
  assert.equal((await anon("GET", "/api/data/clients")).status, 401);
  assert.equal((await anon("PUT", "/api/data/clients", { nom: "X" })).status, 401);
});

test("les mots de passe ne sortent jamais du serveur", async () => {
  const r = await admin("GET", "/api/data/utilisateurs");
  assert.equal(r.status, 200);
  for (const u of r.data){ assert.equal(u.motDePasseHash, undefined); assert.equal(u.motDePasse, ""); }
});

test("chaque champ est vérifié", async () => {
  const bad = async (store, rec) => { const r = await admin("PUT", "/api/data/" + store, rec); assert.equal(r.status, 422, JSON.stringify(r.data)); return r.data.errors.join(" | "); };
  assert.match(await bad("clients", { nom: "" }), /obligatoire/);
  assert.match(await bad("taxes", { libelle: "TVA", type: "Inconnu", taux: 18 }), /non autorisée/);
  assert.match(await bad("taxes", { libelle: "TVA", type: "TVA", taux: 250 }), /entre 0 et 100/);
  assert.match(await bad("taxes", { libelle: "TVA", type: "TVA", taux: "18" }), /nombre attendu/);
  assert.match(await bad("rhConges", { employe: "X", dateDebut: "2026-02-31" }), /date invalide|n'existe pas|obligatoire/);
  assert.match(await bad("clients", { nom: "A".repeat(5000) }), /trop long/);
  assert.match(await bad("clients", '{"nom":"A","__proto__":{"admin":true}}'), /invalide|interdit/);
  assert.match(await bad("societe", { raison: "S", logo: "javascript:alert(1)" }), /image invalide/);
  assert.match(await bad("clients", { nom: "A", motDePasseHash: "x" }), /interdit/);
  assert.equal((await admin("PUT", "/api/data/inexistant", {})).status, 404);
});

test("références vers d'autres fiches et lignes de facture recalculées", async () => {
  const unknown = await admin("PUT", "/api/data/factures", { client: "Inconnu SARL", date: "2026-01-10", lignes: [{ designation: "A", quantite: 1, prixUnitaire: 10 }] });
  assert.equal(unknown.status, 422);
  assert.match(unknown.data.error, /n'existe pas/);

  assert.equal((await admin("PUT", "/api/data/clients", { nom: "Cabinet ABC" })).status, 200);
  const fact = { client: "Cabinet ABC", date: "2026-01-10", numero: "FA-0001",
    lignes: [{ designation: "Conseil", quantite: 2, prixUnitaire: 50000, montant: 1 }], montantHT: 1 };
  const ok = await admin("PUT", "/api/data/factures", fact);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const saved = (await admin("GET", "/api/data/factures")).data.find(f => f.id === ok.data.id);
  assert.equal(saved.montantHT, 100000);           // recalculé : la valeur envoyée (1) est ignorée
  assert.equal(saved.lignes[0].montant, 100000);

  assert.match((await admin("PUT", "/api/data/factures", { ...fact })).data.error, /déjà utilisé/);
  assert.equal((await admin("PUT", "/api/data/factures", { ...fact, numero: "XX-1" })).status, 422);
  assert.equal((await admin("PUT", "/api/data/factures", { ...fact, numero: "FA-0002", lignes: [{ designation: "x", quantite: -1, prixUnitaire: 5 }] })).status, 422);
  // mise à jour de la même facture avec son propre numéro : autorisée
  assert.equal((await admin("PUT", "/api/data/factures", { ...fact, id: ok.data.id })).status, 200);
});

test("droits par rôle", async () => {
  const mk = (login, role) => admin("PUT", "/api/data/utilisateurs", { nom: login, login, motDePasse: "Initial-2026", role, statut: "Actif", dateExpiration: "" });
  assert.equal((await mk("caisse", "Caissier(e)")).status, 200);
  assert.equal((await mk("Caisse", "Gérant")).status, 422); // identifiant déjà pris (casse ignorée)
  assert.equal((await mk("gerant", "Gérant")).status, 200);

  const caisse = client();
  assert.equal((await caisse("POST", "/api/login", { login: "caisse", password: "Initial-2026" })).data.user.doitChangerMotDePasse, true);
  assert.equal((await caisse("GET", "/api/data/clients")).status, 403); // code fixé par l'admin : à changer d'abord
  assert.equal((await caisse("POST", "/api/password", { password: "Caisse-Perso-2026" })).status, 200);

  assert.equal((await caisse("GET", "/api/data/clients")).status, 200);
  assert.equal((await caisse("PUT", "/api/data/clients", { nom: "Client caisse" })).status, 200);
  assert.equal((await caisse("PUT", "/api/data/societe", { raison: "Piratage" })).status, 403);
  assert.equal((await caisse("PUT", "/api/data/utilisateurs", { nom: "x", login: "x2", motDePasse: "Pirate-2026!", role: "Administrateur" })).status, 403);
  assert.equal((await caisse("DELETE", "/api/data/clients/1")).status, 403);
  // écriture générée automatiquement (source) : remplaçable par un rôle non administrateur
  const gen = await caisse("PUT", "/api/data/journal", { date: "2026-01-10", compte: "571", debit: 10, credit: 0, source: "treso_caisse#1" });
  assert.equal(gen.status, 200);
  const manuelle = await caisse("PUT", "/api/data/journal", { date: "2026-01-10", compte: "571", debit: 10, credit: 0 });
  assert.equal((await caisse("DELETE", "/api/data/journal/" + manuelle.data.id)).status, 403);
  assert.equal((await caisse("DELETE", "/api/data/journal/" + gen.data.id)).status, 200);
  const users = (await caisse("GET", "/api/data/utilisateurs")).data;
  assert.deepEqual(users.map(u => u.login), ["caisse"]);

  const gerant = client();
  await gerant("POST", "/api/login", { login: "gerant", password: "Initial-2026" });
  await gerant("POST", "/api/password", { password: "Gerant-Perso-2026" });
  assert.equal((await gerant("PUT", "/api/data/societe", { raison: "Kayely SARL" })).status, 200);
  assert.equal((await gerant("PUT", "/api/data/taxes", { libelle: "TVA", type: "TVA", taux: 18 })).status, 403); // adminOnly
  assert.equal((await gerant("PUT", "/api/data/utilisateurs", { nom: "x", login: "x3", motDePasse: "Pirate-2026!", role: "Administrateur" })).status, 403);
});

test("dernier administrateur protégé", async () => {
  const me = (await admin("GET", "/api/me")).data.user;
  assert.match((await admin("PUT", "/api/data/utilisateurs", { ...me, statut: "Inactif" })).data.error, /au moins un administrateur/);
  assert.match((await admin("DELETE", "/api/data/utilisateurs/" + me.id)).data.error, /propre compte/);
  // modifier sa fiche sans ressaisir le code secret : le code existant est conservé
  assert.equal((await admin("PUT", "/api/data/utilisateurs", { ...me, prenom: "Chef" })).status, 200);
  assert.equal((await client()("POST", "/api/login", { login: "admin", password: PASS })).status, 200);
});

test("compte désactivé : session coupée", async () => {
  const c = client();
  assert.equal((await c("POST", "/api/login", { login: "caisse", password: "Caisse-Perso-2026" })).status, 200);
  const u = (await admin("GET", "/api/data/utilisateurs")).data.find(x => x.login === "caisse");
  assert.equal((await admin("PUT", "/api/data/utilisateurs", { ...u, statut: "Inactif" })).status, 200);
  assert.equal((await c("GET", "/api/data/clients")).status, 401);
  assert.equal((await c("POST", "/api/login", { login: "caisse", password: "Caisse-Perso-2026" })).status, 403);
});

test("protection CSRF et limitation des tentatives", async () => {
  const r = await admin("PUT", "/api/data/clients", { nom: "X" }, { Origin: "https://evil.example" });
  assert.equal(r.status, 403);
  const raw = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(raw.status, 415);

  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c("POST", "/api/login", { login: "gerant", password: "mauvais" })).status, 401);
  assert.equal((await c("POST", "/api/login", { login: "gerant", password: "Gerant-Perso-2026" })).status, 429);
});

test("clôture de période", async () => {
  assert.equal((await admin("PUT", "/api/data/clients", { nom: "Client clôture" })).status, 200);
  const avant = await admin("PUT", "/api/data/journal", { date: "2025-06-30", compte: "571", debit: 5, credit: 0 });
  assert.equal(avant.status, 200);
  const soc = (await admin("GET", "/api/data/societe")).data[0] || {};
  assert.equal((await admin("PUT", "/api/data/societe", { ...soc, raison: "Kayely SARL", dateCloture: "2025-12-31" })).status, 200);
  const bloque = await admin("PUT", "/api/data/journal", { date: "2025-12-31", compte: "571", debit: 5, credit: 0 });
  assert.equal(bloque.status, 422);
  assert.match(bloque.data.error, /clôturée/);
  assert.equal((await admin("DELETE", "/api/data/journal/" + avant.data.id)).status, 422);
  assert.equal((await admin("PUT", "/api/data/journal", { id: avant.data.id, date: "2026-01-02", compte: "571", debit: 5, credit: 0 })).status, 422);
  assert.equal((await admin("PUT", "/api/data/journal", { date: "2026-01-01", compte: "571", debit: 5, credit: 0 })).status, 200);
  assert.equal((await admin("PUT", "/api/data/paieCalcul", { employe: "", periode: "12/2025", salaireCategoriel: 1 })).status, 422);
  // réouverture : réservée à l'administrateur (ici admin -> autorisé)
  assert.equal((await admin("PUT", "/api/data/societe", { ...soc, raison: "Kayely SARL", dateCloture: "" })).status, 200);
});

test("envoi groupé (lot)", async () => {
  const r = await admin("PUT", "/api/data/planComptable/lot", [
    { classe: "6", compte: "6999", intitule: "Test lot A", sens: "Débit" },
    { classe: "6", compte: "6998", intitule: "Test lot B", sens: "Débit" }]);
  assert.equal(r.status, 200);
  assert.equal(r.data.ids.length, 2);
  const bad = await admin("PUT", "/api/data/planComptable/lot", [{ classe: "6", compte: "6997", intitule: "ok" }, { classe: "X", compte: "", intitule: "" }]);
  assert.equal(bad.status, 422);
  assert.match(bad.data.error, /Fiche 2/);
  assert.equal((await admin("PUT", "/api/data/planComptable/lot", { pas: "une liste" })).status, 422);
});

test("cookie de session protégé", async () => {
  const r = await client()("POST", "/api/login", { login: "admin", password: PASS });
  const set = r.headers.get("set-cookie");
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
});

test("application installée dans un sous-dossier", async () => {
  const r = await fetch(base + "/kgpro/api/status");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).server, true);
  const page = await fetch(base + "/kgpro/");
  assert.match(await page.text(), /window\.KGP_SERVER = true/);
});

test("php/lib/schema.json à jour avec kgpro.html", async () => {
  const fs = await import("node:fs");
  const { buildSchemaJson } = await import("../outils/generer-schema.mjs");
  assert.equal(fs.readFileSync(new URL("../php/lib/schema.json", import.meta.url), "utf8"), buildSchemaJson(),
    "Lancez : node outils/generer-schema.mjs");
});
