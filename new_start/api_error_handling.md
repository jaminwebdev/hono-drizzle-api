---
created: 2026-06-22
updated: 2026-06-22
tags: [dev/apis, dev/javascript, dev/typescript, resource, evergreen]
status: evergreen
source: resource
---

# Error Handling in APIs 🚨

> Errors are inevitable. What separates a good API from a great one is how gracefully and clearly it explains what went wrong.

---

## The Golden Rules

1. **Never expose internal stack traces** in production. 🔒
2. **Return a consistent error shape** so clients know exactly where to look. 📐
3. **Use the correct HTTP status code** so clients can react programmatically. 🎯
4. **Be helpful, not vulnerable**—tell the user how to fix it, not how your database is structured. 🛡️

---

## The Standard Error Response Shape

Your API should return the same JSON structure for every single error. This allows frontend developers to write one error handler that works everywhere.

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested user with ID 'abc-123' does not exist.",
    "status": 404,
    "requestId": "req_550e8400-e29b",
    "timestamp": "2026-06-09T12:00:00Z"
  }
}
```

### Field Explanations

| Field                  | Purpose                                         | Example                         |
| ---------------------- | ----------------------------------------------- | ------------------------------- |
| `code`                 | A machine-readable string for conditional logic | `INVALID_INPUT`, `RATE_LIMITED` |
| `message`              | A human-readable explanation                    | `"Email is required"`           |
| `status`               | The HTTP status code                            | `400`, `401`, `500`             |
| `requestId`            | A unique ID to trace this error in your logs    | `req_abc123`                    |
| `timestamp`            | When the error occurred                         | ISO 8601 format                 |
| `details` _(optional)_ | Extra context, especially for validation errors | Array of field-specific errors  |

---

## Status Codes in Practice

| Scenario                       | Status | Code             | Message                                     |
| ------------------------------ | ------ | ---------------- | ------------------------------------------- |
| Missing required field         | `400`  | `INVALID_INPUT`  | `"Field 'email' is required"`               |
| Field is wrong type            | `400`  | `INVALID_INPUT`  | `"Field 'age' must be a number"`            |
| Email already taken            | `409`  | `CONFLICT`       | `"A user with this email already exists"`   |
| Invalid login credentials      | `401`  | `UNAUTHORIZED`   | `"Invalid email or password"`               |
| Valid token, but no permission | `403`  | `FORBIDDEN`      | `"You do not have access to this resource"` |
| Resource doesn't exist         | `404`  | `NOT_FOUND`      | `"Post with ID 99 was not found"`           |
| Rate limit hit                 | `429`  | `RATE_LIMITED`   | `"Too many requests. Try again in 60s."`    |
| Unexpected crash               | `500`  | `INTERNAL_ERROR` | `"An unexpected error occurred."`           |

> **⚠️ Security Tip:** For auth errors, keep messages vague. Saying `"Password is wrong"` vs `"Email doesn't exist"` tells attackers which emails are in your system. Use `"Invalid credentials"` for both.

---

## Centralized Error Handling

Instead of writing `try/catch` in every single route, create a top-level error handler.

### Express Example

```js
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Distinguishes expected vs programming errors
  }
}

// Throw it anywhere
throw new ApiError(404, "NOT_FOUND", "User not found");

// Global error handler (must be LAST middleware)
app.use((err, req, res, next) => {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();

  // Log the full error internally
  logger.error({ err, requestId, path: req.path });

  // Don't leak stack traces in production
  const isDev = process.env.NODE_ENV === "development";

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        status: err.status,
        requestId,
        timestamp: new Date().toISOString(),
        details: err.details,
        ...(isDev && { stack: err.stack }),
      },
    });
  }

  // Unknown / programming errors
  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: isDev ? err.message : "An unexpected error occurred.",
      status: 500,
      requestId,
      timestamp: new Date().toISOString(),
      ...(isDev && { stack: err.stack }),
    },
  });
});
```

### Hono Example

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

const app = new Hono();

// You can throw HTTPException from anywhere
app.get("/users/:id", async (c) => {
  const user = await db.user.findById(c.req.param("id"));
  if (!user) {
    throw new HTTPException(404, { message: "User not found" });
  }
  return c.json(user);
});

// Global error handler
app.onError((err, c) => {
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();

  logger.error({ err: err.message, requestId, path: c.req.path });

  if (err instanceof HTTPException) {
    return c.json(
      {
        error: {
          code: err.status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
          message: err.message,
          status: err.status,
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
      err.status,
    );
  }

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        status: 500,
        requestId,
        timestamp: new Date().toISOString(),
      },
    },
    500,
  );
});
```

---

## Async Error Handling

In Express, `async` route handlers don't automatically forward errors to your error middleware. You need to catch them.

### The Problem

```js
// ❌ If db.query() throws, this crashes the server
app.get("/users", async (req, res) => {
  const users = await db.query("SELECT * FROM users");
  res.json(users);
});
```

### Solutions

**Option A: Wrap manually**

```js
app.get("/users", async (req, res, next) => {
  try {
    const users = await db.query("SELECT * FROM users");
    res.json(users);
  } catch (err) {
    next(err); // Forwards to global error handler
  }
});
```

**Option B: Use a helper**

```js
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

app.get(
  "/users",
  asyncHandler(async (req, res) => {
    const users = await db.query("SELECT * FROM users");
    res.json(users);
  }),
);
```

**Option C: Use `express-async-errors`**

```bash
npm install express-async-errors
```

```js
require("express-async-errors"); // Just require it at the top of your entry file
// Now all async routes automatically forward errors
```

> **💡 Hono handles async errors automatically** via `app.onError()`—no extra library needed!

---

## Validation Errors

When schema validation fails, return the exact fields that are wrong so the frontend can highlight form inputs.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body contains invalid fields.",
    "status": 400,
    "requestId": "req_abc",
    "timestamp": "2026-06-09T12:00:00Z",
    "details": [
      { "path": "email", "message": "Invalid email address" },
      { "path": "age", "message": "Must be a positive number" }
    ]
  }
}
```

---

## Unhandled Rejections & Uncaught Exceptions

Your process _will_ eventually crash from something you didn't catch. Set up safety nets.

```js
process.on("unhandledRejection", (reason, promise) => {
  logger.fatal({ reason, promise }, "Unhandled Rejection");
  // Gracefully shut down so Docker/Kubernetes can restart you cleanly
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught Exception");
  process.exit(1);
});
```

---

## Error Handling Checklist

| ✅ Do                                      | ❌ Don't                                             |
| ------------------------------------------ | ---------------------------------------------------- |
| Return the same JSON shape for every error | Return raw HTML or plain text for some errors        |
| Include a `requestId` for log tracing      | Return stack traces in production                    |
| Use specific 4xx codes for client mistakes | Return 500 for "user already exists"                 |
| Catch async errors and forward them        | Let async route crashes kill the server              |
| Log full error details internally          | Log sensitive data (passwords, tokens)               |
| Be vague about auth failures               | Tell attackers "Email not found" vs "Wrong password" |

---
