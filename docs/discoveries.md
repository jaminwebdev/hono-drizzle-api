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
