#!/usr/bin/env node
// Exporte la définition des modules de kgpro.html vers php/lib/schema.json,
// utilisé par la version PHP du serveur (hébergements sans Node.js, ex. LWS Starter).
//   node outils/generer-schema.mjs          -> écrit le fichier
//   node outils/generer-schema.mjs --check  -> échoue si le fichier n'est pas à jour
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema } from "../serveur/schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "php", "lib", "schema.json");

export function buildSchemaJson(){
  const { modules, numeroPrefixes } = loadSchema(path.join(ROOT, "kgpro.html"));
  return JSON.stringify({ modules: Object.fromEntries(modules), numeroPrefixes }, null, 1) + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const json = buildSchemaJson();
  if (process.argv.includes("--check")){
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (current !== json){ console.error("php/lib/schema.json n'est pas à jour : lancez node outils/generer-schema.mjs"); process.exit(1); }
    console.log("php/lib/schema.json est à jour");
  } else {
    fs.writeFileSync(OUT, json);
    console.log("Écrit : " + path.relative(ROOT, OUT));
  }
}
