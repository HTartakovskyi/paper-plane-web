import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';
import { integerSetting } from '../config.js';

export function connectionConfig(env: NodeJS.ProcessEnv = process.env): { pool: PoolConfig; schema: string } {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error('DATABASE_URL is invalid');
  }
  const schema = url.searchParams.get('schema') ?? 'public';
  url.searchParams.delete('schema');
  // pg URL SSL options override the explicit ssl object. Refuse ambiguous configuration.
  if ([...url.searchParams.keys()].some(key => key.toLowerCase().startsWith('ssl'))) {
    throw new Error('Configure database TLS with DATABASE_SSL and DATABASE_CA_FILE, not URL SSL parameters');
  }
  const sslMode = env.DATABASE_SSL ?? (env.AWS_LAMBDA_FUNCTION_NAME ? 'verify-full' : 'disable');
  if (!['disable', 'verify-full'].includes(sslMode)) throw new Error('DATABASE_SSL must be disable or verify-full');
  if (env.AWS_LAMBDA_FUNCTION_NAME && sslMode !== 'verify-full') {
    throw new Error('Lambda requires verified database TLS');
  }
  let ca: string | undefined;
  if (env.DATABASE_CA_FILE) {
    if (sslMode === 'disable') throw new Error('DATABASE_CA_FILE requires verified TLS');
    try { ca = readFileSync(env.DATABASE_CA_FILE, 'utf8'); }
    catch { throw new Error('Unable to read DATABASE_CA_FILE'); }
  }
  return {
    schema,
    pool: {
      connectionString: url.toString(),
      max: integerSetting(env, 'DATABASE_POOL_MAX', 2, 10),
      connectionTimeoutMillis: integerSetting(env, 'DATABASE_CONNECT_TIMEOUT_MS', 3000, 30000),
      idleTimeoutMillis: integerSetting(env, 'DATABASE_IDLE_TIMEOUT_MS', 10000, 300000),
      statement_timeout: integerSetting(env, 'DATABASE_STATEMENT_TIMEOUT_MS', 5000, 30000),
      query_timeout: integerSetting(env, 'DATABASE_QUERY_TIMEOUT_MS', 6000, 35000),
      allowExitOnIdle: true,
      ssl: sslMode === 'verify-full' ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false,
    },
  };
}
