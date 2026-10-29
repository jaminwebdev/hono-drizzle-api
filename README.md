# Finance tracker API

A Bun 1.3.14, Hono, and PostgreSQL API built incrementally as a learning exercise. The current application has health checks and shared request handling; authentication and finance features come next.

## Quick start

Complete the [first-time setup](docs/setup.md#first-time-setup), then run:

```sh
bun run db:up
bun run dev
```

Keep the API in your terminal and press `Ctrl+C` to stop it. In Requestly desktop, send `GET http://127.0.0.1:3000/health/live` to check it.

## Reference

| Need | Read |
| --- | --- |
| Install, configure, run, check, or build the project; understand database storage and tool limitations | [Setup guide](docs/setup.md) |
| Use health endpoints, understand errors and origins, or follow the middleware | [API guide](docs/api.md) |
| Find code responsibilities and project rules | [Project map](PROJECT_MAP.md) |
| Review the next implementation step and its approval gate | [Implementation plan](sessions/001_fresh_start/01-architect-todos.md) |
