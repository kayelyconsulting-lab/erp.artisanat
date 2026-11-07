// Tests du mode plusieurs sociétés (version PHP). Lancés par serveur/test-php.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
  assert.equal((await consoleClient("POST", "/console/api/societes", { slug: "alpha", nom: "Alpha SARL" })).status, 200);
  assert.equal((await consoleClient("POST", "/console/api/societes", { slug: "beta", nom: "Beta SA" })).status, 200);
  assert.equal((await consoleClient("POST", "/console/api/societes", { slug: "alpha", nom: "Doublon" })).status, 422);
  assert.ok(fs.existsSync(path.join(DATA, "societes", "alpha.sqlite")));
  assert.ok(fs.existsSync(path.join(DATA, "societes", "beta.sqlite")));
});

test("chaque société a sa propre base, sans interférence", { skip }, async () => {
  const a = client(), b = client();
  assert.equal((await a("POST", "/alpha/api/setup", { login: "admin", password: "Alpha-Secret-2026" })).status, 200);
  assert.equal((await b("POST", "/beta/api/setup", { login: "admin", password: "Beta-Secret-2026" })).status, 200);

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
