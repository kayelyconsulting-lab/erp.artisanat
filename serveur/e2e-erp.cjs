#!/usr/bin/env node
// Test de bout en bout de l'ERP dans un navigateur (Playwright), sur la version PHP
// multi-sociétés (php -S). Vérifie la cohérence comptable après chaque opération.
//   node serveur/e2e-erp.cjs
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");

// Mode distant : KGP_E2E_URL=https://erp.exemple.com/<code-société> (société NEUVE, créée
// dans la console et jamais ouverte : le test crée son administrateur et des données d'essai).
const REMOTE = process.env.KGP_E2E_URL ? process.env.KGP_E2E_URL.replace(/\/+$/, "") : "";
const ROOT = path.resolve(__dirname, "..");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "kgp-e2e-"));
const port = 19000 + Math.floor(Math.random() * 900);
const R = REMOTE ? new URL(REMOTE).origin : `http://127.0.0.1:${port}`;
const SOCIETE_PATH = REMOTE ? new URL(REMOTE).pathname : "/demo";
let php = { kill(){} };
if (!REMOTE){
  fs.copyFileSync(path.join(ROOT, "kgpro.html"), path.join(ROOT, "php", "lib", "kgpro.html"));
  const logFd = fs.openSync(path.join(data, "php.log"), "a");
  php = spawn("php", ["-S", `127.0.0.1:${port}`, path.join(ROOT, "php", "dev-router.php")],
    { env: { ...process.env, KGP_DATA_DIR: data, PHP_CLI_SERVER_WORKERS: "6" }, stdio: ["ignore", "ignore", logFd] });
}

let passed = 0, browser = null, page = null;
function ok(label){ passed++; console.log("  ✓ " + label); }

(async () => {
  if (!REMOTE) await new Promise(r => setTimeout(r, 700));
  // Console + société de test (processus séparé : voir test-php.mjs)
  const prep = REMOTE ? { status: 0 } : spawnSync(process.execPath, ["-e", `
    (async () => {
      const fs = require("fs");
      await fetch(${JSON.stringify(R)} + "/console/api/status");
      const code = /^\\s{4}([A-F0-9]{10})$/m.exec(fs.readFileSync(${JSON.stringify(path.join(data, "CODE-CONSOLE.txt"))}, "utf8"))[1];
      const s = await fetch(${JSON.stringify(R)} + "/console/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, password: "Console-Kayely-2026" }) });
      const ck = s.headers.get("set-cookie").split(";")[0];
      const c = await fetch(${JSON.stringify(R)} + "/console/api/societes", { method: "POST", headers: { "Content-Type": "application/json", Cookie: ck }, body: JSON.stringify({ slug: "demo", nom: "Démo SARL" }) });
      if (!c.ok) process.exit(1);
    })();`], { stdio: "inherit" });
  assert.equal(prep.status, 0, "préparation");
  console.log("Préparation OK");

  browser = await chromium.launch();
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.route("**/*", r => r.request().url().startsWith(R) ? r.continue() : r.abort());
  await page.goto(R + SOCIETE_PATH + "/");
  await page.waitForSelector("#setupCard", { state: "visible" });
  await page.fill("#setupPass", "Admin-Demo-2026"); await page.fill("#setupPass2", "Admin-Demo-2026");
  await page.click("#setupCard button");
  await page.waitForFunction(() => document.getElementById("app").classList.contains("show"), null, { timeout: 60000 });
  await page.evaluate(() => { window.__toasts = []; const o = window.toast; window.toast = m => { window.__toasts.push(m); o(m); }; });
  const lastToast = () => page.evaluate(() => window.__toasts[window.__toasts.length - 1]);

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const journalStats = () => ev(async () => {
    const j = await getAll("journal");
    const d = j.reduce((s, e) => s + (Number(e.debit) || 0), 0), c = j.reduce((s, e) => s + (Number(e.credit) || 0), 0);
    return { n: j.length, debit: d, credit: c, equilibre: Math.abs(d - c) < 0.01 };
  });
  const assertEquilibre = async (label) => { const st = await journalStats(); assert.ok(st.equilibre, label + " : journal déséquilibré " + JSON.stringify(st)); return st; };
  // Remplit et enregistre un formulaire via l'interface
  async function saveViaForm(store, values, id, lignes){
    await ev(([s, i]) => openForm(s, i || undefined), [store, id]);
    await page.waitForSelector("#overlay.show");
    for (const [k, v] of Object.entries(values)){
      const tag = await page.$eval("#f_" + k, el => el.tagName);
      if (tag === "SELECT") await page.selectOption("#f_" + k, String(v)); else await page.fill("#f_" + k, String(v));
    }
    if (lignes) await lignes();
    await page.click("#overlay .modal-actions .btn.gold");
    await page.waitForTimeout(400);
  }

  console.log("Données de base");
  await saveViaForm("clients", { nom: "Client Alpha" });
  await saveViaForm("fournisseurs", { nom: "Fournisseur Beta" });
  await saveViaForm("articles", { designation: "Ciment 50kg", prixAchat: 4000, prixVente: 5500, stockMini: 2 });
  await saveViaForm("services", { designation: "Pose", prix: 20000 });
  await saveViaForm("rhEmployes", { nom: "Kouassi", salaireBase: 250000, contrat: "CDI", situationFamiliale: "Marié(e)", nombreEnfants: 2 });
  ok("client, fournisseur, article, service, employé créés");

  console.log("Facture d'achat -> entrée en stock + écritures");
  await saveViaForm("facturesAchat", { date: "2026-03-02", fournisseur: "Fournisseur Beta", montantRegle: 10000, modeReglement: "Banque" }, null, async () => {
    await page.selectOption("#lignesEditor select", "Ciment 50kg");
    const prix = await page.inputValue("#lignesEditor tbody tr:nth-child(1) td:nth-child(3) input");
    assert.equal(prix, "4000", "prix d'achat repris");
    const qty = page.locator("#lignesEditor tbody tr:nth-child(1) td:nth-child(2) input");
    await qty.fill(""); await qty.type("10");
    assert.equal(await qty.inputValue(), "10", "saisie continue de la quantité");
  });
  assert.equal(await ev(() => getArticleStock("Ciment 50kg")), 10);
  let st = await assertEquilibre("après achat");
  assert.equal(st.debit, 40000 * 1.18 + 10000);
  const soldeFour = await ev(() => getFournisseurSolde("Fournisseur Beta"));
  assert.equal(soldeFour, 40000 * 1.18 - 10000);
  ok("stock +10, journal équilibré, solde fournisseur " + soldeFour);

  console.log("Facture de vente avec ligne libre, règlement partiel");
  await saveViaForm("factures", { date: "2026-03-05", client: "Client Alpha", montantRegle: 5000, timbreQuittance: 100 }, null, async () => {
    await page.selectOption("#lignesEditor select", "Ciment 50kg");
    const qty = page.locator("#lignesEditor tbody tr:nth-child(1) td:nth-child(2) input");
    await qty.fill(""); await qty.type("3");
    await page.click("#lignesEditor button.btn");               // + Ajouter une ligne
    await page.selectOption("#lignesEditor tbody tr:nth-child(2) select", "__autre__");
    const libre = page.locator("#lignesEditor tbody tr:nth-child(2) td:nth-child(1) input");
    await libre.type("Transport chantier");
    assert.equal(await libre.inputValue(), "Transport chantier", "saisie libre continue");
    const pu = page.locator("#lignesEditor tbody tr:nth-child(2) td:nth-child(3) input");
    await pu.fill(""); await pu.type("2500");
    assert.equal(await page.inputValue("#f_montantHT"), String(3 * 5500 + 2500));
  });
  const fact = await ev(async () => (await getAll("factures"))[0]);
  assert.deepEqual(fact.lignes.map(l => l.designation), ["Ciment 50kg", "Transport chantier"]);
  assert.equal(await ev(() => getArticleStock("Ciment 50kg")), 7);
  st = await assertEquilibre("après vente");
  const ttc = 19000 * 1.18 + 100;
  assert.equal(await ev(() => getClientSolde("Client Alpha")), ttc - 5000);
  const ecrituresFacture = await ev(async n => (await getAll("journal")).filter(e => e.piece === n).length, fact.numero);
  ok(`facture ${fact.numero} : stock 7, solde client ${ttc - 5000}, ${ecrituresFacture} écritures (dont règlement)`);

  console.log("Modification de la facture : pas d'écritures en double");
  await saveViaForm("factures", { montantRegle: 8000 }, fact.id, async () => {
    const qty = page.locator("#lignesEditor tbody tr:nth-child(1) td:nth-child(2) input");
    await qty.fill(""); await qty.type("4");
  });
  const apres = await ev(async n => (await getAll("journal")).filter(e => e.piece === n).length, fact.numero);
  assert.equal(apres, ecrituresFacture, "même nombre d'écritures après modification");
  assert.equal(await ev(() => getArticleStock("Ciment 50kg")), 6);
  await assertEquilibre("après modification");
  const fact2 = await ev(async id => (await getAll("factures")).find(f => f.id === id), fact.id);
  assert.equal(fact2.numero, fact.numero, "numéro conservé");
  ok("écritures remplacées (" + apres + "), stock 6, numéro conservé");

  console.log("Avoir, devis -> facture");
  await saveViaForm("avoirs", { date: "2026-03-06", client: "Client Alpha", montantHT: 1000, factureRef: fact.numero });
  await saveViaForm("devis", { date: "2026-03-07", client: "Client Alpha", objet: "Chantier B", montantHT: 100000, statut: "Accepté" });
  const devis = await ev(async () => (await getAll("devis"))[0]);
  await ev(id => genererFactureDepuis("devis", id), devis.id);
  await page.waitForTimeout(300);
  const factDevis = await ev(async () => (await getAll("factures")).find(f => f.devisRef));
  assert.ok(factDevis && factDevis.lignes.length === 1 && factDevis.montantHT === 100000, "facture issue du devis avec ligne");
  await saveViaForm("devis", { objet: "Chantier B (révisé)" }, devis.id);
  assert.equal((await ev(async id => (await getAll("devis")).find(d => d.id === id), devis.id)).factureNumero, factDevis.numero, "lien devis->facture conservé à la modification");
  await ev(id => genererFactureDepuis("devis", id), devis.id);
  assert.equal(await ev(async () => (await getAll("factures")).length), 2, "pas de deuxième facture pour le même devis");
  await assertEquilibre("après avoir et devis");
  ok("avoir comptabilisé, facture " + factDevis.numero + " générée depuis le devis, pas de doublon");

  console.log("Caisse, paie, immobilisation");
  await saveViaForm("treso_caisse", { date: "2026-03-08", type: "Décaissement", motif: "Carburant", contrepartie: "6051", montant: 15000 });
  await saveViaForm("paieCalcul", { employe: "Kouassi", periode: "3/2026", salaireCategoriel: 250000, typeContrat: "CDI" });
  const bulletin = await ev(async () => (await getAll("paieCalcul"))[0]);
  assert.equal(bulletin.periode, "03/2026");
  const datePaie = await ev(async () => (await getAll("journal")).find(e => e.journalType === "OD-Paie").date);
  assert.equal(datePaie, "2026-03-31");
  await saveViaForm("paieCalcul", { employe: "Kouassi", periode: "03/2026", salaireCategoriel: 250000 });
  assert.match(await lastToast(), /existe déjà/);
  const nPaie = await ev(async () => (await getAll("journal")).filter(e => e.journalType === "OD-Paie").length);
  await saveViaForm("paieCalcul", { primeRendement: 10000 }, bulletin.id);
  assert.equal(await ev(async () => (await getAll("journal")).filter(e => e.journalType === "OD-Paie").length), nPaie, "bulletin modifié sans doublon");
  await saveViaForm("immobilisations", { designation: "Ordinateur", categorie: "Matériel informatique", dateAcquisition: "2026-01-15", valeurOrigineHT: 600000, dureeAns: 3, modePaiement: "Banque", compteContrepartie: "521" });
  const immo = await ev(async () => (await getAll("immobilisations"))[0]);
  await ev(id => postAmortissementAnnee("immobilisations", id, 2026), immo.id);
  await page.waitForTimeout(300);
  await saveViaForm("immobilisations", { designation: "Ordinateur portable" }, immo.id);
  const immo2 = await ev(async id => (await getAll("immobilisations")).find(i => i.id === id), immo.id);
  assert.deepEqual(immo2.anneesPostees, [2026], "dotation 2026 toujours marquée comptabilisée après modification");
  assert.equal(await ev(async () => (await getAll("journal")).filter(e => e.journalType === "IM-Immobilisations").length), 3, "acquisition non dupliquée");
  await assertEquilibre("après caisse, paie, immobilisation");
  ok("ticket, bulletin (date 2026-03-31, doublon refusé, modification sans doublon), immobilisation (dotation conservée)");

  console.log("Trésorerie cohérente");
  await saveViaForm("caisses", { nom: "Caisse principale", soldeInit: 50000 });
  const treso = await ev(() => computeTresorerie());
  // caisse : 50000 initial + 8000 encaissé (facture) - 15000 ticket ; banque : -10000 (achat) - 600000*1.18 (immo)
  assert.equal(treso.parCompte.find(c => c.label === "Caisse").value, 50000 + 8000 - 15000);
  assert.equal(treso.parCompte.find(c => c.label === "Banques").value, -10000 - 708000);
  ok("trésorerie : caisse " + (50000 + 8000 - 15000) + ", banques " + (-10000 - 708000));

  console.log("États financiers, TVA, pièce comptable, impressions");
  const ef = await ev(async () => computeEtatsFinanciers(await getAll("journal"), "2026-01-01", "2026-12-31"));
  assert.ok(Math.abs(ef.bilan.ecart) < 0.01, "bilan équilibré, écart " + ef.bilan.ecart);
  assert.equal(Math.round(ef.resultat.ca), 4 * 5500 + 2500 + 100000 - 1000, "CA = factures - avoir");
  const tva = await ev(async () => computeTva(await getAll("journal")));
  assert.equal(Math.round(tva.collectee), Math.round((24500 + 100000 - 1000) * 0.18));
  assert.equal(Math.round(tva.deductible), Math.round(40000 * 0.18 + 600000 * 0.18));
  await ev(() => openPieceForm()); await page.waitForSelector("#overlay.show");
  await page.fill("#pc_piece", "OD-LOYER-03"); await page.fill("#pc_date", "2026-03-31");
  const rows = page.locator("#pieceEditor tbody tr");
  await rows.nth(0).locator("td:nth-child(1) input").fill("6222"); await rows.nth(0).locator("td:nth-child(3) input").fill("150000");
  await rows.nth(1).locator("td:nth-child(1) input").fill("521"); await rows.nth(1).locator("td:nth-child(4) input").fill("140000");
  await page.click("#overlay .modal-actions .btn.gold"); await page.waitForTimeout(200);
  assert.match(await lastToast(), /déséquilibrée/);
  await rows.nth(1).locator("td:nth-child(4) input").fill("150000");
  await page.click("#overlay .modal-actions .btn.gold"); await page.waitForTimeout(500);
  assert.equal(await ev(async () => (await getAll("journal")).filter(e => e.piece === "OD-LOYER-03").length), 2);
  await assertEquilibre("après pièce multi-lignes");
  const [popup] = await Promise.all([page.waitForEvent("popup"), ev(async () => printReleveClient((await getAll("clients"))[0].id))]);
  await popup.waitForLoadState(); const releve = await popup.content(); await popup.close();
  assert.match(releve, /Relevé de compte client/); assert.match(releve, /francs? CFA/);
  const [popF] = await Promise.all([page.waitForEvent("popup"), ev(id => printFacture("factures", id), fact.id)]);
  await popF.waitForLoadState(); assert.match(await popF.content(), /Arrêtée la présente facture à la somme de/); await popF.close();
  ok("bilan équilibré, CA " + ef.resultat.ca + ", TVA due " + Math.round(tva.due) + ", pièce déséquilibrée refusée, relevé et facture en lettres");

  console.log("Clôture de période");
  await ev(async () => { const s = (await getAll("societe"))[0] || { id: 1 }; s.dateCloture = "2026-03-06"; await putRecord("societe", s); });
  await saveViaForm("avoirs", { motif: "modif interdite" }, await ev(async () => (await getAll("avoirs"))[0].id));
  assert.match(await lastToast(), /clôturée/);
  await ev(() => closeModal());
  const serveurRefuse = await ev(async () => { try { await putRecord("journal", { date: "2026-03-01", compte: "571", debit: 1, credit: 0 }); return "accepté"; } catch(e){ return e.message; } });
  assert.match(serveurRefuse, /clôturée/, "refus côté serveur");
  await ev(async () => { const s = (await getAll("societe"))[0]; s.dateCloture = ""; await putRecord("societe", s); });
  ok("modification d'une pièce du 06/03 refusée (application et serveur), période rouverte par l'administrateur");

  console.log("Suppression d'une facture : écritures, stock et lien devis retirés");
  await ev(id => removeRecord("factures", id), factDevis.id);
  await page.waitForTimeout(400);
  assert.equal(await ev(async n => (await getAll("journal")).filter(e => e.piece === n).length, factDevis.numero), 0);
  assert.equal((await ev(async id => (await getAll("devis")).find(d => d.id === id), devis.id)).factureNumero, undefined);
  await ev(id => removeRecord("factures", id), fact.id);
  await page.waitForTimeout(400);
  assert.equal(await ev(() => getArticleStock("Ciment 50kg")), 10, "stock restitué");
  await assertEquilibre("après suppressions");
  ok("écritures supprimées, stock restitué (10), devis de nouveau facturable");

  console.log("Sécurité : texte saisi jamais exécuté");
  await saveViaForm("clients", { nom: '<img src=x onerror="window.__xss=1">' });
  await ev(() => renderRoute("clients")); await page.waitForTimeout(300);
  await ev(() => openForm("factures")); await page.waitForTimeout(300);
  await ev(() => closeModal());
  assert.equal(await ev(() => window.__xss), undefined);
  ok("aucun code injecté exécuté (liste et formulaire)");

  console.log("Recherche : saisie continue");
  await ev(() => renderRoute("clients")); await page.waitForTimeout(200);
  await page.click("#content .search-box"); await page.keyboard.type("Alp", { delay: 80 });
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue("#content .search-box"), "Alp");
  ok("recherche « Alp » saisie sans perte du curseur");

  console.log("Tous les modules s'ouvrent sans erreur");
  const keys = await ev(() => SECTIONS.flatMap(s => s.modules.map(m => m.key)));
  for (const k of keys){
    await ev(k => renderRoute(k), k); await page.waitForTimeout(60);
    const m = await ev(k => MODULE_INDEX[k].mod, k);
    if (!m.readonly && !m.single){ await ev(k => openForm(k), k); await page.waitForTimeout(60); await ev(() => closeModal()); }
  }
  await ev(() => renderRoute("accueil")); await page.waitForTimeout(300);
  ok(keys.length + " modules et formulaires ouverts");

  console.log("Rôle Comptable : modifier une facture remplace ses écritures");
  await saveViaForm("utilisateurs", { nom: "Compta", login: "compta", motDePasse: "Compta-Init-2026", role: "Comptable", statut: "Actif" });
  const p2 = await ctx.newPage(); p2.on("pageerror", e => errors.push("compta: " + e.message)); p2.on("dialog", d => d.accept());
  await p2.route("**/*", r => r.request().url().startsWith(R) ? r.continue() : r.abort());
  await ev(() => logout());
  await p2.goto(R + SOCIETE_PATH + "/");
  await p2.fill("#loginUser", "compta"); await p2.fill("#loginPass", "Compta-Init-2026"); await p2.click("#loginCard button");
  await p2.waitForSelector("#setupCard", { state: "visible" });
  await p2.fill("#setupPass", "Compta-Perso-2026"); await p2.fill("#setupPass2", "Compta-Perso-2026"); await p2.click("#setupCard button");
  await p2.waitForFunction(() => document.getElementById("app").classList.contains("show"), null, { timeout: 60000 })
    .catch(async e => { throw new Error(e.message + " | écran : " + await p2.evaluate(() => [document.getElementById("setupError").textContent, document.getElementById("loginError").textContent, (document.getElementById("dbStatus")||{}).textContent].join(" / "))); });
  await p2.evaluate(() => openForm("factures")); await p2.waitForSelector("#overlay.show");
  await p2.fill("#f_date", "2026-03-20"); await p2.selectOption("#f_client", "Client Alpha");
  await p2.selectOption("#lignesEditor select", "Pose");
  await p2.click("#overlay .modal-actions .btn.gold"); await p2.waitForTimeout(500);
  const f3 = await p2.evaluate(async () => (await getAll("factures")).slice(-1)[0]);
  const n3 = await p2.evaluate(async n => (await getAll("journal")).filter(e => e.piece === n).length, f3.numero);
  await p2.evaluate(id => openForm("factures", id), f3.id); await p2.waitForSelector("#overlay.show");
  await p2.fill("#f_montantRegle", "1000");
  await p2.click("#overlay .modal-actions .btn.gold"); await p2.waitForTimeout(600);
  const n3b = await p2.evaluate(async n => (await getAll("journal")).filter(e => e.piece === n).length, f3.numero);
  assert.equal(n3b, n3 + 2, "règlement ajouté, rien en double");
  const st3 = await p2.evaluate(async () => { const j = await getAll("journal"); return Math.abs(j.reduce((s,e)=>s+e.debit-e.credit,0)); });
  assert.ok(st3 < 0.01, "journal équilibré");
  ok("facture modifiée par le Comptable : " + n3 + " -> " + n3b + " écritures, journal équilibré");

  assert.deepEqual(errors, [], "aucune erreur JavaScript");
  ok("aucune erreur JavaScript");
  if (!REMOTE){
    const log = fs.readFileSync(path.join(data, "php.log"), "utf8").split("\n").filter(l => /Fatal|Warning|Deprecated|Notice/.test(l));
    assert.deepEqual(log, [], "aucun avertissement PHP");
    ok("aucun avertissement PHP");
  }
  console.log(`\n${passed} vérifications réussies`);
  await browser.close();
})().catch(async e => {
  console.error("\n✗ ÉCHEC :", e.message);
  if (page) console.error("Derniers messages :", await page.evaluate(() => (window.__toasts || []).slice(-4)).catch(() => "?"));
  try{ console.error("Journal PHP :\n" + fs.readFileSync(path.join(data, "php.log"), "utf8").split("\n").filter(l => /KGP|Fatal|Warning|error/i.test(l)).slice(-15).join("\n")); }catch(_){}
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  php.kill(); fs.rmSync(data, { recursive: true, force: true });
});
