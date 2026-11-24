import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const args = ['--profile', process.env.AWS_PROFILE || 'paper-plane', '--region', 'us-east-2', '--output', 'json', '--no-cli-pager'];
function aws(a) { const s = execFileSync('aws', [...a, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return s.trim() ? JSON.parse(s) : {}; }
function outputs(name) { return Object.fromEntries(aws(['cloudformation', 'describe-stacks', '--stack-name', name]).Stacks[0].Outputs.map(o => [o.OutputKey, o.OutputValue])); }
const action = process.argv[2] || 'plan';
const web = outputs('paper-plane-mvp');
const foundation = outputs('paper-plane-foundation');
const plan = { application: 'paper-plane-mvp', foundation: 'paper-plane-foundation', webBucket: web.WebBucket, artifacts: foundation.ArtifactBucket, secretArn: foundation.DatabaseSecretArn, retainedDatabase: 'paper-plane-db', budget: 'paper-plane-weekly-experiment' };
mkdirSync('.deploy', { recursive: true });
writeFileSync('.deploy/cleanup-manifest.json', JSON.stringify(plan, null, 2));
if (action === 'plan') console.log(JSON.stringify(plan, null, 2));
else if (action === 'disable') {
  for (const name of [web.ApiFunction, web.MigrationFunction]) aws(['lambda', 'put-function-concurrency', '--function-name', name, '--reserved-concurrent-executions', '0']);
  const cf = aws(['cloudfront', 'get-distribution-config', '--id', web.DistributionId]);
  cf.DistributionConfig.Enabled = false;
  const p = resolve('.deploy/disabled-distribution.json'); writeFileSync(p, JSON.stringify(cf.DistributionConfig));
  aws(['cloudfront', 'update-distribution', '--id', web.DistributionId, '--if-match', cf.ETag, '--distribution-config', `file://${p}`]);
  console.log('API and migration invocations disabled, CloudFront disabling. RDS unchanged and still billed.');
} else if (action === 'delete' && process.argv.includes('--confirm-delete-experiment')) {
  // Only explicitly owned experiment buckets are emptied; never modify the RDS.
  for (const [bucket, prefix] of [[web.WebBucket, 'paper-plane-mvp-'], [foundation.ArtifactBucket, 'paper-plane-foundation-']]) {
    if (!bucket.startsWith(prefix)) throw new Error('Unexpected bucket ownership');
    execFileSync('aws', ['s3', 'rm', `s3://${bucket}/`, '--recursive', '--only-show-errors', ...args], { stdio: 'pipe' });
    aws(['s3api', 'delete-bucket', '--bucket', bucket]);
  }
  // Buckets and secret have Retain policies. The secret enters a 7-day recovery window.
  aws(['secretsmanager', 'delete-secret', '--secret-id', foundation.DatabaseSecretArn, '--recovery-window-in-days', '7']);
  aws(['cloudformation', 'delete-stack', '--stack-name', 'paper-plane-mvp']);
  aws(['cloudformation', 'delete-stack', '--stack-name', 'paper-plane-foundation']);
  const account = aws(['sts', 'get-caller-identity']).Account;
  execFileSync('aws', ['budgets', 'delete-budget', '--account-id', account, '--budget-name', plan.budget, '--profile', process.env.AWS_PROFILE || 'paper-plane', '--region', 'us-east-1'], { stdio: 'pipe' });
  console.log('Experiment deletion requested. Wait for both stacks to reach DELETE_COMPLETE. Existing RDS and its data preserved.');
} else throw new Error('Use plan, disable, or delete --confirm-delete-experiment after explicit data-deletion approval.');
