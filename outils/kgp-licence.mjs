#!/usr/bin/env node
// Générateur de licences KAYELY GESTION PRO (usage interne Kayely Group).
//
// La clé PRIVÉE de signature n'est jamais dans le code ni dans le dépôt git :
// elle est lue depuis un fichier (par défaut ~/.kayely/kgp-licence-privee.pem)
// ou depuis la variable d'environnement KGP_LICENSE_PRIVATE_KEY_FILE.
//
//   node outils/kgp-licence.mjs init [--html kgpro.html] [--cle chemin.pem]
//       Crée la paire de clés (une seule fois), affiche la clé publique et,
//       avec --html, l'inscrit dans l'application.
//   node outils/kgp-licence.mjs generer --structure "Cabinet ABC SARL" --expiration 2027-12-31
//       Produit une clé de licence KGP2 pour cette structure.
//   node outils/kgp-licence.mjs publique
//       Réaffiche la clé publique correspondant à la clé privée.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function fail(msg){ console.error("Erreur : " + msg); process.exit(1); }

function args(argv){
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++){
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else out._.push(argv[i]);
  }
  return out;
}

function keyPath(opts){
  return path.resolve(opts.cle || process.env.KGP_LICENSE_PRIVATE_KEY_FILE
    || path.join(os.homedir(), ".kayely", "kgp-licence-privee.pem"));
}

// Refuse de stocker la clé privée dans un dépôt git (risque de commit/push).
function assertOutsideGit(file){
  let dir = path.dirname(file);
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  let top = "";
  try{
    top = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"],
      { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  }catch(e){ /* pas un dépôt git (ou git absent) : OK */ }
  if (top) fail(`la clé privée ne doit pas se trouver dans un dépôt git (${top}). Choisissez un chemin hors du dépôt.`);
}

function loadPrivateKey(opts){
  const file = keyPath(opts);
  if (!fs.existsSync(file)) fail(`clé privée introuvable : ${file}\nLancez d'abord : node outils/kgp-licence.mjs init`);
  assertOutsideGit(file);
  return crypto.createPrivateKey(fs.readFileSync(file));
}

function publicKeyB64url(privateKey){
  const der = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("base64url");
}

export function normalizeCompany(name){
  return (name || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function signLicense(privateKey, company, expiry){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry || "");
  if (!m) fail("--expiration attendu au format AAAA-MM-JJ");
  if (!normalizeCompany(company)) fail("--structure est obligatoire");
  const yymmdd = m[1].slice(2) + m[2] + m[3];
  const msg = Buffer.from("KGP2|" + normalizeCompany(company) + "|" + yymmdd, "utf8");
  return "KGP2-" + yymmdd + "-" + crypto.sign(null, msg, privateKey).toString("base64url");
}

function injectPublicKey(htmlFile, pub){
  const html = fs.readFileSync(htmlFile, "utf8");
  const re = /const KGP_LICENSE_PUBLIC_KEY = "[^"]*";/;
  if (!re.test(html)) fail(`constante KGP_LICENSE_PUBLIC_KEY introuvable dans ${htmlFile}`);
  fs.writeFileSync(htmlFile, html.replace(re, `const KGP_LICENSE_PUBLIC_KEY = "${pub}";`));
  console.log(`Clé publique inscrite dans ${htmlFile}`);
}

function main(){
  const opts = args(process.argv.slice(2));
  const cmd = opts._[0];
  if (cmd === "init"){
    const file = keyPath(opts);
    assertOutsideGit(file);
    let privateKey;
    if (fs.existsSync(file)){
      console.log(`Clé privée existante conservée : ${file}`);
      privateKey = crypto.createPrivateKey(fs.readFileSync(file));
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      ({ privateKey } = crypto.generateKeyPairSync("ed25519"));
      fs.writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
      console.log(`Clé privée créée : ${file}\n=> SAUVEGARDEZ-LA hors ligne (clé USB chiffrée, coffre-fort). Ne la commitez jamais.`);
    }
    const pub = publicKeyB64url(privateKey);
    console.log(`Clé publique (à mettre dans KGP_LICENSE_PUBLIC_KEY) : ${pub}`);
    if (opts.html) injectPublicKey(path.resolve(opts.html), pub);
  } else if (cmd === "generer"){
    console.log(signLicense(loadPrivateKey(opts), opts.structure, opts.expiration));
  } else if (cmd === "publique"){
    console.log(publicKeyB64url(loadPrivateKey(opts)));
  } else {
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 16).map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(cmd ? 1 : 0);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
