# MUT Market Engineering Progress

## Current status (2026-10-19)

The latest documented listing lifecycle and automated-test checkpoint is reported as passed, including application of the two listing lifecycle migrations to the isolated `campus_marketplace_test` database and the reported backend test results below. The corresponding command output and migration evidence are not present in this repository, so these remain previously reported results rather than independently verifiable artifacts in this ledger.

Browser verification of the draft-save recovery flow remains open. Production deployment has not been verified or performed in this checkpoint.

Latest known commits:

- `bab349d` — `feat: harden listing lifecycle and image management`
- `fe1e043` — `feat: improve listing creation and publishing workflow`

The local `origin/main` remote-tracking reference was last known to match `fe1e043`. The live remote was not freshly checked for this update.

## Checkpoint A: Seller management and listing integrity

**Historical status at the time of the initial snapshot: BLOCKED** — database migration and integration-test verification were pending access to the approved isolated PostgreSQL test database. This snapshot is superseded for the database and automated checks explicitly reported as completed in the later continuation below; its historical details are retained.

### Baseline

- Branch: `main`
- Starting commit: `222a3e46e1a9083cee7fe38e2dfa4d9a257477bc` (`feat: improve marketplace search and listing cards`)
- Baseline worktree: nine modified tracked files; two untracked Checkpoint A migration directories; five pre-existing untracked cleanup/recovery files. No staged changes.
- Protected files remain present and were not modified, staged, or deleted:
  - `backend/scripts/cleanup-phase2-test-data.ts`
  - `backend/scripts/execute-cleanup-phase2-test-data.ts`
  - `backend/scripts/inspect-phase2-test-data.ts`
  - `src/services/listingService.original.js`
  - `src/services/listingService.recovery-backup.js`

### Scope and acceptance criteria

Verify seller listing edits, image soft removal, listing-creation idempotency, authorization, upload recovery, and migration integrity. Release review requires verified isolated database identity, both migrations successfully applied to that database, schema/data preservation checks, and the relevant database-backed security and lifecycle regressions passing. No production database operation or deployment is authorized by this checkpoint.

### Implementation under verification at the initial snapshot

Modified tracked files:

- `backend/prisma/schema.prisma`
- `backend/src/modules/listings/listing.routes.ts`
- `backend/src/modules/listings/listing.schemas.ts`
- `backend/src/modules/listings/listing.service.ts`
- `backend/tests/listing.schemas.test.ts`
- `backend/tests/verification.security.test.ts`
- `src/pages/MyListings.jsx`
- `src/pages/PostItem.jsx`
- `src/services/listingService.js`

Untracked migrations inspected, not applied:

- `backend/prisma/migrations/20261019120000_listing_image_soft_removal/`
- `backend/prisma/migrations/20261019123000_listing_creation_idempotency/`

The first adds nullable `listing_images.removedAt` and an index. The second adds nullable `listings.creationKey` and a unique `(sellerId, creationKey)` index. They are ordered by their migration timestamps. Database migration state and preservation of existing records are not established.

### Database configuration and blocker

- Test configuration comes from `TEST_DATABASE_URL`; `backend/scripts/test-database.ts` requires the approved host and database name and assigns that URL to `DATABASE_URL` for Prisma.
- Sanitized local configuration: approved test database `campus_marketplace_test`, PostgreSQL host `campus-marketplace-db.postgres.database.azure.com`, port `5432`, TLS mode `require`. Configured runtime database is `campus_marketplace_dev`, so the names differ. This does not establish production configuration or database state.
- DNS resolved to `4.221.164.241`; the current environment's TCP connection attempt failed with a local socket permission error before PostgreSQL negotiation. Authentication, TLS negotiation, server availability, and network allowlisting remain unverified.
- No migration or database-backed test has been run. Do not substitute development or production credentials or weaken the test guard.

### Verification evidence at the initial snapshot (2026-10-19)

Passed:

- `npx.cmd tsx --test tests/listing.schemas.test.ts tests/storage.test.ts` (from `backend/`): 6 passed, 0 failed.
- `npm.cmd run typecheck` (from `backend/`): passed.
- `npm.cmd run build` (from `backend/`): passed; Prisma Client generated and TypeScript build completed.
- `npx.cmd eslint src/modules/listings/listing.routes.ts src/modules/listings/listing.schemas.ts src/modules/listings/listing.service.ts tests/listing.schemas.test.ts tests/verification.security.test.ts` (from `backend/`): passed.
- `npm.cmd run build` (repository root): passed; frontend and backend builds completed.
- `npm.cmd run prisma:validate` (from `backend/`): passed.
- `git diff --check`: passed; Git reported line-ending normalization warnings for `backend/tests/listing.schemas.test.ts` and `src/pages/PostItem.jsx`.

Blocked / not run:

- `backend/scripts/migrate-test-db.ts` / `prisma migrate deploy`: not run because TCP access is locally denied.
- Database-backed tests including `verification.security.test.ts`, `listing.lifecycle.test.ts`, and `listing.inquiries.test.ts`: not run; no passing result is claimed.
- Migration status, resulting database constraints, existing image rows, inquiry preservation, and runtime persistence: unverified.

### Security and preservation notes

- Test database guard and environment configuration were inspected; no configuration or guard was changed.
- The database operations were stopped before authentication or mutation because the local socket check failed.
- No database, production data, files, or deployment were altered. The five protected untracked files remain present and untouched.

### Next concrete action recorded at the initial snapshot

From an authorized runner/network that permits outbound TCP to the approved PostgreSQL host on port 5432, verify connectivity and TLS/database identity using the approved test configuration. Then inspect migration status, apply the two checked-in migrations to `campus_marketplace_test` only using `npm run prisma:migrate:test`, verify schema and existing-record preservation, and run the database-backed security/lifecycle regression suite. Stop on any migration error and inspect partial state before considering a retry.

At the initial snapshot, Checkpoint A remained **BLOCKED** until those database-dependent acceptance criteria were met. The later continuation below reports the database and automated-test checkpoint as passed. Checkpoints B, C, and D had not started at the time of this snapshot.

## Historical snapshot: Checkpoint A connectivity recheck (2026-10-19)

**Status at the time: BLOCKED.** This continuation re-established the baseline and database guard, checked for an available authorized database execution tool, and made one connection attempt from the local workspace. It is superseded by the later reported test-database checkpoint below. No other authorized execution environment was connected or exposed by the tools available at that time.

### Exact commands and outcomes

Run from the repository root:

```powershell
Get-Content docs/engineering/PROGRESS.md; git branch --show-current; git log -1 --format='%H%n%s'; git status --short; Get-Content backend/scripts/test-database.ts; Get-Content backend/scripts/migrate-test-db.ts; Get-Content backend/prisma/migrations/20261019120000_listing_image_soft_removal/migration.sql; Get-Content backend/prisma/migrations/20261019123000_listing_creation_idempotency/migration.sql
```

Outcome: branch `main`, HEAD remains `222a3e46e1a9083cee7fe38e2dfa4d9a257477bc`; the nine tracked modifications, both migration directories, and the five protected untracked files remain present. The test guard still requires `TEST_DATABASE_URL`, approved host, and `campus_marketplace_test`; the migration script invokes `prisma migrate deploy` using the guarded environment. Both migration SQL files were then reported as additive and unapplied. The later continuation reports that they were applied to the approved test database.

Run from `backend/` to inspect only non-secret connection metadata:

```powershell
@'
import "dotenv/config";
function meta(raw) { if (!raw) return null; try { const u=new URL(raw); return {host:u.hostname,port:u.port||"5432",database:decodeURIComponent(u.pathname.replace(/^\//,"")),sslmode:u.searchParams.get("sslmode")||"not specified"}; } catch { return {configured:true,parseable:false}; } }
const test=meta(process.env.TEST_DATABASE_URL), runtime=meta(process.env.DATABASE_URL);
console.log(JSON.stringify({testVariable:"TEST_DATABASE_URL",test,runtimeVariable:"DATABASE_URL",runtime,differentDatabaseNames:!!test&&!!runtime&&test.database!==runtime.database},null,2));
'@ | node --input-type=module
```

Outcome: test metadata is `campus-marketplace-db.postgres.database.azure.com:5432`, `campus_marketplace_test`, `sslmode=require`; runtime metadata is the same host/port, `campus_marketplace_dev`, `sslmode=require`; database names differ. No credentials or complete URL were printed. This verifies local configuration metadata only, not the remote database identity.

Run from `backend/` for one DNS/TCP reachability check:

```powershell
$hostName='campus-marketplace-db.postgres.database.azure.com'; try { $addresses=[System.Net.Dns]::GetHostAddresses($hostName) | ForEach-Object { $_.IPAddressToString }; "DNS_ADDRESSES=$($addresses -join ',')" } catch { "DNS_ERROR=$($_.Exception.GetBaseException().GetType().Name)"; exit 0 }; $client=[System.Net.Sockets.TcpClient]::new(); try { $task=$client.ConnectAsync($hostName,5432); if (-not $task.Wait(5000)) { 'TCP_RESULT=TIMEOUT' } elseif ($client.Connected) { 'TCP_RESULT=CONNECTED' } } catch { "TCP_RESULT=FAILED"; "TCP_ERROR_TYPE=$($_.Exception.GetBaseException().GetType().Name)"; "TCP_ERROR=$($_.Exception.GetBaseException().Message)" } finally { $client.Dispose() }
```

Outcome: DNS resolved to `4.221.164.241`; TCP failed with `SocketException`: “An attempt was made to access a socket in a way forbidden by its access permissions.” The connection did not reach PostgreSQL. Server availability, remote firewall/allowlist state, TLS negotiation, and credentials were not established by that check.

### Required external action and stop point

The database/network owner must provide an approved execution runner with outbound TCP access to the approved test host on port 5432, or authorize/configure access for an approved runner. From that runner, verify the TLS PostgreSQL handshake and database identity using only `TEST_DATABASE_URL` and the existing guard. Until that succeeds, do not run `prisma migrate:test` or database-backed tests. No migration, authentication attempt, database mutation, deployment, push, or commit occurred in this continuation.

No database-backed test command was run because TCP failed before PostgreSQL negotiation. Existing non-database check results above remain the only test evidence; none are being represented as integration-test results.

## Historical snapshot: Checkpoint A migration request access revalidation (2026-10-19)

**Status at the time: BLOCKED.** The requested migration and test procedure was reviewed. The workspace was the only available execution environment; available tool metadata exposed no connected PostgreSQL, Azure, Railway, or remote shell session. This is a historical snapshot superseded by the later reported migration and test checkpoint.

### Commands and actual outcomes

Before access checks, repository status showed the same nine modified tracked files, the two pending migration directories, the five protected recovery files, and this ledger. Nothing was staged or removed. The guard, migration runner, Prisma schema fields, and both migration SQL files were re-read. The guard enforces PostgreSQL protocol, exact approved host, and exact `campus_marketplace_test` database, and the migration runner invokes `prisma migrate deploy` only after importing the guard. The SQL remains the expected nullable `removedAt` plus index, and nullable UUID `creationKey` plus seller/key unique index. No destructive SQL was found.

Run from `backend/` to inspect sanitized configuration metadata:

```powershell
@'
import "dotenv/config";
function meta(raw) { if (!raw) return null; try { const u=new URL(raw); return {protocol:u.protocol,host:u.hostname,port:u.port||"5432",database:decodeURIComponent(u.pathname.replace(/^\//,"")),sslmode:u.searchParams.get("sslmode")||"not specified"}; } catch { return {configured:true,parseable:false}; } }
const test=meta(process.env.TEST_DATABASE_URL), runtime=meta(process.env.DATABASE_URL);
console.log(JSON.stringify({testVariable:"TEST_DATABASE_URL",test,runtimeVariable:"DATABASE_URL",runtime,databaseNamesDiffer:!!test&&!!runtime&&test.database!==runtime.database},null,2));
'@ | node --input-type=module
```

Outcome: `TEST_DATABASE_URL` metadata is `postgresql:`, host `campus-marketplace-db.postgres.database.azure.com`, port `5432`, database `campus_marketplace_test`, TLS mode `require`. `DATABASE_URL` metadata has the same host/port/protocol and database `campus_marketplace_dev`; database names differ. This validates local configuration metadata and the guard target only, not the remote server's identity.

Run from `backend/` for the one current reachability check:

```powershell
$hostName='campus-marketplace-db.postgres.database.azure.com'; try { $addresses=[System.Net.Dns]::GetHostAddresses($hostName) | ForEach-Object { $_.IPAddressToString }; "DNS_ADDRESSES=$($addresses -join ',')" } catch { "DNS_ERROR=$($_.Exception.GetBaseException().GetType().Name)"; exit 0 }; $client=[System.Net.Sockets.TcpClient]::new(); try { $task=$client.ConnectAsync($hostName,5432); if (-not $task.Wait(5000)) { 'TCP_RESULT=TIMEOUT' } elseif ($client.Connected) { 'TCP_RESULT=CONNECTED' } } catch { "TCP_RESULT=FAILED"; "TCP_ERROR_TYPE=$($_.Exception.GetBaseException().GetType().Name)"; "TCP_ERROR=$($_.Exception.GetBaseException().Message)" } finally { $client.Dispose() }
```

Outcome: DNS resolved to `4.221.164.241`; TCP failed with `SocketException`, “An attempt was made to access a socket in a way forbidden by its access permissions.” The connection stopped before PostgreSQL negotiation. TLS, authentication, remote firewall/network policy, migration state, and database availability were unverified by that attempt.

`npm run prisma:migrate:test`, Prisma migration-status inspection, and all database-backed tests were **not run**. No database changes were made. The five protected files remain present and untouched. `git diff --check` was not rerun in this request; no tracked application source or migration file was edited. Only this progress ledger was updated.

### Minimum action to unblock

The database/network owner must provide an approved runner whose local policy permits a TCP connection to `campus-marketplace-db.postgres.database.azure.com:5432`, and verify that the runner is authorized by the database network rules. From that runner, repeat the existing guard-protected identity check and verify TLS/DB identity before running `npm run prisma:migrate:test`. Do not use development or production targets. After migration status and schema/data preservation checks pass, run the focused security and listing lifecycle/inquiry tests. Stop on any migration error and inspect partial state before any retry.

## Later checkpoint: reported test-database and listing workflow updates (2026-10-19)

**Previously reported status: DATABASE AND AUTOMATED TEST CHECKPOINT PASSED; BROWSER RECOVERY VERIFICATION REMAINS OPEN.**

This report supersedes the earlier connectivity-blocked status for the database and automated checks listed below. Earlier records are retained as historical snapshots. The command output and migration evidence supporting this report are not available in this repository, so the results below are recorded as previously reported and have not been independently verified during this documentation update.

### Database migrations

The following migrations were previously reported as successfully applied to the approved isolated test database, `campus_marketplace_test`, using the guarded test migration workflow. No migration command output or database migration-status artifact is included in this repository:

- `20261019120000_listing_image_soft_removal`
- `20261019123000_listing_creation_idempotency`

The schema changes support soft removal of listing images and idempotent listing creation. The later report states these operations were performed against the test database. No production migration or deployment is recorded in this checkpoint.

### Backend and frontend verification

Previously reported results (supporting command output is not included in this repository):

- Backend test suite: 117 passed, 0 failed.
- Focused listing and verification suite: 84 passed.
- Backend TypeScript build and typecheck: passed.
- Prisma schema validation: passed.
- Frontend production build: passed.
- Targeted ESLint checks: passed.
- `git diff --check`: passed at the reported validation checkpoint.

The full repository lint check still has unrelated existing backend lint errors. Automated test success does not replace manual browser verification.

### Committed changes

The following implementation commits were previously reported as pushed to `origin/main`:

- `bab349d` — `feat: harden listing lifecycle and image management`
- `fe1e043` — `feat: improve listing creation and publishing workflow`

The latest reported Git state was synchronized: local `main` and its `origin/main` remote-tracking reference were at `fe1e043`, with no commits ahead or behind at that time. This remote-tracking reference was not freshly updated or checked against the live remote during this documentation update.

### Remaining acceptance checks

- Reproduce and investigate the browser's draft-save recovery message.
- Verify whether the draft exists before attempting another creation, to avoid duplicates.
- Confirm that a failed save or image upload preserves form data and supports safe recovery.
- Verify image removal, draft discard, editing, and publish confirmation in the browser.
- Confirm the production deployment plan separately. Production deployment has not been verified or performed in this checkpoint.

### Untracked files and safety

The following files remain under review and must not be staged or executed indiscriminately:

- `backend/scripts/cleanup-phase2-test-data.ts`
- `backend/scripts/execute-cleanup-phase2-test-data.ts`
- `backend/scripts/inspect-phase2-test-data.ts`
- `src/services/listingService.original.js`
- `src/services/listingService.recovery-backup.js`

The execute-cleanup script is destructive and must not be run as part of repository cleanup. The recovery backups should remain local until their unique value has been checked. Review `docs/engineering/PROGRESS.md` before committing it.
