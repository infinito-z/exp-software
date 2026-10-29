// Almacenamiento: PostgreSQL (DATABASE_URL, p. ej. Railway) o archivo JSON local (solo pruebas).
const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async init() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '[]'); }
  _read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
  _write(docs) { fs.writeFileSync(this.file + '.tmp', JSON.stringify(docs)); fs.renameSync(this.file + '.tmp', this.file); }
  // Ejecuta fn(docs) en exclusión mutua; fn devuelve {docs, result}
  tx(fn) {
    const run = async () => { const docs = this._read(); const r = await fn(docs); this._write(r.docs); return r.result; };
    const p = this.queue.then(run, run); this.queue = p.catch(() => {}); return p;
  }
  async all() { return this._read(); }
}

class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    const ssl = /localhost|127\.0\.0\.1/.test(url) || process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false };
    this.pool = new Pool({ connectionString: url, ssl });
  }
  async init() {
    await this.pool.query('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, doc JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())');
  }
  async tx(fn) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(424242)');
      const rows = (await c.query('SELECT id, doc FROM sessions')).rows;
      const docs = rows.map(r => r.doc);
      const before = new Map(docs.map(d => [d.id, JSON.stringify(d)]));
      const r = await fn(docs);
      for (const d of r.docs) {
        const s = JSON.stringify(d);
        if (!before.has(d.id)) await c.query('INSERT INTO sessions (id, doc) VALUES ($1, $2)', [d.id, s]);
        else if (before.get(d.id) !== s) await c.query('UPDATE sessions SET doc=$2, updated_at=now() WHERE id=$1', [d.id, s]);
      }
      await c.query('COMMIT');
      return r.result;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
  async all() { return (await this.pool.query('SELECT doc FROM sessions ORDER BY created_at')).rows.map(r => r.doc); }
}

async function makeStore() {
  const s = process.env.DATABASE_URL ? new PgStore(process.env.DATABASE_URL) : new FileStore(process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'sessions.json'));
  await s.init();
  s.kind = process.env.DATABASE_URL ? 'postgres' : 'archivo local (solo pruebas)';
  return s;
}
module.exports = { makeStore };
