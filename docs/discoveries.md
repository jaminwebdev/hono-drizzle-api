# Project notes

These notes explain current tool behavior and decisions. Project rules live in [PROJECT_MAP.md](../PROJECT_MAP.md).

## Environment files

`env = false` in `bunfig.toml` disables automatic environment-file loading for application, check, and build commands. `bun run dev` explicitly selects `.env.local`. Configuration code must validate supplied values rather than read environment files itself.

Bun 1.3.14's package manager ignores those controls and reads default files such as `.env.local` and `.env.production`. Run dependency installation in a checkout without environment files. For an existing checkout, move those files outside the checkout during package commands and restore them afterward. A clean temporary installation directory also works without moving project credentials.

Why: runtime environment controls do not cover the pinned version's package manager. Keeping environment files out of dependency installation prevents package commands from receiving application credentials. See the [upstream Bun issue](https://github.com/oven-sh/bun/issues/31450) and [runtime environment settings](https://bun.sh/docs/runtime/environment-variables).

## TypeScript and lint compatibility

The scaffold pins TypeScript 6.0.3 and typescript-eslint 8.72.1. That lint version supports TypeScript below 6.1.0. Bun's type package is pinned to 1.3.14 to match the runtime.

Why: installing the newest TypeScript release independently can exceed the lint tooling's supported range. Check peer dependencies when changing these packages and include `bun.lock` with dependency changes.

## PostgreSQL volume layout

PostgreSQL 18 uses `/var/lib/postgresql/18/docker` as its default data directory. The retained Compose files correctly mount the named volume at `/var/lib/postgresql`.

Why: PostgreSQL 17 examples often use `/var/lib/postgresql/data`, which is a different image layout. Preserve the PostgreSQL 18 mount and isolate database storage through Compose project names. An explicit global volume name bypasses that project naming boundary. See the [PostgreSQL image documentation](https://hub.docker.com/_/postgres) and [Compose volume names](https://docs.docker.com/reference/compose-file/volumes/#name).
