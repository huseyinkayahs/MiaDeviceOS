const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const enabled = String(process.env.RUN_DATABASE_MIGRATIONS || 'true').toLowerCase() !== 'false';
const runDemoSeed = String(process.env.RUN_DEMO_SEED || 'false').toLowerCase() === 'true';
const migrationsDir = process.env.MIGRATIONS_DIR || '/app/migrations';

async function main() {
  if (!enabled) {
    console.log('Database migrations are disabled.');
    return;
  }
  const pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 1
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        checksum_sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const files = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir).filter(name => /^\d+.*\.sql$/i.test(name)).sort()
      : [];
    for (const filename of files) {
      if (!runDemoSeed && /seed/i.test(filename)) {
        console.log(`Migration skipped (demo seed disabled): ${filename}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const existing = await pool.query('SELECT checksum_sha256 FROM schema_migrations WHERE filename=$1', [filename]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum_sha256 !== checksum) {
          throw new Error(`Applied migration checksum changed: ${filename}`);
        }
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename,checksum_sha256) VALUES($1,$2)', [filename, checksum]);
        await client.query('COMMIT');
        console.log(`Migration applied: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed (${filename}): ${error.message}`);
      } finally {
        client.release();
      }
    }
    console.log(`Database migrations completed. Count: ${files.length}`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
