# Paper Plane Web: seven-day AWS MVP

React/Vite/Three.js frontend, NestJS 12 HTTP API, shared flight math, Prisma 7/PostgreSQL.

Infrastructure: private S3 + CloudFront OAC → HTTP API → Node.js 24 x86_64 Lambda → existing private `paper-plane-db` in `us-east-2`. No NAT, proxy, paid domain, or always-on application server. RDS remains outside CloudFormation ownership and is never recreated or deleted by these scripts.

## Prerequisites and credentials

- Node.js compatible with Vite 8, AWS CLI, Git with GitHub credentials, profile `paper-plane`.
- Existing RDS endpoint, VPC/subnets/security group in `infra/deploy.mjs`; review these before using another account.
- Store the RDS connection string in **`.deploy-private/rds.env`**, with `DATABASE_URL=...`, database `paperplane`. This is distinct from the local development database in `backend/.env`. Never paste secrets into commands, commit them, or send them through chat.
- Restrict `.deploy-private` to the current OS user. `deploy.mjs` restricts the Windows ACL before creating temporary secret transfer files and removes their contents after use.
- Secrets Manager holds the URL. CloudFormation resolves it at deployment time into encrypted Lambda environment variables; runtime has no Secrets Manager permission or network dependency. Privileged Lambda configuration readers can access environment values: do not dump function configuration.

## Build and deploy

Run commands from the repository root in PowerShell. AWS operations require the normal Codex/CLI approval and valid AWS session.

```powershell
node infra/generate.mjs
git diff --check
# Commit and push reviewed changes, then build the exact commit:
node infra/github.mjs dispatch master
node infra/github.mjs status
node infra/github.mjs jobs RUN_ID
node infra/github.mjs download RUN_ID
Expand-Archive .deploy/paper-plane-lambda-linux-node24-x64.zip .deploy/linux -Force
node infra/deploy.mjs check
node infra/deploy.mjs foundation
node infra/deploy.mjs secret
node infra/deploy.mjs upload .deploy/linux
node infra/deploy.mjs plan
node infra/deploy.mjs changes
# Only execute an entirely reviewed, successfully validated change set:
node infra/deploy.mjs execute
node infra/deploy.mjs status
```

Wait for `CREATE_COMPLETE` before continuing. For updates, use `plan update`; destructive replacements/removals are refused by the helper and require separate review. CloudFormation uses ordinary stabilization, not Express mode. Resource events and change-set validation explain provisioning failures. There is no durable CloudTrail trail configured in this account; default management event history has limited retention.

The existing GitHub workflow builds both ZIPs in the pinned Lambda Linux image, tests the unpacked API artifact, runs backend/shared tests, and validates both templates using cfn-lint and official CloudFormation Guard. DB lifecycle is stubbed in the build test; this is not evidence of live database connectivity. Artifacts expire after seven days. ZIP keys use their SHA256 for immutable releases.

## Database inspection and migration

```powershell
node infra/deploy.mjs inspect
# Review tls=true, applied migrations, pending migrations, columns, checksums and safe=true.
# Only after that inspection:
node infra/deploy.mjs migrate
node infra/deploy.mjs inspect
```

The private migration runner checks `_prisma_migrations` and actual columns using verified TLS, rejects failed/modified/unknown migrations, and compares the approved pending list again immediately before applying. It permits only the two reviewed initial migrations and uses `prisma migrate deploy`. Never run `db push`, `migrate dev`, or migrations during application cold starts. New migration SQL requires a fresh safety review. The runner has no HTTP endpoint.

The runtime uses `DATABASE_SSL=verify-full`, `DATABASE_CA_FILE=/var/runtime/ca-cert.pem`, `NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem`, and a one-connection pool. Do not disable TLS checks. No RDS credentials are included in build artifacts or frontend assets.

The account currently limits Lambda memory to 512 MB, including the migration runner.
For an existing credential file in a nested private directory, set `DATABASE_ENV_FILE` to its path before running `secret`; do not print its contents. A secret container alone is insufficient: confirm an `AWSCURRENT` version exists.
For the temporary private migration preflight stack, set `APP_STACK=paper-plane-migration-preflight` before `inspect` or `migrate`. Clear that variable before returning to the application stack. The preflight is a subset of the same resources, without CloudFront or an HTTP endpoint; remove it before deploying the full application to avoid duplicate runners. Current recovery details and AWS Support case are recorded in `.deploy/resume-status.txt`.

## Publish and verify

```powershell
Push-Location frontend
npm.cmd run build
Pop-Location
node infra/deploy.mjs publish
node infra/verify.mjs
```

CloudFront supplies HTTPS using its default hostname. `/api` and `/api/*` go to HTTP API with caching disabled; a viewer-request function strips `/api`. Static extensionless paths serve `index.html`, without rewriting API errors into HTML. Static S3 access is restricted to this distribution. Hashed assets have long cache lifetimes; `index.html` is revalidated, and publication creates an invalidation.

The public smoke test makes real writes: one marked session with three attempts, then verifies persisted history, input rejection, API 404, SPA routing and HTTPS redirect. It records IDs in `.deploy/public-verification.json` and deliberately does not delete data. The anonymous MVP has no user authentication; a session UUID grants access to its history.

## Budget and limits

```powershell
node infra/deploy.mjs budget YOUR_NOTIFICATION_EMAIL
```

This creates an **account-wide monthly** $10 monitoring budget, with actual-cost email notifications at $5 and $10. It includes existing account spending and RDS, rather than relying on unactivated allocation tags. It is not an exact rolling seven-day budget, and notifications can be delayed. It does not stop spending automatically.

HTTP API starts with 2 requests/sec and burst 5; throttling is best effort. The account currently has only five regional concurrent Lambda executions. API Lambda starts at 512 MB/15 seconds; no provisioned concurrency. Nest throttling is per execution environment, not a global limiter. Logs expire after seven days. Monitor 429/503, Lambda errors/duration and RDS connections/storage.

Indicative seven-day budget at 100k API calls, 500 ms average/512 MB, and 10 GB CDN traffic: $4–6 plus a small Secrets Manager charge, before tax and credits; allow $10. Existing RDS is about $3.22/week even without site visitors. Traffic, CPU credits, logs, backups and retained objects can add costs.

## Disable and remove after seven days

If launched on November 23, 2026, plan shutdown on November 30, 2026 (America/Denver); otherwise use seven days after the actual launch. No automatic deletion is scheduled.

```powershell
node infra/teardown.mjs plan
node infra/teardown.mjs disable
```

`disable` sets both functions' reserved concurrency to zero and disables the CloudFront distribution. Propagation takes time; this stops application traffic without deleting database data. RDS continues running and charging.

After reviewing `.deploy/cleanup-manifest.json` and explicitly approving deletion of experiment artifacts/logs/configuration:

```powershell
node infra/teardown.mjs delete --confirm-delete-experiment
aws cloudformation wait stack-delete-complete --stack-name paper-plane-mvp --profile paper-plane --region us-east-2
aws cloudformation wait stack-delete-complete --stack-name paper-plane-foundation --profile paper-plane --region us-east-2
```

The script removes only owned static/artifact buckets, the experiment stacks, its budget, and schedules deletion of its secret with a seven-day recovery window. Lambda ENI release may delay stack deletion; inspect events before retrying. It never deletes or stops RDS, its pre-existing SG/rules, backups or database records. Keep the cleanup manifest until deletion is verified. Remove local private credentials manually when no longer needed.

**Zero total AWS spend is impossible while retaining a running RDS.** Stopping RDS needs a separate operational decision: storage/backups remain billable, and RDS automatically restarts after seven days. Deleting RDS or its data requires separate explicit approval and is excluded from this procedure.

## Lambda ESM compatibility and release checks

NestJS 12.6.0 is ESM; @nestjs/throttler 6.8.0 publishes CommonJS. Managed Node24 Lambda disables require(ESM), unlike a direct node invocation in the runtime Docker image. Build-time Rollup converts the unmodified throttler package to ESM at src/throttling.ts, retaining external Nest namespace imports and the existing global guard. No node_modules edits or experimental runtime flags are used. ZIP smoke checks now include both managed-runtime module-disable flags and verify cold/warm invocation plus HTTP 429.

## Password rotation before public launch

The previously photographed RDS password must be retired before publication. Generate a cryptographically random replacement locally, store it only in the access-restricted .deploy-private directory, and pass it to RDS using a protected CLI input file (never command-line literals). Apply to the existing DB only; wait until modifications finish. Update the existing rds.env without displaying its contents, then run deploy.mjs secret with DATABASE_ENV_FILE pointing at that file. Refresh every existing application/migration Lambda from AWSCURRENT with revision checks; preserve all TLS and other environment settings. Verify local/secret/Lambda equality using boolean-only output, then SQL pg_stat_ssl and database reads. Delete temporary secret input files. Do not publish until rotation and connectivity are confirmed; changing Secrets Manager alone does not update Lambda environments.

CloudFront verification is tracked by AWS Support case 179549421500154. Cloudflare Pages is an optional user-approved fallback only: frontend needs an HTTPS API base URL and API Gateway must allow only the exact Pages origin (no wildcard credentials). No alternative-platform resources may be created before approval. Keep the default /api same-origin mode for the eventual CloudFront deployment.

## Active fallback deployment (November 23, 2026)

The approved Cloudflare Pages project is https://paper-plane-web.pages.dev, with AWS HTTP API https://gqkrbo8wtb.execute-api.us-east-2.amazonaws.com. The existing paper-plane-migration-preflight stack now owns both API and migration Lambdas, IAM roles, 7-day logs, HTTP API and private database security-group rules. Do not delete this stack as temporary preflight: it now serves the public backend. CloudFront is not provisioned; Support case 179549421500154 remains pending. The original paper-plane-mvp stack is ROLLBACK_COMPLETE with its empty retained static bucket.

Frontend builds set VITE_API_BASE_URL to the HTTPS API endpoint; omit it for original same-origin /api mode. API Gateway allows only https://paper-plane-web.pages.dev, GET/POST/OPTIONS and content-type. Lambda answers forwarded OPTIONS with 204, without DB access or added CORS permissions. POST/GET still run the existing throttler. Stage throttle is 2 requests/second, burst 5, best effort; application throttle is per Lambda environment.

To stop the experiment without deleting data, set reserved concurrency to zero for paper-plane-migration-preflight-api and paper-plane-migration-preflight-migration using aws lambda put-function-concurrency (profile paper-plane, region us-east-2). This disables application requests but retains the database. Remove the Cloudflare Pages project only when you intend to take down its static URL. RDS continues billing; stopping it is a separate action, still incurs storage charges, and automatically restarts after seven days. The original infra/teardown.mjs assumes the CloudFront stack and must NOT be used for this fallback.

Return to CloudFront by reusing this HTTP API as its HTTPS origin and publishing frontend without VITE_API_BASE_URL; reuse/import the retained S3 bucket rather than deploying duplicate backend/network/database resources. Do not execute the original full-stack create blindly.

## Acceptance result

Public game: https://paper-plane-web.pages.dev (approved Cloudflare Pages Free); API: https://gqkrbo8wtb.execute-api.us-east-2.amazonaws.com. Public browser acceptance passed on November 23, 2026 America/Denver: all three planes, rendered results, persisted attempt history, no page errors, desktop/mobile layout. CORS preflight 204, exact origin allowlist, rejected unrelated origin, observed HTTP 429. Backend tests: 30 unit, 23 API E2E; previous full math 19 and browser suite 6 passed. Linux CI release 21ff7bb, run 45332392055 passed. Runtime ZIP SHA256 0c75cfa331e07a04a7d2d50e4b6a1cb7e60e8f656e99dc8b8f4eb3b83501e43d.

Password rotation completed and strict certificate-verified SQL TLS rechecked. Migration runner healthy; both migrations applied, no pending/failed/mismatched migration. RDS remains private and encrypted. Evidence is in .deploy/public-browser-result.json, .deploy/public-security-result.json and .deploy/migration-inspection.json (local, ignored).

Cost baseline before credits: existing RDS about $3.22/week or $13.98/730-hour month, secret $0.40/month, plus small S3/API/Lambda/log request charges. Plan roughly $4/week or $15-20/month for light experimental traffic, not a cap. Pages static hosting uses the Free plan. Cost Explorer last checked about $0.2549 usage covered by credits; delayed estimated data. Existing $10/month account budget is an alert, below an entire credit-free month of RDS running cost.

Remaining: CloudFront verification is pending; current Pages fallback is operational. npm audit reports a high ReDoS advisory in effect through Prisma CLI; neither effect nor Prisma CLI is present in the public API ZIP. The private manually invoked migration tooling still requires dependency maintenance; no untrusted regex input is used by our migration runner. No blanket npm audit fix/downgrade was applied. Anonymous session UUID access remains the agreed MVP model, not authenticated private history.

Shutdown example (does not delete data):
```powershell
aws lambda put-function-concurrency --function-name paper-plane-migration-preflight-api --reserved-concurrent-executions 0 --profile paper-plane --region us-east-2
aws lambda put-function-concurrency --function-name paper-plane-migration-preflight-migration --reserved-concurrent-executions 0 --profile paper-plane --region us-east-2
```
Do not run these until ending the experiment. For a November 23 launch, plan shutdown November 30, America/Denver. Pages static URL remains unless the project is separately removed; RDS continues billing. No automatic shutdown scheduled.
