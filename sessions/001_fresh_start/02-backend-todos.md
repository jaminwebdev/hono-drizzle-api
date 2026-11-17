# Phase 13 review: expired-session cleanup

Status: Phases through 16 are implemented and verified. Phase 17 is next.

## Roadmap continuity

Workflow update from the user on 2026-11-17: A request to continue with an existing phase authorizes implementing that phase directly from its todos. Do not create another proposed design or ask for another design approval before starting. Make routine implementation choices, keep the change limited to the requested phase, and present the finished result for review and adjustment. Continue to leave commits to the user.

This document continues the same `001_fresh_start` session. It carries forward every phase that was unfinished at handoff, 13–41, from [the original architecture contract](01-architect-todos.md) in the roadmap below. Their todos, expected files, acceptance criteria, suggested commits, and individual approval gates are preserved. Carrying work forward does not approve its implementation.

The original contract also remains the reference for [S1–S8 and the design rationale](01-architect-todos.md#s1-runtime-and-code-boundaries), [sources and precedence](01-architect-todos.md#sources-and-precedence), [the current validation and error-handling conventions](01-architect-todos.md#current-handoff-before-phase-10), [the approval workflow](01-architect-todos.md#approval-and-commit-workflow), and [the incremental-build audit](01-architect-todos.md#incremental-build-audit). Those details and earlier decisions remain in place. Read them alongside the carried-forward phases rather than treating this document as a replacement architecture.

The user approved the phase 13 proposal below. Its eight-file scope replaces the original three-file estimate. Later phases retain their original scope and need separate review. Record each phase's completion in the original roadmap and this carried-forward roadmap together so their statuses agree.

## Spec summary

This contract covers only [phase 13](01-architect-todos.md#phase-13-clean-up-expired-session-records-explicitly). It follows the architecture's S2 environment boundaries, S7 test rules, and S8 session lifecycle, plus [PROJECT_MAP.md](../../PROJECT_MAP.md) rules R1–R4 and R6–R12. Current command and database conventions are in [setup](../../docs/setup.md#configuration).

Add one maintenance file, `src/cleanup-sessions.ts`, containing the cleanup operation and its command entry point. Importing it must not connect or run cleanup. Reuse `readConfig` and `createDatabase`; keep command selection directly in `package.json`.

Implemented commands:

| Command | Explicit environment file | Required mode and database target |
| ------- | ------------------------- | --------------------------------- |
| `db:sessions:cleanup` | `.env.local` | `local`, `127.0.0.1:5433`, `finance_tracker_local` |
| `db:test:sessions:cleanup` | `.env.test` | `test`, `127.0.0.1:5435`, `finance_tracker_test` |
| `db:production:sessions:cleanup` | `.env.production` | `production`, `127.0.0.1:5434`, `finance_tracker_production` |

Each command sets `DATABASE_TASK_MODE`. Before creating a database object, require the supplied mode, `APP_ENV`, host, port, and database to match the selected target. Unknown modes and mismatches fail without connecting. This follows the existing database-task guard pattern without expanding schema-push permissions.

Capture one current time per run. Delete a session when `expires_at <= now` or `last_seen_at <= now - 30 minutes`. Remove at most 100 rows in one atomic statement, then exit. Repeating the command processes another batch. Keep the expiry condition on the delete itself so PostgreSQL can recheck a row after a concurrent activity update. Selecting candidate IDs alone must not authorize deletion of a refreshed session.

Print only the deleted count and a reminder that each run removes at most 100 rows. Failures produce a safe message and a nonzero exit status without database credentials or raw driver errors. Always close the command's database pool. Keep the existing connection and statement timeouts.

There is no new HTTP endpoint or request input. Existing route-level validation, `ApiError`, and central HTTP error formatting remain as they are. No schema, dependency, migration, scheduler, or finance changes are needed. Both expiry fields already have indexes.

## Design rationale

Relevant questions come from `~/.opencode/docs/design_questions.md`, sections 1–7 and 9, lines 19–137.

- The access pattern is a limited deletion using either expiry index. One statement avoids fetching every expired row into application memory. The fixed row limit and existing statement timeout bound each invocation.
- Authentication already rejects expired rows. Cleanup reclaims storage; it does not establish expiry or extend a session's lifetime. Exact cutoff equality must match `requireSession`.
- The deletion is atomic and safe to repeat. A concurrent refresh must be rechecked before deletion. Concurrent logout may reduce the deleted count. No multi-table transaction or retry loop is needed.
- Maintenance runs across users in the explicitly selected database. It deletes only expired sessions and leaves users and live sessions intact. Operating-system access and database credentials control command access; HTTP throttling does not apply.
- Deleted expired sessions need no history or restoration for this project. Logging the count is enough; session IDs, credentials, hashes, and user details are unnecessary.
- PostgreSQL is the only external dependency. A failed run exits and can be retried manually. Caching, queues, frontend state, and additional integrations do not apply to this maintenance command.

## One implementation batch

Expected implementation files: `src/cleanup-sessions.ts`, `package.json`, `tests/unit/cleanup-sessions.test.ts`, `tests/integration/session.test.ts`, and `docs/setup.md`. Update phase 13's completion evidence in `01-architect-todos.md` and this contract after verification. Add the maintenance file to PROJECT_MAP's code map. Total including this contract: eight files.

1. [x] Add the guarded command entry point and single-statement deletion with one supplied time and a fixed maximum of 100 rows.
2. [x] Add the three explicitly configured package commands, safe count/error output, and pool closure on success or failure.
3. [x] Test target rejection before connection and all three accepted target identities with invented unit-test settings. Integration tests use only `createTestDatabase()` and verify both expiry reasons, exact boundaries, live-session and user preservation, the batch limit, repeat runs, and a concurrent activity refresh. Supply time values rather than sleeping.
4. [x] Document the commands, target checks, row limit, repeat-run behavior, and the distinction between authentication expiry and storage cleanup. Include a short cleanup-flow diagram.
5. [x] Run Bun 1.3.14 type checking, lint, unit tests, build, and integration tests against only the isolated test database. Verify the test command entry point there. Preserve its volume and leave the development API under user control. Record results and present the diff for review.

Acceptance: The spec above, architecture S2/S7/S8, and PROJECT_MAP R1–R4/R6–R12. No local or production cleanup is executed during verification. No application tables or volumes are reset. Phase 14 remains outside this batch.

Validation: Bun 1.3.14 type checking, lint, all 84 unit tests, all 83 integration tests, and build passed. The guarded test schema push reported no changes. Cleanup tests cover idle and absolute expiry, exact boundaries, live-session and user preservation, the 100-row limit, repeat runs, a real concurrent activity refresh, successful test-command execution, and safe connection failures. Only the isolated test database was used. Its container was stopped with its volume preserved. No local or production cleanup ran, and the development API remained under user control. No dependencies or schema changed.

Suggested commit after review: `chore: clean up expired sessions with explicit commands`

PAUSE — user must approve before continuing to next batch.

## Remaining roadmap carried forward

The following phases were carried forward from the original contract. Phases 13–16 are now complete, with matching evidence in both roadmaps. Phases 17–41 remain unfinished and require their own approval.

### Phase 13. Clean up expired session records explicitly

Review files, 8: `src/cleanup-sessions.ts`, `package.json`, `tests/unit/cleanup-sessions.test.ts`, `tests/integration/session.test.ts`, `docs/setup.md`, `PROJECT_MAP.md`, this plan, and [the backend contract](02-backend-todos.md).

- [x] Add bounded local, test, and production cleanup commands directly in package.json using the explicitly selected database and idle/absolute cutoff.
- [x] Test that expired sessions are removed while live sessions and users are untouched, without fixtures for any not-yet-created finance table.
- [x] Document manual cleanup and explain that expired rows already fail authentication before removal.

Acceptance: S2, S7–S8; PROJECT_MAP R2–R4, R6–R8, R10–R11. No scheduled worker or broad database reset. Reuse the existing validated settings and driver; cleanup does not implement a second configuration loader.

Validation: Bun 1.3.14 type checking, lint, all 84 unit tests, all 83 integration tests, and build passed. The guarded test schema push reported no changes. Cleanup tests cover idle and absolute expiry, exact boundaries, live-session and user preservation, the 100-row limit, repeat runs, a real concurrent activity refresh, successful test-command execution, and safe connection failures. Only the isolated test database was used. Its container was stopped with its volume preserved. No local or production cleanup ran, and the development API remained under user control. No dependencies or schema changed.

Suggested commit: `chore: clean up expired sessions with explicit commands`

PAUSE — user must approve before continuing to next batch.

### Follow-up after phase 13. Remove the password-work cap

Approved by the user on 2026-11-17. This follow-up changes authentication only and does not approve later phases.

The original `activePasswordWork` counter allowed only two registration, login, or password-change handlers to run together. Two was a conservative choice without a measured resource requirement. Each slot also covered database work, so a slow query could reject another request even when no password operation was running. The user chose to remove this additional constraint for the trusted local learning project.

- [x] Remove `activePasswordWork`, its concurrency checks, and the `try/finally` blocks used only to maintain the counter. Keep registration's duplicate-email error handling.
- [x] Keep the IP, normalized-email, and user attempt limits, bounded counter maps, password rules, Argon2id settings, route validation, session transactions, and central error handling.
- [x] Replace capacity tests with concurrent-request coverage and preserve safe hashing and verification failure checks. Update the API guide and project map.

There is no replacement concurrency limiter or queue. Requests within their attempt limits can perform password work concurrently, which can increase CPU and memory use during a burst. Any future concurrency cap should follow measured resource needs and a separate deployment review. This decision supersedes the password-capacity behavior recorded in the original contract's phase 7 and 9 verification history.

Review files, 6: `src/features/auth.ts`, `tests/integration/auth.test.ts`, `docs/api.md`, `PROJECT_MAP.md`, `01-architect-todos.md`, and `02-backend-todos.md`. All later roadmap details and approval gates remain in place.

Validation: Bun 1.3.14 type checking, lint, all 84 unit tests, all 83 integration tests, build, and Git whitespace checks passed. Updated tests allow three pending registration hashes and four concurrent login/password-change verifications, check that the other credential route can proceed, and preserve safe failure responses. Existing attempt-limit and password-change race tests passed. Integration checks used only the isolated test database; its container was stopped with its volume preserved. No development API was started or stopped. No schema or dependencies changed.

Suggested commit: `refactor: remove the shared password-work cap`

PAUSE — user must approve before continuing to next batch.

### Phase 14. Verify authentication in Requestly

Status: Complete based on the user's manual verification, reported on 2026-11-17.

- [x] Record the user's confirmation that the current authentication flows work in Requestly using collections and routes they created independently.
- [x] Remove the proposed additional test framework, browser suite, dependency installation, and related CI work from the roadmap.

Scope decision: This phase verifies the existing authentication behavior and adds no application feature. The user has completed the manual verification. Existing Bun unit and integration tests remain the automated coverage for validation, cookies, origin checks, expiry, revocation, and concurrent password changes. No import of the tracked collection or additional desktop-header inspection is required to complete this phase.

Documentation changes, 3: `docs/setup.md`, `01-architect-todos.md`, and `02-backend-todos.md`. No runtime, schema, dependency, or collection changes are needed.

Acceptance: S7–S8; PROJECT_MAP R1–R2, R6–R8, R10–R12. Manual verification is attributed to the user. This documentation update does not claim a new automated run or verification of browser cookie enforcement.

Validation: The user confirmed the current auth flows in Requestly. Roadmap consistency and Git whitespace checks passed. No application tests or services were run for this documentation-only update.

Suggested commit: `docs: record manual auth verification and simplify the test roadmap`

PAUSE — user must approve before continuing to next batch.

### Phase 15. Add only the owned accounts table

Review files, 5: `src/db/schema.ts`, `docs/setup.md`, `PROJECT_MAP.md`, `01-architect-todos.md`, and `02-backend-todos.md`.

- [x] Add accounts with immutable session-derived user_id and the S3 money/type/currency constraints.
- [x] Add the user-scoped indexes needed by current account reads, then push while preserving users and sessions.
- [x] Explain the user/account relationship and exact opening-balance representation.

Acceptance: S3, S8; PROJECT_MAP R3, R5, R8–R11. There is one finance table plus two auth tables. No transaction, tag, or category placeholders. Ownership cannot be transferred by an API field.

Validation: Bun 1.3.14 type checking, lint, all 84 unit tests, all 83 integration tests, and build passed. The guarded schema push added accounts only to the isolated test database. Schema checks confirmed required columns, the owner index, defaults, allowed types/currencies, exact money boundaries, invalid-name and non-finite-value rejection, missing-owner rejection, and restricted user deletion. Before/after comparisons confirmed unchanged users and sessions; all schema-check fixtures rolled back. The test container was stopped with its volume preserved. No local schema push or development API control occurred. No dependencies or migration files were added.

Implementation note for phase 16: Bun SQL can omit trailing zeros from numeric strings. Select `opening_balance::text` or otherwise preserve exact two-decimal output without converting money to a JavaScript number. Ownership, currency, and opening balance immutability are enforced by the later route contracts, not by the foreign key alone.

Suggested commit: `feat: define user-owned accounts`

PAUSE — user must approve before continuing to next batch.

### Phase 16. Create accounts and read owned details

Review files, 9: `src/features/accounts.ts`, `src/app.ts`, `tests/integration/accounts.test.ts`, `docs/api.md`, `docs/setup.md`, `requests/finance.json`, `PROJECT_MAP.md`, `01-architect-todos.md`, and `02-backend-todos.md`.

- [x] Derive allowed account-create fields from the accounts table, add strict API rules and ID validation, and wire route-level validators, handlers, and queries together with existing session/Origin checks.
- [x] Set ownership from the authenticated context and return 404 for another user's account.
- [x] Test exact opening balances, currency/type rules, rejected owner fields, unauthenticated access, rejected write origins, and cross-user detail access.
- [x] Add a Requestly-authenticated create/detail example and trace its actual middleware/query path.

Acceptance: S1, S3, S5, S8; PROJECT_MAP R3, R5–R8, R10–R12. Reuse auth/HTTP code already reviewed. No account list, editing, tags, or categories yet. A valid session is necessary but never sufficient to access another user's ID.

Validation: Bun 1.3.14 type checking, lint, all 84 unit tests, all 167 integration tests, and build passed. The guarded test schema push reported no changes. Account tests cover exact money boundaries and defaults, supported types/currencies, strict fields and IDs, session-required access, origin rejection, two-user ownership, JSON parsing, and safe database failures. Input-schema checks share the account integration suite, matching the auth suite. Test fixtures delete only their own accounts and users. The isolated test container was stopped with its volume preserved; the development API was not started or stopped. No schema or dependencies changed.

Request flow: Shared HTTP checks enforce the Origin policy on account creation. Session middleware validates the cookie and supplies the user. Route-level validators accept only the allowed fields. POST inserts with the session owner; GET selects by both account ID and owner. Both return explicit public fields and `opening_balance::text` for exact two-decimal strings. Foreign accounts and missing accounts return the same safe 404.

Suggested commit: `feat: create accounts and read owned details`

PAUSE — user must approve before continuing to next batch.

### Phase 17. List and search owned accounts

Expected files, 5: `src/features/accounts.ts`, `tests/unit/accounts.test.ts`, `tests/integration/accounts.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add bounded account lists with name search, archive filtering, and stable name/ID ordering.
- [ ] Keep every search/count query scoped to the current user and validate singleton query parameters.
- [ ] Test bounds, literal pattern characters, filters, and another user's records being absent from results; document the current URLs.

Acceptance: S3, S5, S8; PROJECT_MAP R3, R5–R8, R10–R11. No editing/deletion is bundled into this commit. Names and cursors do not provide cross-user access. Run focused account tests and available checks.

Suggested commit: `feat: list and search owned accounts`

PAUSE — user must approve before continuing to next batch.

### Phase 18. Rename and archive owned accounts

Expected files, 4: `src/features/accounts.ts`, `tests/integration/accounts.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Derive patches from the allowed name/archive fields, reject empty patches and unknown fields, and keep money/currency/owner immutable.
- [ ] Apply the owned-row lock/update path that later transaction creation will coordinate with.
- [ ] Test archive/unarchive, cross-user writes, rejected write origins, protected fields, and safe errors; extend the lifecycle examples.

Acceptance: S3–S4, S8; PROJECT_MAP R3, R5–R8, R10–R11. No transaction lookup is added before that table exists. Account metadata uses last accepted write, and ownership stays immutable.

Suggested commit: `feat: rename and archive owned accounts`

PAUSE — user must approve before continuing to next batch.

### Phase 19. Delete an unused owned account

Expected files, 4: `src/features/accounts.ts`, `tests/integration/accounts.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add account deletion for the current accounts-only finance schema using the existing owner/session/origin checks.
- [ ] Test owned deletion, repeated/missing IDs, and another user's account remaining intact.
- [ ] Document the current deletion behavior and the reference restrictions that will arrive with transactions.

Acceptance: S3–S5, S8; PROJECT_MAP R3, R5–R8, R10–R11. Do not query future tables or install generic cascade helpers. This is a separate deletion commit that leaves the completed accounts feature usable.

Suggested commit: `feat: delete unused owned accounts`

PAUSE — user must approve before continuing to next batch.

### Phase 20. Add owned transaction and history tables

Expected files, 4: `src/db/schema.ts`, `src/features/accounts.ts`, `tests/integration/accounts.test.ts`, `docs/setup.md`.

- [ ] Add transactions/history with user_id, same-owner account foreign keys, exact signed amounts, versions, and the initial feature indexes; add the required composite reference key to accounts now.
- [ ] Push while preserving existing accounts, users, and sessions; omit all tag/category fields.
- [ ] Extend account deletion to map current/history reference conflicts to RESOURCE_IN_USE and test that application rule.
- [ ] Document the three-finance-table diagram and history survival after current-record removal.

Acceptance: S3–S4, S8; PROJECT_MAP R3, R5–R6, R8–R11. Three finance tables plus two auth tables exist. Cross-owner references fail at the database boundary as well as in handlers. No endpoint implementation for future features.

Suggested commit: `feat: define owned transactions and retained history`

PAUSE — user must approve before continuing to next batch.

### Phase 21. Create transactions and read owned details

Expected files, 6: `src/features/transactions.ts`, `src/app.ts`, `tests/unit/transactions.test.ts`, `tests/integration/transactions.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Derive allowed transaction fields, keep money/timestamp JSON rules explicit, and add create/detail route validators with the existing session middleware and required Origin checks.
- [ ] Lock the owned active account and atomically insert the transaction plus initial history with the authenticated owner.
- [ ] Test signed amounts, timestamps, archived/missing/foreign accounts, rejected owner/tag/category fields, and snapshot-failure rollback.
- [ ] Return version/ETag and document a current-field-only request, including the lack of automatic POST retries.

Acceptance: S3–S5, S7–S8; PROJECT_MAP R3, R5–R8, R10–R12. No current transaction can commit without its history. Foreign account IDs return 404. Earlier auth/account walkthroughs still work.

Suggested commit: `feat: create owned transactions with initial history`

PAUSE — user must approve before continuing to next batch.

### Phase 22. Correct transactions and inspect history

Expected files, 4: `src/features/transactions.ts`, `tests/integration/transactions.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add transaction patches with required If-Match, owned-row locking, and an appended snapshot.
- [ ] Add the bounded owner-scoped history endpoint for the current transaction model.
- [ ] Test stale/concurrent patches, hash-free errors, snapshot rollback, and foreign IDs returning 404 before version errors; document corrections.

Acceptance: S3–S4, S7–S8; PROJECT_MAP R3, R5–R8, R10–R11. Money, description, and occurrence time can change; account/user cannot. Tag/category patches remain unknown fields. No delete endpoint is bundled here.

Suggested commit: `feat: correct transactions with version checks and history`

PAUSE — user must approve before continuing to next batch.

### Phase 23. Delete transactions while retaining owned history

Expected files, 5: `src/features/transactions.ts`, `tests/integration/transactions.test.ts`, `tests/integration/accounts.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add version-checked transaction deletion with its final snapshot and atomic current-row removal.
- [ ] Keep history readable only by its owner after deletion and keep used-account deletion restricted.
- [ ] Test patch/delete races, history-write rollback, cross-user deleted-history access, and transaction creation versus account archival.

Acceptance: S3–S4, S7–S8; PROJECT_MAP R3, R5–R8, R10–R11. Deletion cannot erase audit snapshots or allow a foreign user to inspect them. Revoked sessions and rejected origins cannot reach the mutation. Run focused transaction/account integration tests.

Suggested commit: `feat: delete transactions and preserve owned history`

PAUSE — user must approve before continuing to next batch.

### Phase 24. Browse and filter owned transactions

Expected files, 5: `src/features/transactions.ts`, `tests/unit/transactions.test.ts`, `tests/integration/transactions.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add bounded occurrence-time/ID cursor lists and description, account, date, and signed-amount filters.
- [ ] Apply current-user scope to every query, validating foreign account filters and cursor shape without trusting cursor ownership.
- [ ] Test tied timestamps, bounds, literal matching, filter intersections, and a cursor copied from another user; document current search URLs.

Acceptance: S3, S5, S7–S8; PROJECT_MAP R3, R5–R8, R10–R11. No tag/category filters. A foreign account filter returns 404 and a foreign cursor cannot expose records. Lists are not frozen snapshots under concurrent edits.

Suggested commit: `feat: browse and filter owned transactions`

PAUSE — user must approve before continuing to next batch.

### Phase 25. Calculate exact owned account balances

Expected files, 4: `src/features/accounts.ts`, `tests/integration/accounts.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add the balance endpoint using owned-account opening balance and exact current-transaction sums.
- [ ] Return currency and defined empty totals without storing a mutable balance.
- [ ] Test fractions, debt, corrections/deletion, and foreign accounts or movements being excluded; extend the account walkthrough.

Acceptance: S3–S5, S8; PROJECT_MAP R3, R5–R8, R10–R11. 0.10 plus 0.20 is exactly 0.30 as decimal strings. Ownership is checked before aggregation, including empty accounts. History is not counted twice.

Suggested commit: `feat: calculate exact owned account balances`

PAUSE — user must approve before continuing to next batch.

### Phase 26. Summarize the implemented transaction filters

Expected files, 4: `src/features/transactions.ts`, `tests/integration/transactions.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add the fixed summary route before /:id using only current transaction filters.
- [ ] Return income, positive expense magnitude, and signed net totals separately per currency and user.
- [ ] Test route ordering, filters, empty results, cross-user exclusion, and pagination independence; record representative query plans.

Acceptance: S3, S5, S7–S8; PROJECT_MAP R3, R5–R8, R10–R11. Opening balances are not movement totals and different currencies never mix. No generic reporting layer or unmeasured capacity claim.

Suggested commit: `feat: summarize owned transaction movements`

PAUSE — user must approve before continuing to next batch.

### Phase 27. Seed accounts and transactions for an explicit user

Expected files, 4: `scripts/seed.ts`, `package.json`, `tests/integration/seed.test.ts`, `docs/setup.md`.

- [ ] Add the local-only guarded seed command requiring an existing SEED_USER_ID; never create/reset login credentials.
- [ ] Insert stable owned account/transaction/history fixtures atomically while preserving existing user edits and failing safely on conflicts.
- [ ] Test mode/owner refusal, repeat runs, preserved edits, and another user's data; document expected balances and IDs.

Acceptance: S2–S4, S7–S8; PROJECT_MAP R4–R12. Only current auth and three finance tables are used. No sessions, passwords, tag/category placeholders, truncation, or production seeding.

Suggested commit: `feat: seed finance examples for an explicit local user`

PAUSE — user must approve before continuing to next batch.

### Phase 28. Define tags and create an owned tag

Expected files, 7: `src/db/schema.ts`, `src/features/tags.ts`, `src/app.ts`, `tests/integration/tags.test.ts`, `docs/setup.md`, `docs/api.md`, `requests/finance.json`.

- [ ] Add only owned tags with per-user normalized name uniqueness and push without changing existing records.
- [ ] Derive allowed tag input fields and add strict route-level validators for authenticated create and owner-scoped detail routes, keeping the required Origin check on creation.
- [ ] Test normalization, same name across users, duplicate names within one user, foreign detail IDs, and rejected owner fields; document the catalog.

Acceptance: S3, S5, S8; PROJECT_MAP R3, R5–R11. Four finance tables plus two auth tables. No tag links or account/transaction tag arrays yet. Schema and the first small tag request are one bounded feature step.

Suggested commit: `feat: define and create owned tags`

PAUSE — user must approve before continuing to next batch.

### Phase 29. List rename and delete unlinked tags

Expected files, 4: `src/features/tags.ts`, `tests/integration/tags.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add bounded owned tag lists, rename, and current unlinked-tag deletion using existing validation/middleware patterns.
- [ ] Test query limits, duplicate rename, empty patches, cross-user writes, and deletion.
- [ ] Extend the Requestly walkthrough with these catalog requests, keeping future link semantics out of current code.

Acceptance: S3–S5, S8; PROJECT_MAP R3, R5–R8, R10–R12. This small metadata catalog uses already reviewed patterns and one feature file. If it becomes large, split deletion into the next gate before implementing links.

Suggested commit: `feat: manage the owned tag catalog`

PAUSE — user must approve before continuing to next batch.

### Phase 30. Attach owned tags to owned accounts

Expected files, 8: `src/db/schema.ts`, `src/features/accounts.ts`, `src/features/tags.ts`, `tests/integration/account-tags.test.ts`, `scripts/seed.ts`, `docs/api.md`, `docs/setup.md`, `requests/finance.json`.

- [ ] Add account_tags with same-owner foreign keys and a reverse lookup index; add the required composite reference key to tags, then push.
- [ ] Add account tag reads and atomic replacement under the owned-account lock; restrict deletion of linked tags.
- [ ] Test missing/foreign/duplicate tags, clearing, rollback, and scoped deletion conflicts; add owned seed links and current diagrams.

Acceptance: S3–S5, S7–S8; PROJECT_MAP R3, R5–R12. Five finance tables plus two auth tables. Accounts without tags still work. Transaction code has no tag dependency yet. Avoid per-account query loops.

Suggested commit: `feat: label owned accounts with owned tags`

PAUSE — user must approve before continuing to next batch.

### Phase 31. Attach owned tags to owned transactions

Expected files, 8: `src/db/schema.ts`, `src/features/transactions.ts`, `src/features/tags.ts`, `tests/integration/transaction-tags.test.ts`, `scripts/seed.ts`, `docs/api.md`, `docs/setup.md`, `requests/finance.json`.

- [ ] Add transaction_tags with same-owner references and a reverse index; add the required composite reference key to transactions, then push without rewriting old history.
- [ ] Add tag reads and version-checked tag replacement in the existing transaction/snapshot write; restrict linked-tag deletion.
- [ ] Test foreign tags, stale edits, rollback, clearing, old snapshots, and deletion history; extend owned seeds and examples.

Acceptance: S3–S5, S7–S8; PROJECT_MAP R3, R5–R12. Six finance tables plus two auth tables. Money and tag edits share one transaction version. Missing old snapshot fields remain readable without a history backfill.

Suggested commit: `feat: label owned transactions with versioned tags`

PAUSE — user must approve before continuing to next batch.

### Phase 32. Search owned records and summaries by tags

Expected files, 5: `src/features/accounts.ts`, `src/features/transactions.ts`, `tests/integration/tag-search.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add direct tag-name and all-requested-tag conditions to the existing owned account/transaction searches.
- [ ] Apply the same transaction filters to summaries using duplicate-free EXISTS-style conditions.
- [ ] Test intersections, foreign tags, multiple matches, tag renames, and unchanged exact sums; document repeated tagId URLs.

Acceptance: S3, S5, S7–S8; PROJECT_MAP R3, R5–R8, R10–R11. Foreign reference filters return 404; they do not reveal whether the tag exists. Account tags and transaction tags remain separate meanings. Finish tags before starting categories.

Suggested commit: `feat: filter owned records and totals by tags`

PAUSE — user must approve before continuing to next batch.

### Phase 33. Define categories and create an owned category

Expected files, 7: `src/db/schema.ts`, `src/features/categories.ts`, `src/app.ts`, `tests/integration/categories.test.ts`, `docs/api.md`, `docs/setup.md`, `requests/finance.json`.

- [ ] Add only owned categories with stable income/expense kinds and per-user kind/name uniqueness, then push.
- [ ] Derive allowed category input fields and add strict create/detail route validators with existing session/origin/ownership checks.
- [ ] Test normalized duplicates, names reused by other users or kinds, missing/foreign IDs, and protected fields; document the current catalog.

Acceptance: S3, S5, S8; PROJECT_MAP R3, R5–R11. Seven finance tables plus two auth tables now exist. Transactions still have no category_id. No global category records or foreign-owner defaults.

Suggested commit: `feat: define and create owned categories`

PAUSE — user must approve before continuing to next batch.

### Phase 34. List rename and delete unused categories

Expected files, 5: `src/features/categories.ts`, `tests/integration/categories.test.ts`, `scripts/seed.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add bounded owned category lists, renaming, and current unreferenced deletion.
- [ ] Reject kind/owner changes and test empty patches, duplicates, cross-user writes, and list bounds.
- [ ] Add owned catalog seed fixtures and Requestly examples before transaction assignment is implemented.

Acceptance: S3–S5, S7–S8; PROJECT_MAP R3, R5–R12. Categories work independently. Their immutable kind preserves the sign rule that the next phase will enforce. Split catalog deletion if the implementation exceeds a small metadata change.

Suggested commit: `feat: manage the owned category catalog`

PAUSE — user must approve before continuing to next batch.

### Phase 35. Assign owned categories to transactions

Expected files, 8: `src/db/schema.ts`, `src/features/transactions.ts`, `src/features/categories.ts`, `tests/integration/transaction-categories.test.ts`, `scripts/seed.ts`, `docs/api.md`, `docs/setup.md`, `requests/finance.json`.

- [ ] Add nullable category_id with its same-owner foreign key and user/category index, adding the required category reference key now; push while preserving uncategorized rows.
- [ ] Add optional assignment/clearing and sign checks to transaction create/patch; restrict deletion of categories in use.
- [ ] Extend snapshots without rewriting earlier history and test foreign categories, sign-changing amount-only patches, deletion races, and rollback.
- [ ] Extend owned seed assignments and current examples/diagrams.

Acceptance: S3–S5, S7–S8; PROJECT_MAP R3, R5–R12. No category search or summary change is bundled here. Existing sessions, accounts, tags, transactions, and old snapshots remain usable after the additive push.

Suggested commit: `feat: categorize owned transactions safely`

PAUSE — user must approve before continuing to next batch.

### Phase 36. Filter transactions and summaries by category

Expected files, 4: `src/features/transactions.ts`, `tests/integration/transaction-categories.test.ts`, `docs/api.md`, `requests/finance.json`.

- [ ] Add owner-validated category filters to existing transaction lists and summaries.
- [ ] Test category intersections with dates, amounts, and tags, including foreign references and duplicate-free sums.
- [ ] Run the accumulated authenticated walkthrough and reconcile the completed model with S3.

Acceptance: S3, S5, S7–S8; PROJECT_MAP R3, R5–R8, R10–R12. All finance features are now present in the requested order. This query extension changes no schema and preserves the existing cursor/summary rules.

Suggested commit: `feat: filter owned transactions and totals by category`

PAUSE — user must approve before continuing to next batch.

### Phase 37. Verify the guides and Requestly collection built along the way

Expected files, 5: `README.md`, `docs/setup.md`, `docs/api.md`, `requests/auth.json`, `requests/finance.json`.

- [ ] Replay registration/login and the complete owned-finance walkthrough, correcting stale examples and commands.
- [ ] Verify the existing Requestly exports contain no live credentials or cookies and demonstrate the cookie reuse and explicit Origin flow.
- [ ] Check diagram/link accuracy, current schema/push instructions, and two-user test instructions without adding future auth features.

Acceptance: S1–S8; PROJECT_MAP R7–R12. Docs and collection requests were added during their owning phases; this is a consistency pass. If more than nine files need changes, split the review. Do not postpone first explanations until this phase.

Suggested commit: `docs: verify the authenticated finance API walkthrough`

PAUSE — user must approve before continuing to next batch.

### Phase 38. Build the production API image

Expected files, 4: `Dockerfile`, `.dockerignore`, `package.json`, `docs/operations.md`.

- [ ] Reconcile the retained image with the real Bun 1.3.14 build, nonroot runtime, production dependencies, and startup arguments.
- [ ] Keep environment files, Requestly secrets, and test fixtures out of image layers. HTTPS termination for public hosting remains a separate deployment decision.
- [ ] Build the image and document its supplied settings and port behavior without starting a production stack.

Acceptance: S1–S2, S6, S8; PROJECT_MAP R1–R4, R7–R8, R11. This phase changes packaging only. No schema push, seed, public deployment, or certificate-authority modification occurs during the build.

Suggested commit: `chore: build the production Bun API image`

PAUSE — user must approve before continuing to next batch.

### Phase 39. Smoke-test the isolated production stack and recovery steps

Expected files, 3: `compose.production.yaml`, `package.json`, `docs/operations.md`.

- [ ] Reconcile the fresh production identity, explicit database addresses, HTTP health check, and loopback publication. This image check requires no local certificates.
- [ ] Add explicit host production push/start commands; start the database, push, then run image health and database connectivity checks. Production auth over HTTPS belongs to the separate deployment review; do not relax production cookies for this HTTP image check.
- [ ] Validate backup/restore to a separate scratch database and document schema-push recovery and the remaining public-service prerequisites.

Acceptance: S2, S6–S8; PROJECT_MAP R2–R4, R7–R12. No shared local/test volume, embedded secrets, automatic startup push, or global TLS-verification bypass. This is a local deployment check, not publication.

Suggested commit: `chore: verify production Compose and database recovery`

PAUSE — user must approve before continuing to next batch.

### Phase 40. Automate host checks and database tests

Expected files, 3: `.github/workflows/ci.yaml`, `package.json`, `docs/setup.md`.

- [ ] Add CI with pinned Bun, frozen dependencies, type checking, lint, build, and unit tests.
- [ ] Push schema and run host integration tests with per-job PostgreSQL identities, the local HTTP test origin, and guarded cleanup.
- [ ] Verify two-user isolation checks run and no workflow uses real environment files or prunes unrelated volumes.

Acceptance: S1–S2, S7–S8; PROJECT_MAP R1–R2, R4, R6–R12. Only PostgreSQL runs in Docker for development/integration tests. The existing Bun test runner drives the tests. Keep image automation for the next commit.

Suggested commit: `ci: verify host Bun checks and isolated database tests`

PAUSE — user must approve before continuing to next batch.

### Phase 41. Automate the image check and reconcile project truth

Expected files, 3: `.github/workflows/ci.yaml`, `PROJECT_MAP.md`, `docs/setup.md`.

- [ ] Add the existing production image build/health smoke flow to CI after the host checks, with isolated resources and loopback HTTP health checks.
- [ ] Run the complete checks and report unresolved failures without marking incomplete phases done.
- [ ] Reconcile the ledger and setup tool notes with implemented auth, ownership, push-only schema changes, and the actual completion state.

Acceptance: S1–S8; PROJECT_MAP R1–R12. No public deployment, future auth-provider work, or extra feature tables. All cleanup is scoped to this run. The user still makes the commits.

Suggested commit: `ci: verify the image and record the completed architecture`

PAUSE — user must approve before continuing to next batch.

## Relay

Phases 13–16 are complete, including the password-work simplification, manual Requestly verification, accounts schema, and account create/detail endpoints. Phase 17 is next. Implement its existing todos when requested, without another proposal or design-approval step. All remaining phases are preserved above and in the architecture contract. The user makes all commits and controls the development API.
