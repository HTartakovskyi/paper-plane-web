import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

// No events, URLs, credentials, database error details, or CLI output are logged.
export async function handler(event) {
  const url = new URL(process.env.DATABASE_URL);
  url.search = '';
  const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true,
    ca: readFileSync('/var/runtime/ca-cert.pem', 'utf8') }, connectionTimeoutMillis: 5000,
    statement_timeout: 10000 });
  try {
    await client.connect();
    const tls = await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
    if (!tls.rows[0]?.ssl) throw new Error('TLS_REQUIRED');
    const files = readdirSync('prisma/migrations').filter(n => /^\d+_/.test(n)).sort();
    const local = files.map(name => ({ name, checksum: createHash('sha256').update(readFileSync(`prisma/migrations/${name}/migration.sql`)).digest('hex') }));
    const exists = await client.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present");
    const rows = exists.rows[0].present ? (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at')).rows : [];
    const columns = (await client.query("SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('GameSession','FlightAttempt') ORDER BY table_name,ordinal_position")).rows;
    const failed = rows.some(r => !r.finished_at && !r.rolled_back_at);
    const applied = rows.filter(r => r.finished_at && !r.rolled_back_at);
    const mismatch = applied.some(r => !local.some(l => l.name === r.migration_name && l.checksum === r.checksum));
    const pending = local.filter(l => !applied.some(r => r.migration_name === l.name)).map(l => l.name);
    const safe = !failed && !mismatch && (rows.length > 0 || columns.length === 0);
    const report = { tls: true, applied: applied.map(r => r.migration_name), pending, failed, checksumMismatch: mismatch, safe, columns };
    if (event.action === 'inspect') return report;
    if (event.action !== 'apply' || !safe || JSON.stringify(event.expectedPending) !== JSON.stringify(pending)) return { ok: false, reason: 'INSPECTION_APPROVAL_MISMATCH', report };
    if (!pending.length) return { ok: true, message: 'No pending migrations', report };
    // The reviewed migrations only create tables/indexes and add/backfill planeId.
    // A new migration needs explicit review before it can be applied by this runner.
    if (pending.some(n => !['20261122163636_init_game', '20261122200000_add_plane_id'].includes(n))) return { ok: false, reason: 'UNREVIEWED_MIGRATION' };
    const cliUrl = new URL(url);
    cliUrl.searchParams.set('sslmode', 'require');
    cliUrl.searchParams.set('sslaccept', 'strict');
    cliUrl.searchParams.set('sslcert', '/var/runtime/ca-cert.pem');
    const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024,
      env: { ...process.env, DATABASE_URL: cliUrl.toString(), HOME: '/tmp', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    });
    return { ok: result.status === 0, exitCode: result.status, codes: [...new Set((`${result.stdout || ''} ${result.stderr || ''}`).match(/\bP\d{4}\b/g) || [])] };
  } catch (error) {
    return { ok: false, reason: 'DATABASE_CHECK_FAILED', code: /^[A-Z0-9_]{2,40}$/.test(error.code || '') ? error.code : 'REDACTED' };
  } finally { await client.end().catch(() => {}); }
}
