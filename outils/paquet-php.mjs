#!/usr/bin/env node
// Prépare le dossier à envoyer sur un hébergement PHP (ex. LWS Starter) :
//   node outils/paquet-php.mjs   ->  dist/kgpro-php/
// Le contenu de ce dossier va à la racine du site (dossier du sous-domaine).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchemaJson } from "./generer-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "kgpro-php");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "lib"), { recursive: true });
for (const f of ["index.php", "api.php", ".htaccess"]) fs.copyFileSync(path.join(ROOT, "php", f), path.join(OUT, f));
for (const f of ["app.php", "validation.php", "montants.php", "comptabilisation.php", "paiement.php", "plateforme.php", "accueil.html", "console.html", "suspendue.html", ".htaccess"]) fs.copyFileSync(path.join(ROOT, "php", "lib", f), path.join(OUT, "lib", f));
fs.writeFileSync(path.join(OUT, "lib", "schema.json"), buildSchemaJson());
fs.copyFileSync(path.join(ROOT, "kgpro.html"), path.join(OUT, "lib", "kgpro.html"));
// Bibliothèques du navigateur (Excel, lecture OCR), hébergées avec l'application
fs.cpSync(path.join(ROOT, "assets"), path.join(OUT, "assets"), { recursive: true });
console.log("Prêt : " + path.relative(ROOT, OUT));
