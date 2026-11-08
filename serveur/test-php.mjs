#!/usr/bin/env node
// Lance les tests contre la version PHP (php -S + dev-router.php), base vide temporaire :
//  1. configure la console et crée une société « test » ;
//  2. tests communs du serveur (server.test.mjs) sur /test/ ;
//  3. tests plusieurs sociétés (plateforme-php.test.mjs).      npm run test:php
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "kgp-php-"));
fs.copyFileSync(path.join(ROOT, "kgpro.html"), path.join(ROOT, "php", "lib", "kgpro.html"));
const port = 18000 + Math.floor(Math.random() * 1000);
const root = `http://127.0.0.1:${port}`;
// Journal du serveur PHP dans un fichier : un tuyau non lu (pendant spawnSync) se remplirait et bloquerait PHP.
const logFile = path.join(data, "php-server.log");
const logFd = fs.openSync(logFile, "a");
const php = spawn("php", ["-S", `127.0.0.1:${port}`, path.join(ROOT, "php", "dev-router.php")],
  // KGP_CINETPAY_BASE pointe vers un hôte qui échoue aussitôt : la reconfirmation CinetPay du
  // webhook ne part pas sur le vrai réseau pendant les tests (seule la signature est testée).
  { env: { ...process.env, KGP_DATA_DIR: data, KGP_CINETPAY_BASE: "http://127.0.0.1:1" }, stdio: ["ignore", "ignore", logFd] });
await new Promise(r => setTimeout(r, 700));

let status = 1;
try{
  // Préparation dans un processus séparé (ses connexions se ferment en sortant ; le serveur
  // de test PHP ne traite qu'une connexion à la fois). Le code d'installation est lu dans
  // le fichier, comme le ferait l'administrateur.
  const CONSOLE_PASSWORD = "Console-Kayely-2026";
  const prep = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs";
    const root = ${JSON.stringify(root)};
    await fetch(root + "/console/api/status");
    const code = /^\\s{4}([A-F0-9]{10})$/m.exec(fs.readFileSync(${JSON.stringify(path.join(data, "CODE-CONSOLE.txt"))}, "utf8"))[1];
    const setup = await fetch(root + "/console/api/setup", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, password: ${JSON.stringify(CONSOLE_PASSWORD)} }) });
    if (!setup.ok) throw new Error("setup console : " + await setup.text());
    const cookie = setup.headers.get("set-cookie").split(";")[0];
    const create = await fetch(root + "/console/api/societes", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ slug: "test", nom: "Société de test" }) });
    if (!create.ok) throw new Error("création société : " + await create.text());
    // La console crée désormais l'administrateur de la société (fin de la « course au setup »).
    // Les tests communs (server.test.mjs) partent d'une société vierge : on la remet à zéro.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(path.join(data, "societes", "test.sqlite"))});
    for (const t of ["records", "sessions", "audit", "login_fails"]) db.exec("DELETE FROM " + t);
    db.close();
  `], { stdio: "inherit" });
  if (prep.status !== 0) throw new Error("préparation des tests PHP impossible");

  const env = { ...process.env, KGP_TEST_BASE: root + "/test", KGP_TEST_ROOT: root, KGP_TEST_DATA: data, KGP_CONSOLE_PASSWORD: CONSOLE_PASSWORD };
  const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", path.join(ROOT, "serveur", "server.test.mjs"), path.join(ROOT, "serveur", "plateforme-php.test.mjs")],
    { env, stdio: "inherit" });
  status = r.status ?? 1;
} finally {
  php.kill();
  const log = fs.readFileSync(logFile, "utf8");
  const problems = log.split("\n").filter(l => /Fatal|Warning|Deprecated|Notice/.test(l));
  if (problems.length){ console.error("Avertissements PHP :\n" + problems.join("\n")); status = status || 1; }
  fs.rmSync(data, { recursive: true, force: true });
}
process.exit(status);
