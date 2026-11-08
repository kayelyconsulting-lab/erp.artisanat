// Lit la définition des modules (SECTIONS) directement dans kgpro.html, pour que
// le serveur et l'application partagent exactement les mêmes règles de champs.
import fs from "node:fs";
import vm from "node:vm";

function slice(src, startMarker, endMarker){
  const a = src.indexOf(startMarker);
  if (a < 0) throw new Error(`Bloc introuvable dans kgpro.html : ${startMarker}`);
  const b = src.indexOf(endMarker, a);
  if (b < 0) throw new Error(`Fin de bloc introuvable dans kgpro.html : ${startMarker}`);
  return src.slice(a, b + endMarker.length);
}

export function loadSchema(htmlFile){
  const html = fs.readFileSync(htmlFile, "utf8");
  const code = [
    slice(html, "function tresoFields(){", "\n}\n"),
    slice(html, "const SECTIONS = [", "\n];"),
    slice(html, "const NUMERO_PREFIXES = {", "\n};"),
    "({ SECTIONS, NUMERO_PREFIXES })",
  ].join("\n");
  const { SECTIONS, NUMERO_PREFIXES } = vm.runInNewContext(code, Object.create(null), { timeout: 1000 });

  const modules = new Map();
  for (const sec of SECTIONS){
    for (const mod of sec.modules){
      if (mod.readonly) continue; // vues calculées : aucune table
      modules.set(mod.key, { ...mod, section: sec.id, fields: mod.fields || [] });
    }
  }
  return { modules, numeroPrefixes: NUMERO_PREFIXES };
}
