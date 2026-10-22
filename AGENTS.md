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

- Run the application, database, development tools, and checks in Docker. Do not require a host Node.js installation.
- Follow the approved gates in `01-architect-todos.md`. Pause for review between gates.
- Leave Git commits to the user.
