// Stockage SQLite (module node:sqlite intégré à Node.js >= 22.13, aucune dépendance).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export function openDatabase(file){
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS records (
      store TEXT NOT NULL,
      id    INTEGER NOT NULL,
      data  TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by INTEGER,
      PRIMARY KEY (store, id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      at INTEGER NOT NULL, user_id INTEGER, action TEXT NOT NULL, store TEXT, record_id INTEGER
    );
  `);

  const q = {
    all: db.prepare("SELECT id, data FROM records WHERE store = ? ORDER BY id"),
    get: db.prepare("SELECT data FROM records WHERE store = ? AND id = ?"),
    count: db.prepare("SELECT COUNT(*) AS n FROM records WHERE store = ?"),
    maxId: db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM records WHERE store = ?"),
    upsert: db.prepare(`INSERT INTO records (store, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(store, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`),
    del: db.prepare("DELETE FROM records WHERE store = ? AND id = ?"),
    audit: db.prepare("INSERT INTO audit (at, user_id, action, store, record_id) VALUES (?, ?, ?, ?, ?)"),
    sessIns: db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)"),
    sessGet: db.prepare("SELECT user_id, created_at, last_seen FROM sessions WHERE token_hash = ?"),
    sessTouch: db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?"),
    sessDel: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    sessDelUser: db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?"),
    sessPurge: db.prepare("DELETE FROM sessions WHERE last_seen < ?"),
  };

  const parse = row => row ? { ...JSON.parse(row.data), id: row.id } : null;

  return {
    raw: db,
    all: store => q.all.all(store).map(parse),
    get: (store, id) => { const r = q.get.get(store, id); return r ? { ...JSON.parse(r.data), id } : null; },
    count: store => q.count.get(store).n,
    nextId: store => q.maxId.get(store).m + 1,
    put(store, id, data, userId){
      const { id: _ignored, ...rest } = data;
      q.upsert.run(store, id, JSON.stringify(rest), Date.now(), userId ?? null);
      return id;
    },
    delete: (store, id) => q.del.run(store, id).changes > 0,
    audit: (userId, action, store, id) => q.audit.run(Date.now(), userId ?? null, action, store ?? null, id ?? null),
    transaction(fn){
      db.exec("BEGIN IMMEDIATE");
      try{ const r = fn(); db.exec("COMMIT"); return r; }
      catch(e){ db.exec("ROLLBACK"); throw e; }
    },
    sessions: {
      create: (hash, userId) => { const now = Date.now(); q.sessIns.run(hash, userId, now, now); },
      get: hash => q.sessGet.get(hash) || null,
      touch: hash => q.sessTouch.run(Date.now(), hash),
      delete: hash => q.sessDel.run(hash),
      deleteOthers: (userId, keepHash) => q.sessDelUser.run(userId, keepHash || ""),
      purge: olderThan => q.sessPurge.run(olderThan),
    },
    close: () => db.close(),
  };
}
