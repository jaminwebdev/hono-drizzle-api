# Project instructions

## Writing

- Use beginner-friendly language in documentation, plans, comments, and explanations.
- Keep documents concise while fully explaining the purpose, behavior, setup steps, and relevant tradeoffs. Remove repetition and filler, not useful detail.
- Prefer familiar words. Explain necessary technical terms and abbreviations the first time they appear.
- Write complete sentences with concrete examples. Include technical details when they help the reader understand or act.
- Use Mermaid diagrams generously to explain relationships, request flows, architecture, and setup workflows. Give diagrams plain-language labels and a short explanation. Use tables when they make comparisons easier.
- Apply the `unslop` skill when drafting or editing prose. Read `~/.opencode/skills/unslop/SKILL.md`.
- Keep exact command names, file paths, API fields, and code syntax intact when simplifying surrounding prose.

## Development workflow

- Use Bun 1.3.14 for the runtime, package commands, and built-in tests. Commit `bun.lock` with dependency changes. Do not reintroduce npm or the Hono Node adapter.

- Develop on the host with Bun. Run the API, Drizzle tools, and checks locally. Only PostgreSQL runs in Docker during development and integration testing. Keep a production API image for CI/deployment checks.
- Keep feature validation, route handlers, and database queries together in one readable feature file. Do not introduce controller/service/repository layers or feature-specific helper chains. Use shared code for concrete cross-cutting behavior such as JSON parsing, error responses, and middleware. Prefer explicit steps over deep abstractions and nested one-line handlers.
- Keep commands directly in package.json. Use Bun's explicit environment-file support for local commands; keep automatic loading disabled. Configuration validates supplied values without reading files or guessing connection targets.
- Follow the approved gates in `docs/01-architect-todos.md`. Pause for review between gates.
- Leave Git commits to the user.
