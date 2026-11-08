// Prix et totaux calculés par le serveur.
// Le navigateur propose ; le serveur décide :
//  - factures de vente : prix du catalogue (articles, services) imposé sur les lignes
//    correspondantes, sauf pour l'administrateur et le gérant (remises, prix négociés) ;
//  - factures, factures d'achat, avoirs : HT, TVA et TTC (timbre compris) recalculés ;
//  - acompte (montantRegle) + règlements déjà saisis : jamais au-delà du TTC ;
//  - règlements : la facture existe, est du bon type, et le montant ne dépasse pas le
//    reste dû ; facture liée et tiers renseignés par le serveur.
// Le même code existe en PHP (php/lib/montants.php) : les deux serveurs passent les mêmes tests.
import { ValidationError } from "./validation.mjs";

const TOLERANCE = 0.005;
export const arrondi = x => Math.round((Number(x) || 0) * 100) / 100;
const num = x => Number(x) || 0;
const fmt = x => arrondi(x).toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/ | /g, " ");

export function totauxFacture(f){
  const ht = num(f.montantHT), tva = ht * num(f.tvaPct) / 100, timbre = num(f.timbreQuittance);
  return { ht, tva, timbre, ttc: ht + tva + timbre };
}

/* Catalogue de vente : désignation → prix HT (seuls les prix renseignés comptent). */
function catalogueVente(all){
  const prix = new Map();
  for (const s of all("services")) if (typeof s.designation === "string" && num(s.prix) > 0) prix.set(s.designation.trim(), num(s.prix));
  for (const a of all("articles")) if (typeof a.designation === "string" && num(a.prixVente) > 0) prix.set(a.designation.trim(), num(a.prixVente));
  return prix;
}

const totalReglements = (all, champ, numero, saufId) => all("reglements")
  .filter(r => r[champ] === numero && r.id !== saufId)
  .reduce((s, r) => s + num(r.montant), 0);

/**
 * Applique les règles de prix et de montants à `record` (déjà validé) avant écriture.
 * ctx : { all(store), existing, id, privilegie (admin ou gérant) }.
 * Retourne la liste des lignes dont le prix a été corrigé (pour en informer l'utilisateur).
 */
export function appliquerMontants(store, record, ctx){
  const corriges = [];
  if (store === "factures" || store === "facturesAchat"){
    if (store === "factures" && !ctx.privilegie){
      const catalogue = catalogueVente(ctx.all);
      // Une ligne déjà présente telle quelle sur la facture enregistrée garde son prix
      // (prix du catalogue modifié depuis, ou prix accordé par le gérant).
      const anciennes = new Set((ctx.existing && Array.isArray(ctx.existing.lignes) ? ctx.existing.lignes : [])
        .map(l => l && `${l.designation}\u0000${num(l.prixUnitaire)}`));
      for (const l of record.lignes){
        const prix = catalogue.get(l.designation);
        if (prix === undefined || Math.abs(prix - l.prixUnitaire) < TOLERANCE) continue;
        if (anciennes.has(`${l.designation}\u0000${l.prixUnitaire}`)) continue;
        corriges.push({ designation: l.designation, saisi: l.prixUnitaire, catalogue: prix });
        l.prixUnitaire = prix;
        l.montant = l.quantite * prix;
      }
      if (corriges.length) record.montantHT = record.lignes.reduce((s, l) => s + l.montant, 0);
    }
    const t = totauxFacture(record);
    record.montantTVA = arrondi(t.tva);
    record.montantTTC = arrondi(t.ttc);
    const champ = store === "factures" ? "factureVente" : "factureAchat";
    const deja = record.numero ? totalReglements(ctx.all, champ, record.numero, 0) : 0;
    const acompte = num(record.montantRegle);
    if (acompte > t.ttc + TOLERANCE){
      throw new ValidationError([`${store === "factures" ? "Encaissé" : "Payé"} à la création (${fmt(acompte)}) supérieur au total TTC (${fmt(t.ttc)})`]);
    }
    if (acompte + deja > t.ttc + TOLERANCE){
      throw new ValidationError([`Total TTC (${fmt(t.ttc)}) inférieur aux montants déjà réglés sur cette facture (${fmt(acompte + deja)})`]);
    }
  } else if (store === "avoirs"){
    const ht = num(record.montantHT), tva = ht * num(record.tvaPct) / 100;
    record.montantTVA = arrondi(tva);
    record.montantTTC = arrondi(ht + tva);
    if (record.factureRef){
      const f = ctx.all("factures").find(x => x.numero === record.factureRef);
      if (!f) throw new ValidationError([`Facture liée : « ${record.factureRef} » n'existe pas`]);
      if (record.client && f.client && record.client !== f.client) throw new ValidationError([`La facture ${f.numero} est au nom de « ${f.client} », pas de « ${record.client} »`]);
      const autres = ctx.all("avoirs").filter(a => a.factureRef === f.numero && a.id !== ctx.id)
        .reduce((s, a) => s + num(a.montantHT) * (1 + num(a.tvaPct) / 100), 0);
      const ttcFacture = totauxFacture(f).ttc;
      if (autres + ht + tva > ttcFacture + TOLERANCE){
        throw new ValidationError([`Avoirs sur ${f.numero} (${fmt(autres + ht + tva)}) supérieurs au total TTC de la facture (${fmt(ttcFacture)})`]);
      }
    }
  } else if (store === "reglements"){
    const vente = record.type !== "Paiement fournisseur";
    const champ = vente ? "factureVente" : "factureAchat";
    const numero = record[champ];
    record[vente ? "factureAchat" : "factureVente"] = "";
    if (!numero) throw new ValidationError([vente ? "Choisissez la facture de vente encaissée" : "Choisissez la facture d'achat payée"]);
    const facture = ctx.all(vente ? "factures" : "facturesAchat").find(f => f.numero === numero);
    if (!facture) throw new ValidationError([`Facture ${numero} introuvable`]);
    const montant = num(record.montant);
    if (!(montant > 0)) throw new ValidationError(["Le montant du règlement doit être supérieur à 0"]);
    const reste = totauxFacture(facture).ttc - num(facture.montantRegle) - totalReglements(ctx.all, champ, numero, ctx.id);
    if (montant > reste + TOLERANCE) throw new ValidationError([`Montant supérieur au reste dû sur ${numero} (${fmt(Math.max(0, reste))})`]);
    record.factureRef = numero;
    record.tiers = (vente ? facture.client : facture.fournisseur) || "";
  }
  return corriges;
}

export const MODULES_MONTANTS = new Set(["factures", "facturesAchat", "avoirs", "reglements"]);
