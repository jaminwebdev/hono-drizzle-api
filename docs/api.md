# API guide

Use `http://127.0.0.1:3000` with the local settings. Start the API in your terminal as described in [setup](setup.md). Authentication and finance endpoints do not exist yet.

## Health requests

| Request | Response |
| --- | --- |
| `GET /health/live` | `200` with `{"status":"ok"}`. Makes no database query. |
| `GET /health/ready` | Runs `SELECT 1` through Drizzle. Returns the same success body, or `503` with error code `DATABASE_UNAVAILABLE`. |
| `HEAD` on either health URL | Uses the GET behavior and returns headers without a body. |

Readiness uses the existing database timeouts. It has no separate deadline or connection-reservation logic.

Every response has a server-generated `X-Request-Id` and `Cache-Control: no-store`. The server ignores any request ID supplied by a client. Browser security headers include `X-Content-Type-Options: nosniff`. Local HTTP responses do not include Strict-Transport-Security, which tells browsers to require HTTPS.

## Errors

All API errors use this shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "The requested resource was not found.",
    "status": 404,
    "requestId": "4d598d39-dc7a-4ca5-aab6-509ad69080d1",
    "timestamp": "2026-10-29T18:30:00.000Z"
  }
}
```

The request ID matches the response header. The timestamp uses UTC. Unexpected failures return a generic message; responses do not include raw exceptions, submitted bodies, or SQL details.

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_INPUT` | The JSON body is empty or malformed. |
| `403` | `ORIGIN_REJECTED` | A write has a missing or unapproved Origin. |
| `404` | `NOT_FOUND` | No resource matches the URL. |
| `405` | `METHOD_NOT_ALLOWED` | The URL exists but does not support that method. `Allow` lists supported methods. |
| `406` | `NOT_ACCEPTABLE` | The Accept header does not permit a JSON response. |
| `413` | `PAYLOAD_TOO_LARGE` | A request body exceeds 65,536 bytes, or 64 KiB. |
| `414` | `URI_TOO_LONG` | The full request URL exceeds 8,192 bytes, or 8 KiB. |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | A JSON reader received a content type other than `application/json`. |
| `500` | `INTERNAL_ERROR` | An unexpected application failure occurred. |
| `503` | `DATABASE_UNAVAILABLE` | The readiness query failed. |

In Requestly, send `GET /missing` to see a `404`. To see a `405`, send `POST /health/live` with `Origin: http://127.0.0.1:3000`; that method is unsupported even with an allowed origin. Neither request needs a body. Inspect `X-Request-Id` and, for the method error, `Allow` in the response headers.

## JSON responses and request logs

The API returns JSON. Omit `Accept` or use `Accept: application/json`, `application/*`, or `*/*`. An unsupported value such as `text/html` returns `406 NOT_ACCEPTABLE`. Hono parses the header; the most specific matching range decides whether JSON is allowed. A quality value of zero rejects that range, so `application/json;q=0, */*;q=1` still rejects JSON. CORS preflights remain Hono's responsibility and do not need to accept JSON.

Each completed request writes one JSON log entry to the terminal:

```json
{"requestId":"4d598d39-dc7a-4ca5-aab6-509ad69080d1","method":"GET","route":"/health/live","status":200,"elapsedMs":1}
```

The route comes from Hono's registered route template. A route such as `/records/:id` logs that template rather than a concrete record ID. Unmatched requests can log `*`; the requested URL is never the fallback. Logs contain only the five fields shown above. Headers, bodies, query strings, SQL, and raw exceptions are omitted.

## Origins and browser access

An origin is a scheme, hostname, and port, such as `http://127.0.0.1:3000`. Paths and trailing slashes are not part of an origin. Add these settings to the selected environment file:

```dotenv
API_ORIGIN=http://127.0.0.1:3000
CORS_ORIGINS=
```

`API_ORIGIN` is required. Use the API's public origin; production requires HTTPS even when a deployment proxy talks to the API internally over HTTP. Local and test development need no certificates. Their usual origins are `http://127.0.0.1:3000` and `http://127.0.0.1:3002`.

Every POST, PUT, PATCH, or DELETE request must include an `Origin` exactly matching `API_ORIGIN` or an explicitly allowed browser origin. Missing values, `null`, and unlisted values return `403 ORIGIN_REJECTED`. GET and HEAD need no Origin.

For Requestly, leave `CORS_ORIGINS` empty and add the `Origin` header to write requests. CORS means cross-origin resource sharing; browsers use it to decide whether a page may read another origin's responses. Requestly desktop does not need browser CORS permission. Origin checks do not authenticate a caller; session authentication and CSRF checks arrive with their own endpoints.

To allow a separate browser frontend, set an explicit list, for example `CORS_ORIGINS=http://127.0.0.1:5173`. Keep the same hostname when using local session cookies. Hono's CORS middleware allows credentials only for listed origins and exposes `ETag`, `Location`, and `X-Request-Id`. It allows GET, HEAD, POST, PUT, PATCH, and DELETE with `Content-Type`, `X-CSRF-Token`, and `If-Match` request headers. Wildcard origins are rejected.

A browser preflight is an OPTIONS request with `Access-Control-Request-Method`. When CORS is enabled, Hono returns `204` and includes `Access-Control-Allow-Origin` only for an allowed origin. Without that header, the browser denies access. When CORS is disabled, OPTIONS follows ordinary route and method handling. A successful preflight does not guarantee that the requested endpoint or method exists.

## Shared request handling

```mermaid
flowchart LR
    Client[Requestly] --> Shared[Set request ID and response headers]
    Shared --> Limit[Check the URL length]
    Limit --> Origin[Check write origins and optional browser access]
    Origin --> Accept[Check that JSON responses are acceptable]
    Accept --> Route[Run the health handler]
    Route --> Success[Return health JSON]
    Limit --> Error[Return the common JSON error]
    Origin --> Error
    Accept --> Error
    Route --> Error
    Success --> Log[Log request metadata]
    Error --> Log
```

`src/app.ts` installs the common HTTP behavior from `src/http.ts` before registering routes. Hono identifies unsupported methods and adds the allowed-method list. Successful health responses keep their simple status body.

Hono's body-limit middleware enforces the 64 KiB request limit before handlers run, including streamed bodies without a `Content-Length` header. `readJson` in `src/http.ts` checks for `Content-Type: application/json`, allowing a charset parameter, then calls `c.req.json()` with a safe error for malformed JSON. Each feature will validate its own fields with Valibot. Tests use a test-only POST route; the running application still has only health routes.
