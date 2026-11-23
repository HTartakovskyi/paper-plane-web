import { connectionConfig } from './connection-config.js';

const env = { DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=game' };
describe('PostgreSQL configuration (no database connections)', () => {
  it('limits the pool and separates the schema from the driver URL', () => {
    const result = connectionConfig(env);
    expect(result.schema).toBe('game');
    expect(result.pool).toMatchObject({ max: 2, connectionTimeoutMillis: 3000,
      statement_timeout: 5000, query_timeout: 6000, idleTimeoutMillis: 10000, ssl: false });
    expect(result.pool.connectionString).not.toContain('schema=');
  });
  it('enables certificate and hostname verification in Lambda', () => {
    expect(connectionConfig({ ...env, AWS_LAMBDA_FUNCTION_NAME: 'test' }).pool.ssl)
      .toEqual({ rejectUnauthorized: true });
  });
  it('accepts explicit pool and timeout settings', () => {
    expect(connectionConfig({ ...env, DATABASE_POOL_MAX: '1', DATABASE_CONNECT_TIMEOUT_MS: '4000' }).pool)
      .toMatchObject({ max: 1, connectionTimeoutMillis: 4000 });
  });
  it.each(['0', '-1', '1.5', 'NaN', '11', ''])('rejects invalid pool maximum %s', value => {
    expect(() => connectionConfig({ ...env, DATABASE_POOL_MAX: value })).toThrow('DATABASE_POOL_MAX');
  });
  it('rejects unsafe or ambiguous TLS settings without revealing credentials', () => {
    expect(() => connectionConfig({ ...env, AWS_LAMBDA_FUNCTION_NAME: 'test', DATABASE_SSL: 'disable' })).toThrow('verified');
    expect(() => connectionConfig({ ...env, DATABASE_SSL: 'require' })).toThrow('DATABASE_SSL');
    expect(() => connectionConfig({ DATABASE_URL: `${env.DATABASE_URL}&sslmode=no-verify` })).toThrow('URL SSL');
    expect(() => connectionConfig({ DATABASE_URL: 'secret-invalid-url' })).toThrow('DATABASE_URL is invalid');
    expect(() => connectionConfig({ ...env, DATABASE_SSL: 'verify-full', DATABASE_CA_FILE: 'missing-ca.pem' })).toThrow('Unable to read');
  });
});
