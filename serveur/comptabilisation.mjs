// Comptabilisation côté serveur — tranche 1 : ventes, achats, trésorerie, avoirs, règlements,
// virements. Le serveur génère (et régénère) lui-même les écritures du journal et les mouvements
// de stock liés à une pièce, dans la même transaction que la pièce. Le navigateur ne les calcule
// plus en mode serveur : le grand livre ne peut donc plus être désynchronisé des pièces.
// La paie et les immobilisations restent calculées par le navigateur (tranche 2).
// Même logique que la fonction `comptabiliser` de kgpro.html (conservée pour le mode local).
// Portage PHP : php/lib/comptabilisation.php — les deux serveurs passent les mêmes tests.

const SPECIAL = {
  factures: "factures", avoirs: "avoirs", facturesAchat: "facturesAchat",
  stockEntrees: "stockEntree", treso_caisse: "treso", reglements: "reglement", virementsInternes: "virement",
};
export const MODULES_COMPTA = new Set(Object.keys(SPECIAL));
const num = x => Number(x) || 0;
const journalSource = (store, id) => store + "#" + id;

function anciennesPieces(store, record){
  switch (store){
    case "factures": return { pieces: [record.numero], journaux: ["VE-Ventes"] };
    case "avoirs": return { pieces: [record.numero], journaux: ["VE-Ventes"] };
    case "facturesAchat": return { pieces: [record.numero], journaux: ["AC-Achats"] };
    case "stockEntrees": return { pieces: ["STK-" + record.id], journaux: ["AC-Achats"] };
    case "treso_caisse": return { pieces: [record.numero], journaux: ["BQ/CA", "CA-Caisse"] };
    default: return null;
  }
}

function comptesTresorerie(db){
  return [
    ...db.all("caisses").map(c => ({ type: "Caisse", nom: c.nom, compte: String(c.compteOhada || "571").trim() })),
    ...db.all("banques").map(b => ({ type: "Banque", nom: b.nom, compte: String(b.compteOhada || "521").trim() })),
  ];
}
function resoudreTresorerie(comptes, nom, mode){
  const t = nom && comptes.find(c => c.nom === nom);
  if (t) return { compte: t.compte, journal: t.type === "Banque" ? "BQ-Banque" : "CA-Caisse" };
  const banque = mode === "Banque";
  return { compte: banque ? "521" : "571", journal: banque ? "BQ-Banque" : "CA-Caisse" };
}
function lignesReglement(record, achat, comptes){
  const regle = num(record.montantRegle);
  if (regle <= 0) return [];
  const treso = resoudreTresorerie(comptes, record.compteTreso, record.modeReglement).compte;
  return achat
    ? [{ compte: "401", libelle: "Règlement " + (record.fournisseur || ""), debit: regle, credit: 0 },
       { compte: treso, libelle: "Règlement " + (record.fournisseur || ""), debit: 0, credit: regle }]
    : [{ compte: treso, libelle: "Encaissement " + (record.client || ""), debit: regle, credit: 0 },
       { compte: "411", libelle: "Encaissement " + (record.client || ""), debit: 0, credit: regle }];
}

/* Supprime les écritures déjà générées pour une pièce (par « source », ou ancien format par pièce). */
function supprimerEcritures(db, store, record, avecSousPieces, userId){
  const source = journalSource(store, record.id);
  const legacy = anciennesPieces(store, record);
  const legacyPieces = legacy ? legacy.pieces.filter(Boolean) : [];
  for (const r of db.all("journal")){
    let cible;
    if (r.source) cible = r.source === source || (avecSousPieces && r.source.startsWith(source + "#"));
    else cible = !!legacy && legacyPieces.includes(r.piece) && legacy.journaux.includes(r.journalType);
    if (cible && db.delete("journal", r.id)) db.audit(userId, "delete", "journal", r.id);
  }
}
function postJournal(db, date, journalType, piece, lignes, source, userId){
  for (const l of lignes){
    if (!l.compte || (!l.debit && !l.credit)) continue;
    const id = db.nextId("journal");
    db.put("journal", id, { date, journalType, piece, compte: String(l.compte).trim(), libelle: l.libelle || "", debit: l.debit || 0, credit: l.credit || 0, source }, userId);
    db.audit(userId, "create", "journal", id);
  }
}

/* Mouvements de stock liés à une facture (vente -> sorties, achat -> entrées), régénérés à chaque
   enregistrement (champ « auto » : repérés et remplacés, jamais cumulés). */
function syncStock(db, store, record, userId){
  const cible = store === "factures" ? "stockSorties" : "stockEntrees";
  const champ = store === "factures" ? "factureRef" : "factureAchatRef";
  const articleNames = new Set(db.all("articles").map(a => a.designation));
  for (const s of db.all(cible)) if (s[champ] === record.numero && s.auto === true && db.delete(cible, s.id)) db.audit(userId, "delete", cible, s.id);
  for (const l of (Array.isArray(record.lignes) ? record.lignes : [])){
    if (!articleNames.has(l.designation) || !(num(l.quantite) > 0)) continue;
    const id = db.nextId(cible);
    const base = store === "factures"
      ? { date: record.date, motif: "Vente", article: l.designation, quantite: num(l.quantite), prixUnitaire: num(l.prixUnitaire), factureRef: record.numero, auto: true }
      : { date: record.date, fournisseur: record.fournisseur, article: l.designation, quantite: num(l.quantite), prixUnitaire: num(l.prixUnitaire), tvaPct: num(record.tvaPct), factureAchatRef: record.numero, auto: true };
    db.put(cible, id, base, userId);
    db.audit(userId, "create", cible, id);
  }
}

/* Génère (ou régénère) les écritures et mouvements d'une pièce, dans la transaction courante. */
export function comptabiliser(db, store, record, userId, modCompte){
  const special = SPECIAL[store];
  if (!special) return;
  supprimerEcritures(db, store, record, false, userId);
  const comptesT = comptesTresorerie(db);
  const src = journalSource(store, record.id);
  const post = (date, jt, piece, lignes) => postJournal(db, date, jt, piece, lignes, src, userId);

  if (special === "factures"){
    const ht = num(record.montantHT), tva = ht * num(record.tvaPct) / 100, timbre = num(record.timbreQuittance), ttc = ht + tva + timbre;
    post(record.date, "VE-Ventes", record.numero, [
      { compte: "411", libelle: "Client " + (record.client || ""), debit: ttc, credit: 0 },
      { compte: "701", libelle: "Vente " + (record.client || ""), debit: 0, credit: ht },
      ...(tva > 0 ? [{ compte: "4431", libelle: "TVA facturée", debit: 0, credit: tva }] : []),
      ...(timbre > 0 ? [{ compte: "4472", libelle: "Timbre de quittance à reverser", debit: 0, credit: timbre }] : []),
    ]);
    const tf = resoudreTresorerie(comptesT, record.compteTreso, record.modeReglement);
    post(record.date, tf.journal, record.numero, lignesReglement(record, false, comptesT));
    syncStock(db, "factures", record, userId);
  } else if (special === "avoirs"){
    const ht = num(record.montantHT), tva = ht * num(record.tvaPct) / 100, ttc = ht + tva;
    post(record.date, "VE-Ventes", record.numero, [
      { compte: "701", libelle: "Avoir " + (record.client || ""), debit: ht, credit: 0 },
      ...(tva > 0 ? [{ compte: "4431", libelle: "TVA sur avoir", debit: tva, credit: 0 }] : []),
      { compte: "411", libelle: "Client " + (record.client || ""), debit: 0, credit: ttc },
    ]);
  } else if (special === "facturesAchat"){
    const ht = num(record.montantHT), tva = ht * num(record.tvaPct) / 100, timbre = num(record.timbreQuittance), ttc = ht + tva + timbre;
    post(record.date, "AC-Achats", record.numero, [
      { compte: "601", libelle: "Achat " + (record.fournisseur || ""), debit: ht, credit: 0 },
      ...(tva > 0 ? [{ compte: "4452", libelle: "TVA récupérable sur achats", debit: tva, credit: 0 }] : []),
      ...(timbre > 0 ? [{ compte: "646", libelle: "Droits de timbre (quittance)", debit: timbre, credit: 0 }] : []),
      { compte: "401", libelle: "Fournisseur " + (record.fournisseur || ""), debit: 0, credit: ttc },
    ]);
    const ta = resoudreTresorerie(comptesT, record.compteTreso, record.modeReglement);
    post(record.date, ta.journal, record.numero, lignesReglement(record, true, comptesT));
    syncStock(db, "facturesAchat", record, userId);
  } else if (special === "stockEntree"){
    if (record.auto) return;
    const ht = num(record.quantite) * num(record.prixUnitaire), tva = ht * num(record.tvaPct) / 100;
    post(record.date, "AC-Achats", "STK-" + record.id, [
      { compte: "601", libelle: "Achat " + (record.article || ""), debit: ht, credit: 0 },
      ...(tva > 0 ? [{ compte: "4452", libelle: "TVA récupérable", debit: tva, credit: 0 }] : []),
      { compte: "401", libelle: "Fournisseur " + (record.fournisseur || ""), debit: 0, credit: ht + tva },
    ]);
  } else if (special === "reglement"){
    const montant = num(record.montant);
    const t = resoudreTresorerie(comptesT, record.compteTreso, record.modeReglement);
    const libelle = "Règlement " + (record.factureRef || "") + " " + (record.tiers || "") + (record.moyen ? " (" + record.moyen + ")" : "");
    const lignes = record.type === "Paiement fournisseur"
      ? [{ compte: "401", libelle, debit: montant, credit: 0 }, { compte: t.compte, libelle, debit: 0, credit: montant }]
      : [{ compte: t.compte, libelle, debit: montant, credit: 0 }, { compte: "411", libelle, debit: 0, credit: montant }];
    post(record.date, t.journal, record.numero, lignes);
  } else if (special === "virement"){
    const montant = num(record.montant);
    const de = resoudreTresorerie(comptesT, record.source), vers = resoudreTresorerie(comptesT, record.destination);
    const libelle = "Virement " + (record.source || "") + " → " + (record.destination || "") + (record.motif ? " — " + record.motif : "");
    post(record.date, "BQ-Banque", record.numero, [
      { compte: vers.compte, libelle, debit: montant, credit: 0 },
      { compte: de.compte, libelle, debit: 0, credit: montant },
    ]);
  } else if (special === "treso"){
    const montant = num(record.montant);
    const compteTreso = record.caisse ? resoudreTresorerie(comptesT, record.caisse).compte : (modCompte || "571");
    const lignes = record.type === "Encaissement"
      ? [{ compte: compteTreso, libelle: record.motif, debit: montant, credit: 0 }, { compte: record.contrepartie, libelle: record.motif, debit: 0, credit: montant }]
      : [{ compte: record.contrepartie, libelle: record.motif, debit: montant, credit: 0 }, { compte: compteTreso, libelle: record.motif, debit: 0, credit: montant }];
    post(record.date, "CA-Caisse", record.numero, lignes);
  }
}

/* Suppression d'une pièce : retire ses écritures, ses mouvements de stock automatiques, et délie
   le devis d'origine. Appelée dans la transaction de suppression. */
export function supprimerComptabilisation(db, store, record, userId){
  if (!SPECIAL[store]) return;
  supprimerEcritures(db, store, record, true, userId);
  if (store === "factures"){
    for (const s of db.all("stockSorties")) if (s.factureRef === record.numero && s.auto === true && db.delete("stockSorties", s.id)) db.audit(userId, "delete", "stockSorties", s.id);
    for (const d of db.all("devis")) if (d.factureNumero === record.numero){ const { factureNumero, id, ...rest } = d; db.put("devis", d.id, rest, userId); db.audit(userId, "update", "devis", d.id); }
  } else if (store === "facturesAchat"){
    for (const e of db.all("stockEntrees")) if (e.factureAchatRef === record.numero && e.auto === true && db.delete("stockEntrees", e.id)) db.audit(userId, "delete", "stockEntrees", e.id);
  }
}

/* Une facture encore liée à des règlements ne peut pas être supprimée (le règlement resterait
   orphelin). Renvoie le message d'erreur, ou "" si la suppression est possible. */
export function blocageSuppression(db, store, record){
  if (store !== "factures" && store !== "facturesAchat") return "";
  const champ = store === "factures" ? "factureVente" : "factureAchat";
  const lies = db.all("reglements").filter(r => r[champ] && r[champ] === record.numero);
  return lies.length ? `Cette facture a ${lies.length} règlement(s) (${lies.map(r => r.numero).join(", ")}) : supprimez-les d'abord.` : "";
}
