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
  // écriture saisie à la main : interdite au Caissier (OWASP A01), suppression aussi
  assert.equal((await caisse("PUT", "/api/data/journal", { date: "2026-01-10", compte: "571", debit: 10, credit: 0 })).status, 403);
  const manuelle = await admin("PUT", "/api/data/journal", { date: "2026-01-10", compte: "571", debit: 10, credit: 0 });
  assert.equal((await caisse("DELETE", "/api/data/journal/" + manuelle.data.id)).status, 403);
  // données du personnel et plan comptable : hors de portée du Caissier
  assert.equal((await caisse("GET", "/api/data/rhEmployes")).status, 403);
  assert.equal((await caisse("GET", "/api/data/paieCalcul")).status, 403);
  assert.equal((await caisse("PUT", "/api/data/rhEmployes", { nom: "X", salaireBase: 1 })).status, 403);
  assert.equal((await caisse("PUT", "/api/data/planComptable", { classe: "6", compte: "6990", intitule: "Pirate" })).status, 403);
  assert.equal((await caisse("GET", "/api/audit")).status, 403);
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

test("prix et totaux calculés par le serveur", async () => {
  assert.equal((await admin("PUT", "/api/data/articles", { designation: "Sac cuir", prixVente: 25000, tva: 18 })).status, 200);
  assert.equal((await admin("PUT", "/api/data/services", { designation: "Réparation", prix: 8000, tva: 18 })).status, 200);
  assert.equal((await admin("PUT", "/api/data/utilisateurs", { nom: "Caisse prix", login: "caisse-prix", motDePasse: "Initial-2026", role: "Caissier(e)", statut: "Actif", dateExpiration: "" })).status, 200);
  const caisse = client();
  assert.equal((await caisse("POST", "/api/login", { login: "caisse-prix", password: "Initial-2026" })).status, 200);
  assert.equal((await caisse("POST", "/api/password", { password: "Caisse-Prix-2026" })).status, 200);

  // Caissier : prix du catalogue imposé, lignes hors catalogue laissées telles quelles, TVA et TTC recalculés
  const f = { client: "Cabinet ABC", date: "2026-02-01", numero: "FA-0101", tvaPct: 18, timbreQuittance: 100,
    montantTVA: 1, montantTTC: 1, montantRegle: 0,
    lignes: [{ designation: "Sac cuir", quantite: 2, prixUnitaire: 1 }, { designation: "Réparation", quantite: 1, prixUnitaire: 8000 },
             { designation: "Article libre", quantite: 1, prixUnitaire: 500 }] };
  const r = await caisse("PUT", "/api/data/factures", f);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.prixCorriges, [{ designation: "Sac cuir", saisi: 1, catalogue: 25000 }]);
  const e = r.data.enregistrement;
  assert.equal(e.lignes[0].prixUnitaire, 25000);
  assert.equal(e.montantHT, 58500);
  assert.equal(e.montantTVA, 10530);
  assert.equal(e.montantTTC, 69130);
  const lu = (await admin("GET", "/api/data/factures")).data.find(x => x.id === r.data.id);
  assert.equal(lu.montantHT, 58500);
  assert.equal(lu.montantTTC, 69130);

  // Gérant / administrateur : prix négocié accepté
  const g = await admin("PUT", "/api/data/factures", { ...f, numero: "FA-0102", lignes: [{ designation: "Sac cuir", quantite: 1, prixUnitaire: 20000 }] });
  assert.equal(g.status, 200);
  assert.deepEqual(g.data.prixCorriges, []);
  assert.equal(g.data.enregistrement.montantHT, 20000);
  // ce prix accordé reste valable si le Caissier modifie ensuite la facture
  const g2 = await caisse("PUT", "/api/data/factures", { ...g.data.enregistrement, timbreQuittance: 0 });
  assert.equal(g2.status, 200);
  assert.equal(g2.data.enregistrement.montantHT, 20000);
  assert.equal(g2.data.enregistrement.montantTTC, 23600);

  // acompte supérieur au TTC : refusé
  const trop = await caisse("PUT", "/api/data/factures", { ...f, numero: "FA-0103", montantRegle: 999999 });
  assert.equal(trop.status, 422);
  assert.match(trop.data.error, /supérieur au total TTC/);

  // règlements : facture existante, du bon type, montant au plus égal au reste dû
  const reg = { date: "2026-02-02", type: "Encaissement client", factureVente: "FA-0102", factureAchat: "", montant: 20000, modeReglement: "Caisse",
    factureRef: "pirate", tiers: "pirate" };
  const r1 = await caisse("PUT", "/api/data/reglements", reg);
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.enregistrement.factureRef, "FA-0102");
  assert.equal(r1.data.enregistrement.tiers, "Cabinet ABC");
  assert.equal(r1.data.enregistrement.factureAchat, "");
  const r2 = await caisse("PUT", "/api/data/reglements", { ...reg, montant: 3601 });
  assert.equal(r2.status, 422);
  assert.match(r2.data.error, /reste dû/);
  assert.equal((await caisse("PUT", "/api/data/reglements", { ...reg, montant: 3600 })).status, 200);
  // modification d'un règlement : son ancien montant n'est pas compté deux fois
  assert.equal((await caisse("PUT", "/api/data/reglements", { ...reg, id: r1.data.id, montant: 20000 })).status, 200);
  assert.equal((await caisse("PUT", "/api/data/reglements", { ...reg, id: r1.data.id, montant: 20001 })).status, 422);
  assert.equal((await caisse("PUT", "/api/data/reglements", { ...reg, montant: 0.5 })).status, 422);
  assert.equal((await caisse("PUT", "/api/data/reglements", { ...reg, type: "Paiement fournisseur", factureAchat: "" })).status, 422);
  // facture réglée : son total ne peut plus descendre sous les montants encaissés
  const baisse = await admin("PUT", "/api/data/factures", { ...g.data.enregistrement, lignes: [{ designation: "Sac cuir", quantite: 1, prixUnitaire: 100 }] });
  assert.equal(baisse.status, 422);
  assert.match(baisse.data.error, /déjà réglés/);

  // avoirs : TTC calculé, plafonné au total de la facture liée
  const av = await caisse("PUT", "/api/data/avoirs", { date: "2026-02-03", client: "Cabinet ABC", factureRef: "FA-0101", montantHT: 10000, tvaPct: 18 });
  assert.equal(av.status, 200, JSON.stringify(av.data));
  assert.equal(av.data.enregistrement.montantTTC, 11800);
  const av2 = await caisse("PUT", "/api/data/avoirs", { date: "2026-02-03", client: "Cabinet ABC", factureRef: "FA-0101", montantHT: 50000, tvaPct: 18 });
  assert.equal(av2.status, 422);
  assert.match(av2.data.error, /supérieurs au total TTC/);
  assert.equal((await caisse("PUT", "/api/data/avoirs", { date: "2026-02-03", client: "Client caisse", factureRef: "FA-0101", montantHT: 10, tvaPct: 18 })).status, 422);
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

test("en-têtes de sécurité", async () => {
  const api = await fetch(base + "/api/status");
  assert.match(api.headers.get("content-security-policy") || "", /default-src 'none'/);
  assert.equal(api.headers.get("x-frame-options"), "DENY");
  assert.equal(api.headers.get("x-content-type-options"), "nosniff");
  assert.match(api.headers.get("permissions-policy") || "", /geolocation=\(\)/);
  assert.equal(api.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(api.headers.get("strict-transport-security"), null, "HSTS seulement en HTTPS");
  const page = await fetch(base + "/");
  const csp = page.headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /https?:\/\//, "aucune source extérieure autorisée");
  assert.equal(page.headers.get("x-powered-by"), null);
  const https = await fetch(base + "/api/status", { headers: { "X-Forwarded-Proto": "https" } });
  assert.match(https.headers.get("strict-transport-security") || "", /max-age=31536000/);
});

test("CORS limité au domaine du site", async () => {
  const propre = new URL(base).origin;
  // autre site : refusé, même en lecture et en pré-vérification
  assert.equal((await fetch(base + "/api/status", { headers: { Origin: "https://pirate.example" } })).status, 403);
  assert.equal((await fetch(base + "/api/data/clients", { method: "OPTIONS", headers: { Origin: "https://pirate.example", "Access-Control-Request-Method": "PUT" } })).status, 403);
  assert.equal((await fetch(base + "/api/status", { headers: { Origin: "null" } })).status, 403);
  // même domaine : autorisé
  const ok = await fetch(base + "/api/status", { headers: { Origin: propre } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), propre);
  const pre = await fetch(base + "/api/data/clients", { method: "OPTIONS", headers: { Origin: propre, "Access-Control-Request-Method": "PUT" } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-methods") || "", /PUT/);
  // sans Origin (navigation, outils) : inchangé
  assert.equal((await fetch(base + "/api/status")).status, 200);
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

test("messages de journal nettoyés (Node)", async () => {
  const { messageSur } = await import("./server.mjs");
  const m = messageSur("Échec pour jean.kouassi@exemple.ci, tél. 07 07 12 34 56, fichier /home/kayely/donnees/kgpro.sqlite");
  assert.doesNotMatch(m, /jean\.kouassi|07 07 12|\/home\/kayely/);
  assert.match(m, /\[email\].*\[numéro\].*\[chemin\]/);
});

test("bibliothèques hébergées avec l'application (aucun CDN)", async () => {
  const page = await (await fetch(base + "/")).text();
  assert.doesNotMatch(page, /cdnjs|jsdelivr|unpkg|tessdata\.projectnaptha/, "aucun script tiers dans la page");
  const racine = new URL(base).origin;   // les bibliothèques sont à la racine du site
  const xlsx = await fetch(racine + "/assets/vendor/xlsx/xlsx.full.min.js");
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get("content-type") || "", /javascript/);
  assert.equal(xlsx.headers.get("x-content-type-options"), "nosniff");
  assert.match(await xlsx.text(), /version="0\.20\.3"/, "SheetJS 0.20.3 (failles CVE-2023-30533 et CVE-2024-22363 corrigées)");
  assert.equal((await fetch(racine + "/assets/vendor/tesseract/lang/fra.traineddata", { method: "HEAD" })).status, 200);
  // pas de sortie du dossier assets (chemins envoyés tels quels, sans normalisation)
  const http = await import("node:http");
  const brut = chemin => new Promise((ok, ko) => {
    const u = new URL(racine);
    http.get({ host: u.hostname, port: u.port, path: chemin }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => ok({ status: r.statusCode, corps: d })); }).on("error", ko);
  });
  for (const chemin of ["/assets/..%2f..%2fserveur%2fserver.mjs", "/assets/vendor/..%2f..%2fphp%2flib%2fapp.php",
                        "/assets/vendor/VERSIONS.txt", "/assets/vendor/xlsx/LICENSE"]){
    const r = await brut(chemin);
    assert.ok(r.status >= 400 || !/import |<\?php|xlsx 0\.|Apache License/.test(r.corps), "accès refusé : " + chemin + " (" + r.status + ")");
  }
});

test("journal d'activité : connexions, échecs, actions (sans contenu)", async () => {
  await client()("POST", "/api/login", { login: "admin", password: "mauvais-code" });
  const r = await admin("GET", "/api/audit");
  assert.equal(r.status, 200);
  const actions = r.data.map(l => l.action);
  for (const a of ["login", "login-echec", "create", "update"]) assert.ok(actions.includes(a), "action tracée : " + a);
  const echec = r.data.find(l => l.action === "login-echec" && l.utilisateur === "admin");
  assert.ok(echec, "échec rattaché au compte visé");
  for (const l of r.data) assert.deepEqual(Object.keys(l).sort(), ["action", "date", "fiche", "module", "utilisateur"], "aucun contenu de fiche");
});

// À garder en dernier : bloque l'adresse IP des tests.
test("limite globale par adresse IP (essais sur de nombreux comptes)", async () => {
  const c = client();
  // Les tests précédents ont déjà compté des échecs pour cette adresse : le blocage arrive
  // au plus tard au 31e échec, quels que soient les identifiants essayés.
  let essais = 0, statut = 401;
  while (statut === 401 && essais < 40){ statut = (await c("POST", "/api/login", { login: "inconnu" + essais, password: "x" })).status; essais++; }
  assert.equal(statut, 429, "blocage après " + essais + " essais");
  assert.ok(essais <= 31);
  // 31e essai, autre identifiant : bloqué même avec un compte et un code valides
  assert.equal((await c("POST", "/api/login", { login: "admin", password: PASS })).status, 429);
  const r = await admin("GET", "/api/audit");          // la session déjà ouverte reste utilisable
  assert.ok(r.data.some(l => l.action === "login-bloque"), "blocage tracé");
});
