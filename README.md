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
