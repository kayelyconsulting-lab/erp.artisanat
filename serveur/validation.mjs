// Vérification côté serveur de CHAQUE enregistrement avant écriture.
// Les règles viennent de la définition des modules (SECTIONS de kgpro.html) :
// type de chaque champ, champs obligatoires, listes de choix, références vers
// d'autres tables, plus des limites de taille et des règles métier communes.

export class ValidationError extends Error {
  constructor(errors){ super(errors.join(" ; ")); this.errors = errors; this.status = 422; }
}

export const LIMITS = {
  text: 2000,          // caractères par champ texte
  extraString: 5000,   // caractères pour une valeur hors schéma
  image: 3_000_000,    // octets max d'une image (data URL)
  lignes: 500,         // lignes max d'une facture / facture d'achat
  extraArray: 1000,
  depth: 4,
  amount: 1e13,        // valeur absolue max d'un nombre
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

function isValidDate(s){
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Règles numériques : pourcentages entre 0 et 100, soldes éventuellement négatifs,
// tout le reste (montants, quantités, durées...) positif ou nul.
function numberRule(key){
  if (/^(taux|tva)/i.test(key) || /Pct$/.test(key)) return { min: 0, max: 100 };
  if (/^solde/i.test(key)) return { min: -LIMITS.amount, max: LIMITS.amount };
  return { min: 0, max: LIMITS.amount };
}

function checkNumber(key, v, label, errors){
  if (typeof v !== "number" || !Number.isFinite(v)){ errors.push(`${label} : nombre attendu`); return; }
  const { min, max } = numberRule(key);
  if (v < min || v > max) errors.push(`${label} : doit être compris entre ${min} et ${max}`);
}

// Valeurs hors schéma (numero, planAmortissement, factureRef...) : on vérifie leur forme
// (types JSON simples, tailles, profondeur) faute de règle plus précise.
function checkExtra(v, path, depth, errors){
  if (v === null || typeof v === "boolean") return;
  if (typeof v === "number"){ if (!Number.isFinite(v) || Math.abs(v) > LIMITS.amount) errors.push(`${path} : nombre invalide`); return; }
  if (typeof v === "string"){ if (v.length > LIMITS.extraString) errors.push(`${path} : texte trop long`); return; }
  if (depth >= LIMITS.depth){ errors.push(`${path} : structure trop imbriquée`); return; }
  if (Array.isArray(v)){
    if (v.length > LIMITS.extraArray) errors.push(`${path} : trop d'éléments`);
    v.forEach((x, i) => checkExtra(x, `${path}[${i}]`, depth + 1, errors));
    return;
  }
  if (isPlainObject(v)){
    for (const [k, x] of Object.entries(v)){
      if (!KEY_RE.test(k) || FORBIDDEN_KEYS.has(k)){ errors.push(`${path} : nom de champ invalide`); continue; }
      checkExtra(x, `${path}.${k}`, depth + 1, errors);
    }
    return;
  }
  errors.push(`${path} : type de valeur non autorisé`);
}

/**
 * Vérifie et normalise un enregistrement.
 * @param mod       module (issu de SECTIONS)
 * @param input     enregistrement reçu du client
 * @param ctx       { existing, lookup(store, field) => Set de valeurs, numeroTaken(numero, id) }
 * @returns         l'enregistrement nettoyé (sans l'id, sans le mot de passe)
 */
export function validateRecord(mod, input, ctx){
  const errors = [];
  if (!isPlainObject(input)) throw new ValidationError(["Enregistrement invalide"]);
  const existing = ctx.existing || null;
  const out = {};
  const declared = new Map(mod.fields.map(f => [f.k, f]));

  for (const f of mod.fields){
    const label = f.l || f.k;
    let v = input[f.k];
    if (f.t === "password") continue; // traité à part (hachage), jamais stocké en clair
    if (f.readonly) continue;         // recalculé ci-dessous, la valeur du client est ignorée

    if (v === undefined || v === null){
      v = f.t === "number" ? (f.def ?? 0) : "";
    }
    switch (f.t){
      case "number":
        if (v === "") v = f.def ?? 0;
        checkNumber(f.k, v, label, errors);
        break;
      case "date":
        if (typeof v !== "string" || (v !== "" && !isValidDate(v))) errors.push(`${label} : date invalide (AAAA-MM-JJ)`);
        break;
      case "select":
        if (typeof v !== "string" || (v !== "" && !(f.opts || []).includes(v))) errors.push(`${label} : valeur non autorisée`);
        break;
      case "dynselect": {
        if (typeof v !== "string" || v.length > LIMITS.text){ errors.push(`${label} : valeur invalide`); break; }
        // La valeur doit désigner une fiche existante (sauf si elle n'a pas changé :
        // la fiche liée a pu être renommée depuis).
        const unchanged = existing && existing[f.k] === v;
        if (v !== "" && !unchanged && !ctx.lookup(f.source, f.labelField).has(v)){
          errors.push(`${label} : « ${v} » n'existe pas`);
        }
        break;
      }
      case "tresoselect": {
        // Caisse ou banque précise : doit exister parmi les caisses ou les banques.
        if (typeof v !== "string" || v.length > LIMITS.text){ errors.push(`${label} : valeur invalide`); break; }
        const unchanged = existing && existing[f.k] === v;
        if (v !== "" && !unchanged && !ctx.lookup("caisses", "nom").has(v) && !ctx.lookup("banques", "nom").has(v)){
          errors.push(`${label} : la caisse ou banque « ${v} » n'existe pas`);
        }
        break;
      }
      case "image":
        if (typeof v !== "string" || (v !== "" && !IMAGE_RE.test(v))) errors.push(`${label} : image invalide`);
        else if (v.length > LIMITS.image) errors.push(`${label} : image trop volumineuse`);
        break;
      default: // text
        if (typeof v === "number" && Number.isFinite(v)) v = String(v); // ex. import Excel
        if (typeof v !== "string") errors.push(`${label} : texte attendu`);
        else { v = v.trim(); if (v.length > LIMITS.text) errors.push(`${label} : texte trop long`); }
    }
    if (f.req && (v === "" || v === undefined)) errors.push(`${label} : champ obligatoire`);
    out[f.k] = v;
  }

  // Lignes de facture : contrôlées et montants recalculés par le serveur.
  if (mod.hasLignes){
    const lignes = input.lignes;
    if (!Array.isArray(lignes) || lignes.length === 0) errors.push("Au moins une ligne est obligatoire");
    else if (lignes.length > LIMITS.lignes) errors.push("Trop de lignes");
    else {
      out.lignes = lignes.map((l, i) => {
        const n = i + 1;
        if (!isPlainObject(l)){ errors.push(`Ligne ${n} : invalide`); return null; }
        const designation = typeof l.designation === "string" ? l.designation.trim() : "";
        if (!designation) errors.push(`Ligne ${n} : désignation obligatoire`);
        if (designation.length > LIMITS.text) errors.push(`Ligne ${n} : désignation trop longue`);
        checkNumber("quantite", l.quantite, `Ligne ${n} — quantité`, errors);
        checkNumber("prixUnitaire", l.prixUnitaire, `Ligne ${n} — prix unitaire`, errors);
        if (!(l.quantite > 0)) errors.push(`Ligne ${n} : la quantité doit être supérieure à 0`);
        const quantite = Number(l.quantite) || 0, prixUnitaire = Number(l.prixUnitaire) || 0;
        const montant = quantite * prixUnitaire;
        checkNumber("montant", montant, `Ligne ${n} — montant`, errors);
        return { designation, quantite, prixUnitaire, montant };
      });
      if (!errors.length){
        out.montantHT = out.lignes.reduce((s, l) => s + l.montant, 0);
        checkNumber("montantHT", out.montantHT, "Montant HT total", errors);
      }
    }
  } else {
    for (const f of mod.fields) if (f.readonly && f.t === "number"){
      const v = input[f.k] ?? 0;
      checkNumber(f.k, v, f.l || f.k, errors);
      out[f.k] = v;
    }
  }

  // Champs hors schéma ajoutés par l'application (numero, factureRef, auto, planAmortissement...).
  for (const [k, v] of Object.entries(input)){
    if (k === "id" || declared.has(k) || (mod.hasLignes && k === "lignes")) continue;
    if (k === "motDePasseHash" || k === "totpSecret" || k === "totpPending") { errors.push(`Champ interdit : ${k}`); continue; }
    if (!KEY_RE.test(k) || FORBIDDEN_KEYS.has(k)){ errors.push(`Nom de champ invalide : ${k.slice(0, 40)}`); continue; }
    checkExtra(v, k, 1, errors);
    out[k] = typeof v === "string" ? v.trim() : v;
  }

  // Numérotation des pièces : format attendu et unicité.
  if (ctx.numeroPrefix && out.numero !== undefined && out.numero !== ""){
    if (typeof out.numero !== "string" || !out.numero.startsWith(ctx.numeroPrefix + "-")) errors.push("Numéro de pièce invalide");
    else if (ctx.numeroTaken(out.numero)) errors.push(`Le numéro ${out.numero} est déjà utilisé`);
  }

  // Écritures du journal : une ligne est soit au débit, soit au crédit.
  if (mod.key === "journal" && out.debit > 0 && out.credit > 0) errors.push("Une écriture ne peut pas être à la fois au débit et au crédit");

  if (errors.length) throw new ValidationError(errors);
  return out;
}
