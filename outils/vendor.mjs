#!/usr/bin/env node
// Met à jour les bibliothèques du navigateur hébergées avec l'application (assets/vendor),
// à des versions fixées et vérifiées par leur empreinte : aucun script n'est chargé
// depuis un site tiers (CDN) au moment de l'utilisation.
//   node outils/vendor.mjs
// Pour changer de version : modifier VERSIONS et les empreintes, relancer, tester.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "vendor");

export const VERSIONS = {
  // SheetJS : 0.20.3 corrige CVE-2023-30533 (pollution de prototype) et CVE-2024-22363 (ReDoS).
  // Les versions corrigées ne sont publiées que sur cdn.sheetjs.com (pas sur npm).
  xlsx: { version: "0.20.3", url: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
    sha256: "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8" },
  "tesseract.js": { version: "7.0.0",
    integrity: "sha512-exPBkd+z+wM1BuMkx/Bjv43OeLBxhL5kKWsz/9JY+DXcXdiBjiAch0V49QR3oAJqCaL5qURE0vx9Eo+G5YE7mA==" },
  "tesseract.js-core": { version: "7.0.0",
    integrity: "sha512-WnNH518NzmbSq9zgTPeoF8c+xmilS8rFIl1YKbk/ptuuc7p6cLNELNuPAzcmsYw450ca6bLa8j3t0VAtq435Vw==" },
  "@tesseract.js-data/fra": { version: "1.0.0",
    integrity: "sha512-pp58gMaoyidoBBLd5y5rnf0WW0Y1994QrGqZrYatITqIU/AReUJMykD+YY3JDgvnmgz7uAx1UmhjjuyEmV8JEA==" },
};

const sha512 = buf => "sha512-" + crypto.createHash("sha512").update(buf).digest("base64");
const sha256 = buf => crypto.createHash("sha256").update(buf).digest("hex");

function npmPack(nom, info, tmp){
  const sortie = execFileSync("npm", ["pack", "--json", `${nom}@${info.version}`], { cwd: tmp, encoding: "utf8" });
  const fichier = path.join(tmp, JSON.parse(sortie)[0].filename);
  const recu = sha512(fs.readFileSync(fichier));
  if (recu !== info.integrity) throw new Error(`Empreinte inattendue pour ${nom}@${info.version} : ${recu}`);
  return fichier;
}
function extraire(tgz, tmp){
  const dir = fs.mkdtempSync(path.join(tmp, "x-"));
  execFileSync("tar", ["-xzf", tgz, "-C", dir]);
  return path.join(dir, "package");
}
function copier(src, dest){ fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }

async function main(){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kgp-vendor-"));
  try{
    // SheetJS (téléchargement direct, empreinte SHA-256 fixée)
    // curl : respecte le proxy éventuel (HTTPS_PROXY), contrairement à fetch de Node.
    const buf = execFileSync("curl", ["-sSfL", "--max-time", "120", VERSIONS.xlsx.url], { maxBuffer: 64 * 1024 * 1024 });
    if (sha256(buf) !== VERSIONS.xlsx.sha256) throw new Error("Empreinte inattendue pour SheetJS " + VERSIONS.xlsx.version);
    const xlsxTgz = path.join(tmp, "xlsx.tgz"); fs.writeFileSync(xlsxTgz, buf);
    const xlsx = extraire(xlsxTgz, tmp);
    fs.rmSync(OUT, { recursive: true, force: true });
    copier(path.join(xlsx, "dist", "xlsx.full.min.js"), path.join(OUT, "xlsx", "xlsx.full.min.js"));
    copier(path.join(xlsx, "LICENSE"), path.join(OUT, "xlsx", "LICENSE"));

    // Tesseract.js (lecture OCR des factures scannées) : bibliothèque, moteur, français
    const tjs = extraire(npmPack("tesseract.js", VERSIONS["tesseract.js"], tmp), tmp);
    copier(path.join(tjs, "dist", "tesseract.min.js"), path.join(OUT, "tesseract", "tesseract.min.js"));
    copier(path.join(tjs, "dist", "worker.min.js"), path.join(OUT, "tesseract", "worker.min.js"));
    copier(path.join(tjs, "LICENSE.md"), path.join(OUT, "tesseract", "LICENSE.md"));
    const core = extraire(npmPack("tesseract.js-core", VERSIONS["tesseract.js-core"], tmp), tmp);
    for (const f of fs.readdirSync(core).filter(f => /-lstm\.wasm\.js$/.test(f))) copier(path.join(core, f), path.join(OUT, "tesseract", "core", f));
    copier(path.join(core, "LICENSE"), path.join(OUT, "tesseract", "core", "LICENSE"));
    const fra = extraire(npmPack("@tesseract.js-data/fra", VERSIONS["@tesseract.js-data/fra"], tmp), tmp);
    // Données décompressées (gzip:false) : évite qu'un serveur web les décompresse à la volée.
    fs.mkdirSync(path.join(OUT, "tesseract", "lang"), { recursive: true });
    fs.writeFileSync(path.join(OUT, "tesseract", "lang", "fra.traineddata"),
      zlib.gunzipSync(fs.readFileSync(path.join(fra, "4.0.0_best_int", "fra.traineddata.gz"))));

    const lignes = Object.entries(VERSIONS).map(([n, i]) => `${n} ${i.version}`);
    fs.writeFileSync(path.join(OUT, "VERSIONS.txt"), lignes.join("\n") + "\n");
    console.log("Bibliothèques vérifiées et copiées dans assets/vendor :\n  " + lignes.join("\n  "));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error("Erreur :", e.message); process.exit(1); });
