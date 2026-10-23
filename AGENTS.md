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

- Use the hybrid workflow: install locked dependencies locally for editor type checking, while running the application, database, and verification checks in Docker. Local dependencies must stay separate from container dependencies.
- Follow the approved gates in `docs/01-architect-todos.md`. Pause for review between gates.
- Leave Git commits to the user.
