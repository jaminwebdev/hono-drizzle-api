# Project discoveries

## Initial planning — 2026-10-22

- The workspace initially contains `setup.md`, `API_design.md`, and `database_design.md`; no application, package manifest, or project ledger exists. **Why this matters:** the plan starts with scaffolding and treats architecture choices as proposed until reviewed.
- Initially, `git status` reported no usable repository. The user subsequently confirmed they initialized Git. **Why this matters:** initialization is no longer outstanding; commits remain the user's responsibility.
- The requested workflow explicitly requires small increments, review gates, and manual commits. **Why this matters:** author the plan first; implementation must follow the approved gates rather than build the entire API immediately.
- The database reference recommends safe schema evolution, while `setup.md` explicitly chooses pushes instead of migration files. **Why this matters:** retain backup, review, constraint, and restore practices while using Drizzle Kit push as requested.
- The user confirmed that all application and tooling workflows should run in Docker. **Why this matters:** API and tooling consistently connect to `db:5432`; document direct Compose commands so host Node/npm is not required.
