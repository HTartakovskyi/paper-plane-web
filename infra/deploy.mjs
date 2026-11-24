import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';

const PROFILE = process.env.AWS_PROFILE || 'paper-plane';
const REGION = 'us-east-2';
const ROOT = resolve(import.meta.dirname, '..');
const DATABASE_ENV_FILE = process.env.DATABASE_ENV_FILE || '.deploy-private/rds.env';
const APP_STACK = process.env.APP_STACK || 'paper-plane-mvp';
process.chdir(ROOT);
mkdirSync('.deploy', { recursive: true });
const baseArgs = ['--profile', PROFILE, '--region', REGION, '--no-cli-pager', '--output', 'json'];
function aws(args, { sensitive = false, raw = false, region = REGION } = {}) {
  try {
    const output = execFileSync('aws', [...args, ...baseArgs, '--region', region], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    return raw ? output : output.trim() ? JSON.parse(output) : {};
  } catch (e) {
    if (sensitive) throw new Error(`AWS ${args[0]} ${args[1]} failed (details suppressed to protect credentials)`);
    throw new Error(`AWS ${args[0]} ${args[1]}: ${String(e.stderr || e.message).slice(0, 3000)}`);
  }
}
function file(name, value) { const p = resolve('.deploy', name); writeFileSync(p, JSON.stringify(value, null, 2)); return `file://${p}`; }
function outputs(stack) {
  const s = aws(['cloudformation', 'describe-stacks', '--stack-name', stack]).Stacks[0];
  return Object.fromEntries((s.Outputs || []).map(o => [o.OutputKey, o.OutputValue]));
}
function privateInput(value, action) {
  mkdirSync('.deploy-private', { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const user = execFileSync('whoami', { encoding: 'utf8' }).trim();
    execFileSync('icacls', ['.deploy-private', '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`], { stdio: 'pipe' });
  }
  const dir = mkdtempSync(resolve('.deploy-private', 'request-'));
  const p = join(dir, 'input.json');
  try { writeFileSync(p, JSON.stringify(value), { mode: 0o600 }); return action(`file://${p}`); }
  finally { if (statSync(p, { throwIfNoEntry: false })) unlinkSync(p); }
}
function invoke(name, payload) {
  const path = resolve('.deploy', 'invoke-result.json');
  const metadata = aws(['lambda', 'invoke', '--function-name', name, '--cli-binary-format', 'raw-in-base64-out', '--payload', file('invoke-input.json', payload), path]);
  if (metadata.FunctionError) throw new Error(`Runner function error: ${metadata.FunctionError}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}
const [action, arg] = process.argv.slice(2);
try {
  if (action === 'check') {
    console.log(JSON.stringify(aws(['sts', 'get-caller-identity'])));
    const env = parseEnv(readFileSync(DATABASE_ENV_FILE, 'utf8'));
    const url = new URL(env.DATABASE_URL);
    console.log(JSON.stringify({ databaseUrlPresent: !!url.password, host: url.hostname, database: url.pathname, tlsParameters: [...url.searchParams.keys()].filter(k => k.startsWith('ssl')) }));
  } else if (action === 'foundation') {
    console.log('Deploying retained artifacts and secret container');
    aws(['cloudformation', 'validate-template', '--template-body', `file://${resolve('infra/foundation.json')}`]);
    console.log(aws(['cloudformation', 'deploy', '--stack-name', 'paper-plane-foundation', '--template-file', 'infra/foundation.json', '--tags', 'Project=PaperPlaneWeb', 'Experiment=seven-days', '--no-fail-on-empty-changeset'], { raw: true }));
    console.log(JSON.stringify(outputs('paper-plane-foundation')));
  } else if (action === 'secret') {
    const f = outputs('paper-plane-foundation');
    const env = parseEnv(readFileSync(DATABASE_ENV_FILE, 'utf8'));
    const url = new URL(env.DATABASE_URL);
    if (url.hostname !== 'paper-plane-db.cnyisiuew3ml.us-east-2.rds.amazonaws.com' || !url.password || url.pathname !== '/paperplane') throw new Error('Local DATABASE_URL does not match intended RDS database');
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('ssl')) url.searchParams.delete(key);
    privateInput({ SecretId: f.DatabaseSecretArn, SecretString: JSON.stringify({ DATABASE_URL: url.toString() }) }, input => aws(['secretsmanager', 'put-secret-value', '--cli-input-json', input], { sensitive: true }));
    console.log('Database URL transferred securely; value not displayed');
  } else if (action === 'rotate-database-password') {
    const env = parseEnv(readFileSync(DATABASE_ENV_FILE, 'utf8'));
    const url = new URL(env.DATABASE_URL);
    if (url.hostname !== 'paper-plane-db.cnyisiuew3ml.us-east-2.rds.amazonaws.com' || url.pathname !== '/paperplane') throw new Error('Unexpected database target');
    // Persist the replacement before the remote operation so interruption is recoverable.
    const pending = resolve('.deploy-private', 'rotation-pending.env');
    if (statSync(pending, { throwIfNoEntry: false })) throw new Error('Pending rotation exists; reconcile before retrying');
    const password = randomBytes(36).toString('hex');
    url.password = password;
    privateInput({ DBInstanceIdentifier: 'paper-plane-db', MasterUserPassword: password, ApplyImmediately: true }, input => {
      writeFileSync(pending, `DATABASE_URL=${url.toString()}\n`, { mode: 0o600 });
      aws(['rds', 'modify-db-instance', '--cli-input-json', input], { sensitive: true });
    });
    writeFileSync(DATABASE_ENV_FILE, Object.entries({ ...env, DATABASE_URL: url.toString() }).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
    console.log('RDS rotation requested; local file updated. Wait for RDS, then synchronize secret and Lambda and verify TLS before removing rotation-pending.env.');
  } else if (action === 'refresh-migration-secret') {
    const f = outputs('paper-plane-foundation');
    const o = outputs(APP_STACK);
    const secret = aws(['secretsmanager', 'get-secret-value', '--secret-id', f.DatabaseSecretArn, '--version-stage', 'AWSCURRENT'], { sensitive: true });
    const config = aws(['lambda', 'get-function-configuration', '--function-name', o.MigrationFunction], { sensitive: true });
    const variables = { ...config.Environment.Variables, DATABASE_URL: JSON.parse(secret.SecretString).DATABASE_URL };
    privateInput({ FunctionName: o.MigrationFunction, RevisionId: config.RevisionId, Environment: { Variables: variables } }, input => aws(['lambda', 'update-function-configuration', '--cli-input-json', input], { sensitive: true }));
    aws(['lambda', 'wait', 'function-updated-v2', '--function-name', o.MigrationFunction], { sensitive: true });
    console.log('Migration runner credentials refreshed; values suppressed');
  } else if (action === 'upload') {
    const f = outputs('paper-plane-foundation');
    const dir = resolve(arg || '.deploy/linux');
    function find(name, p = dir) { for (const e of readdirSync(p, { withFileTypes: true })) { const q = join(p, e.name); if (e.isDirectory()) { const r = find(name, q); if (r) return r; } else if (e.name === name) return q; } }
    const keys = {};
    for (const [key, name] of [['ApiKey', 'paper-plane-lambda.zip'], ['MigrationKey', 'paper-plane-migration.zip']]) {
      const p = find(name); if (!p) throw new Error(`Missing ${name}`);
      const sha = createHash('sha256').update(readFileSync(p)).digest('hex');
      keys[key] = `releases/${sha}/${name}`;
      aws(['s3api', 'put-object', '--bucket', f.ArtifactBucket, '--key', keys[key], '--body', p, '--server-side-encryption', 'AES256']);
      console.log(`${name} uploaded, SHA256 ${sha}`);
    }
    writeFileSync('.deploy/artifacts.json', JSON.stringify(keys, null, 2));
  } else if (action === 'plan') {
    const f = outputs('paper-plane-foundation');
    const artifacts = JSON.parse(readFileSync('.deploy/artifacts.json'));
    const parameters = { VpcId: 'vpc-0c067e76b3176894d', SubnetIds: 'subnet-04754a46084cd3e3c,subnet-0fc48e20b4bed73e4', DatabaseSecurityGroup: 'sg-01b169a6250599e9b', ...f, ...artifacts };
    const p = Object.entries(parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }));
    aws(['cloudformation', 'validate-template', '--template-body', `file://${resolve('infra/app.json')}`]);
    const name = `release-${Date.now()}`;
    const result = aws(['cloudformation', 'create-change-set', '--stack-name', 'paper-plane-mvp', '--change-set-name', name, '--change-set-type', arg === 'update' ? 'UPDATE' : 'CREATE', '--template-body', `file://${resolve('infra/app.json')}`, '--parameters', file('parameters.json', p), '--capabilities', 'CAPABILITY_IAM', '--tags', 'Key=Project,Value=PaperPlaneWeb', 'Key=Experiment,Value=seven-days']);
    writeFileSync('.deploy/changeset.json', JSON.stringify(result));
    console.log(JSON.stringify(result));
  } else if (action === 'changes') {
    const c = JSON.parse(readFileSync('.deploy/changeset.json'));
    const r = aws(['cloudformation', 'describe-change-set', '--change-set-name', c.Id]);
    console.log(JSON.stringify({ Status: r.Status, Reason: r.StatusReason, Changes: r.Changes?.map(c => c.ResourceChange) }, null, 2));
  } else if (action === 'execute') {
    const c = JSON.parse(readFileSync('.deploy/changeset.json'));
    const r = aws(['cloudformation', 'describe-change-set', '--change-set-name', c.Id]);
    if (r.Status !== 'CREATE_COMPLETE') throw new Error('Change set not ready');
    if (r.Changes.some(c => c.ResourceChange.Action === 'Remove' || c.ResourceChange.Replacement === 'True' || c.ResourceChange.ResourceType.startsWith('AWS::RDS::'))) throw new Error('Destructive or database change requires separate approval');
    console.log(aws(['cloudformation', 'execute-change-set', '--change-set-name', c.Id]));
  } else if (action === 'status') {
    const r = aws(['cloudformation', 'describe-stacks', '--stack-name', 'paper-plane-mvp']).Stacks[0];
    console.log(JSON.stringify({ status: r.StackStatus, reason: r.StackStatusReason, outputs: r.Outputs }, null, 2));
  } else if (action === 'inspect') {
    const o = outputs(APP_STACK);
    const r = invoke(o.MigrationFunction, { action: 'inspect' });
    writeFileSync('.deploy/migration-inspection.json', JSON.stringify(r, null, 2));
    console.log(JSON.stringify(r, null, 2));
  } else if (action === 'migrate') {
    const o = outputs(APP_STACK);
    const report = JSON.parse(readFileSync('.deploy/migration-inspection.json'));
    if (!report.safe || !report.tls) throw new Error('Migration inspection is not safe');
    const result = invoke(o.MigrationFunction, { action: 'apply', expectedPending: report.pending });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } else if (action === 'publish') {
    const o = outputs('paper-plane-mvp');
    aws(['s3', 'sync', 'frontend/dist', `s3://${o.WebBucket}/`, '--exclude', 'index.html', '--cache-control', 'public,max-age=31536000,immutable', '--only-show-errors'], { raw: true });
    aws(['s3', 'cp', 'frontend/dist/index.html', `s3://${o.WebBucket}/index.html`, '--content-type', 'text/html', '--cache-control', 'no-cache,max-age=0,must-revalidate', '--only-show-errors'], { raw: true });
    console.log(JSON.stringify(aws(['cloudfront', 'create-invalidation', '--distribution-id', o.DistributionId, '--paths', '/*'])));
    writeFileSync('.deploy/outputs.json', JSON.stringify(o, null, 2));
    console.log(o.Url);
  } else if (action === 'budget') {
    const account = aws(['sts', 'get-caller-identity']).Account;
    if (!arg || !arg.includes('@')) throw new Error('Provide notification email');
    const budget = { AccountId: account, Budget: { BudgetName: 'paper-plane-weekly-experiment', BudgetLimit: { Amount: '10', Unit: 'USD' }, TimeUnit: 'MONTHLY', BudgetType: 'COST' }, NotificationsWithSubscribers: [5, 10].map(Threshold => ({ Notification: { NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', Threshold, ThresholdType: 'ABSOLUTE_VALUE' }, Subscribers: [{ SubscriptionType: 'EMAIL', Address: arg }] })) };
    privateInput(budget, input => aws(['budgets', 'create-budget', '--cli-input-json', input], { region: 'us-east-1' }));
    console.log('Account-wide monthly $10 budget created, actual alerts at $5 and $10. Not a hard cap.');
  } else throw new Error('Unknown deployment action');
} catch (error) { console.error(error.message); process.exitCode = 1; }
