# Project discoveries

## Initial planning — 2026-10-22

- The workspace initially contains `setup.md`, `API_design.md`, and `database_design.md`; no application, package manifest, or project ledger exists. **Why this matters:** the plan starts with scaffolding and treats architecture choices as proposed until reviewed.
- Initially, `git status` reported no usable repository. The user subsequently confirmed they initialized Git. **Why this matters:** initialization is no longer outstanding; commits remain the user's responsibility.
- The requested workflow explicitly requires small increments, review gates, and manual commits. **Why this matters:** author the plan first; implementation must follow the approved gates rather than build the entire API immediately.
- The database reference recommends safe schema evolution, while `setup.md` explicitly chooses pushes instead of migration files. **Why this matters:** retain backup, review, constraint, and restore practices while using Drizzle Kit push as requested.
- The user confirmed that all application and tooling workflows should run in Docker. **Why this matters:** API and tooling consistently connect to `db:5432`; document direct Compose commands so host Node/npm is not required.

## Gate 1

- Documentation now lives in `docs/`. The root `AGENTS.md` points to the moved plan. **Why this matters:** future work must follow the current paths.
- Docker was initially unavailable in WSL. After the user refreshed WSL Integration, the CLI and Compose became available, but this session received permission denied when connecting to `/var/run/docker.sock`. **Why this matters:** Compose configuration can be checked here, but dependency installation, lockfile generation, tests, and compilation cannot yet be verified. Do not mark Gate 1 complete without those checks.
- `compose.tools.yaml` supplies the Docker tooling needed before Gate 3. **Why this matters:** Gate 1 must also work without host Node.js. Installed dependencies stay in temporary container storage; the lockfile and build output persist in the project.
- The existing `unslop` skill remains at `/home/jamin/.opencode/skills/unslop/SKILL.md`; the global Codex copy was not present when checked. **Why this matters:** follow the path in `AGENTS.md` rather than assuming the earlier manual copy took place.
- The user's first Docker run created `package-lock.json`, but installation failed with `EACCES` when esbuild tried to run its native program. The temporary dependency mount now explicitly includes `exec`. **Why this matters:** write permissions alone do not permit program execution. Confirm the fix by rerunning installation and checks; this session still cannot access the Docker socket.
- ESLint 9 is no longer maintained. Gate 1 now selects ESLint 10 and a TypeScript lint plugin version that supports it. **Why this matters:** regenerate the lockfile before running `npm ci`; the previous lockfile still reflects ESLint 9.
- After the fixes, the user reran the Docker commands successfully. The three request tests passed, and the build created `dist/server.js` without reported errors. The refreshed lockfile matches the package manifest and selects ESLint 10.13.0. **Why this matters:** Gate 1 is ready for review. Its runtime checks were user-run, not independently run by the assistant.

## Gate 2

- Configuration has two explicit sources. File mode reads just the selected `.env.local` or `.env.production` using Node's environment-file parser. Environment mode reads values supplied to the container. Neither mode merges in another source. **Why this matters:** missing production credentials cannot be silently filled from local settings.
- Development now requires `.env.local` with database credentials, even though database connections start in Gate 4. **Why this matters:** startup validates the complete shared settings early; tests and builds still need no real secrets.
- The earlier plan mentioned host connection switching. The confirmed Docker-only workflow instead fixes container connections at `db:5432`; `POSTGRES_PORT` is only for optional host access. **Why this matters:** changing the published database port must not redirect container traffic.
- Gate 2 introduces Zod. Docker socket access remains blocked for the assistant. **Why this matters:** the user must refresh the lockfile and run Docker checks before this gate is marked verified.
- The user refreshed the lockfile and ran all Gate 2 checks successfully: type checking, linting, 25 tests, and the build. **Why this matters:** Gate 2 is ready for review. Docker works from the user's WSL terminal despite the assistant session's socket-access restriction; npm notices did not prevent installation or checks.

## Gate 3

- PostgreSQL 18's official image uses version-specific data directories beneath `/var/lib/postgresql`; the volume is mounted at that parent path. **Why this matters:** older examples mounting only `/var/lib/postgresql/data` do not match this image's default layout. Reference: [official PostgreSQL image](https://hub.docker.com/_/postgres).
- Local and production use separate Compose project names and volumes. The production example uses API port 3001 and database host port 5434 to avoid local defaults. **Why this matters:** both setups can run without sharing database storage or published ports.
- Development and check containers now reuse dependencies installed in the development image. Only source, tests, and configuration folders are shared. **Why this matters:** ordinary checks avoid repeated installation and do not populate host `node_modules`. Dependency changes require an image rebuild.
- The host helper clears inherited project settings before Compose reads the selected file. **Why this matters:** Compose otherwise lets shell values override file values, which could mix credentials between environments.
- Docker socket access is still blocked for the assistant. **Why this matters:** static Compose and shell checks passed here, but image builds, service health, and persistence need the user-run verification script before accepting Gate 3.
- The user completed `scripts/verify-docker.sh` successfully. All 26 tests, type checking, linting, and compilation passed. Both local services became healthy, the API responded before and after restart, and the probe row survived. The runtime image built and passed its non-root, TypeScript exclusion, and environment-file exclusion checks. **Why this matters:** Gate 3 is verified and ready for review. These are user-run results; the full production stack was not started. Local services remain running.
