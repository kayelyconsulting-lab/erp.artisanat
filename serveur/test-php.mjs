#!/usr/bin/env node
// Lance les tests du serveur contre la version PHP (php -S + dev-router.php),
// avec une base vide dans un dossier temporaire.   npm run test:php
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "kgp-php-"));
fs.copyFileSync(path.join(ROOT, "kgpro.html"), path.join(ROOT, "php", "lib", "kgpro.html"));
const port = 18000 + Math.floor(Math.random() * 1000);
const php = spawn("php", ["-S", `127.0.0.1:${port}`, path.join(ROOT, "php", "dev-router.php")],
  { env: { ...process.env, KGP_DATA_DIR: data }, stdio: ["ignore", "ignore", "pipe"] });
let log = ""; php.stderr.on("data", d => { log += d; });
await new Promise(r => setTimeout(r, 600));
const r = spawnSync(process.execPath, ["--test", path.join(ROOT, "serveur", "server.test.mjs")],
  { env: { ...process.env, KGP_TEST_BASE: `http://127.0.0.1:${port}` }, stdio: "inherit" });
php.kill();
if (r.status !== 0 && /Fatal|Warning|Deprecated/.test(log)) console.error(log.split("\n").filter(l => /Fatal|Warning|Deprecated|Error/.test(l)).join("\n"));
fs.rmSync(data, { recursive: true, force: true });
process.exit(r.status ?? 1);
