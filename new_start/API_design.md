---
created: 2026-06-22
updated: 2026-06-22
tags: [dev/apis, dev/javascript, dev/typescript, resource, evergreen]
status: evergreen
source: resource
---

# API Basics & Design Best Practices 🚀

> Foundations of building clean, fast, and developer-friendly APIs using JavaScript/TypeScript. These principles apply across Next.js, Nuxt, SvelteKit, Express, and modern runtimes.

---

## Table of Contents

- [HTTP Methods](#http-methods)
- [Status Codes](#status-codes)
- [Naming Conventions](#naming-conventions)
- [Hierarchy and Nesting](#hierarchy-and-nesting)
- [Filtering, Sorting, Searching & Pagination](#filtering-sorting-searching--pagination)
- [Casing and Formatting](#casing-and-formatting)
- [Handling Actions](#handling-actions-the-exception-to-the-rule)
- [Field Naming (JSON Response)](#field-naming-json-response)
- [Side Effects](#side-effects)
- [API Versioning](#api-versioning)
- [Content Negotiation](#content-negotiation)
- [Idempotency Keys](#idempotency-keys)
- [Modern JS Runtimes & Frameworks](#modern-js-runtimes--frameworks)
- [Data Validation](#data-validation)
- [Error Handling](#error-handling)
- [Logging](#logging)
- [Security](#security)
- [Optimization Challenges](#optimization-challenges)
- [Webhooks](#webhooks)

---

## HTTP Methods

HTTP methods (also called "verbs") tell the server what kind of operation you want to perform on a resource.

| Method   | Purpose                     | Safe?  | Idempotent?      |
| -------- | --------------------------- | ------ | ---------------- |
| `GET`    | Read a resource             | ✅ Yes | ✅ Yes           |
| `POST`   | Create a new resource       | ❌ No  | ❌ No            |
| `PUT`    | Replace a resource entirely | ❌ No  | ✅ Yes           |
| `PATCH`  | Partially update a resource | ❌ No  | ❌\* Usually not |
| `DELETE` | Remove a resource           | ❌ No  | ✅ Yes           |

> **🤔 What does "Safe" mean?** It means the request should not change anything on the server. You can safely refresh a `GET` request without worrying about side effects.
>
> **🤔 What does "Idempotent" mean?** It means making the same request multiple times produces the same result. Sending a `DELETE` twice won't delete the resource "twice"—it'll just be gone.

### Common Mistakes

```js
// ❌ Don't use GET to change state!
router.get("/posts/:id/publish", (req, res) => { ... });

// ✅ Do use POST or PUT for state changes
router.post("/posts/:id/publish", (req, res) => { ... });
```

---

## Status Codes

Status codes are 3-digit numbers the server sends back to tell the client what happened.

### Categories

| Range | Meaning       | Emoji                |
| ----- | ------------- | -------------------- |
| `1xx` | Informational | ℹ️ Hold on...        |
| `2xx` | Success       | 🎉 Hooray!           |
| `3xx` | Redirection   | 🔄 Go somewhere else |
| `4xx` | Client Error  | ❌ You messed up     |
| `5xx` | Server Error  | 🔥 We messed up      |

### Common 2xx Codes

| Code  | Name       | When to Use                                                |
| ----- | ---------- | ---------------------------------------------------------- |
| `200` | OK         | Standard success for `GET`, `PUT`, `PATCH`, `DELETE`       |
| `201` | Created    | Successfully created a resource (usually after `POST`)     |
| `204` | No Content | Success, but nothing to send back (e.g., after a `DELETE`) |

### Common 4xx Codes

| Code  | Name                 | When to Use                                                           |
| ----- | -------------------- | --------------------------------------------------------------------- |
| `400` | Bad Request          | The request syntax or body is invalid                                 |
| `401` | Unauthorized         | You need to log in first                                              |
| `403` | Forbidden            | You're logged in, but you don't have permission                       |
| `404` | Not Found            | The resource doesn't exist                                            |
| `409` | Conflict             | The request conflicts with the current state (e.g., duplicate email)  |
| `422` | Unprocessable Entity | Validation failed (semantically correct, but business rules violated) |
| `429` | Too Many Requests    | Slow down! Rate limit hit                                             |

### Common 5xx Codes

| Code  | Name                  | When to Use                                                |
| ----- | --------------------- | ---------------------------------------------------------- |
| `500` | Internal Server Error | Something unexpected broke on our end                      |
| `502` | Bad Gateway           | Upstream server (e.g., proxy) returned an invalid response |
| `503` | Service Unavailable   | Server is overloaded or down for maintenance               |
| `504` | Gateway Timeout       | Upstream server took too long to respond                   |

---

## Naming Conventions

Think of your API URLs like folder paths. They should describe **what** something is (a noun), not **what action** you're doing (a verb).

### Resources

| ❌ Don't             | ✅ Do                   | Why                              |
| -------------------- | ----------------------- | -------------------------------- |
| `GET /getPosts`      | `GET /posts`            | Use the HTTP method for the verb |
| `GET /fetchUserById` | `GET /users/:id`        | Keep it simple                   |
| `GET /postsByIdv1`   | `GET /api/v1/posts/:id` | Version goes at the start        |

### Formatting

| ❌ Don't         | ✅ Do            | Why                                      |
| ---------------- | ---------------- | ---------------------------------------- |
| `/userProfiles`  | `/user-profiles` | Kebab-case is URL-friendly               |
| `/user_profiles` | `/user-profiles` | Underscores can hide in underlined links |
| `/users.json`    | `/users`         | Use the `Accept` header for format       |

```js
// ✅ Versioning at the root
app.use("/api/v1", router);

// ✅ Plural nouns + kebab-case
router.get("/product-categories", (req, res) => {});
```

---

## Hierarchy and Nesting

When resources are related (e.g., Comments belong to a Post), use the URL to show that relationship. However, avoid "deep nesting," which makes URLs difficult to read and maintain.

**❌ Don'ts**

```js
// Don't nest more than 2 levels deep
router.get("/authors/:id/posts/:postId/comments/:commentId", (req, res) => {});

// Don't reflect obscure database table names
router.get("/tbl_users_mstr", (req, res) => {});
```

**✅ Do**

```js
// Nest resources to show relationships (max 2 levels)
router.get("/posts/:postId/comments", (req, res) => {});

// If you need a specific sub-resource, flatten the URL
router.get("/comments/:id", (req, res) => {});
```

> **💡 Pro Tip:** If you find yourself needing 3+ levels of nesting, it usually means the resource can stand on its own.

---

## Filtering, Sorting, Searching & Pagination

Keep the URL path for **resources** only. Use **Query Parameters** (the part after the `?`) to modify _how_ those resources are returned.

**❌ Don'ts**

```js
// Don't create new paths for filtering
router.get("/activeUsers", (req, res) => {});
router.get("/usersSortedByName", (req, res) => {});
```

**✅ Do**

```js
// Use query parameters for filtering state
router.get("/users?status=active", (req, res) => {});

// Use query parameters for sorting and pagination
router.get("/users?sort=name_asc&page=2&limit=25", (req, res) => {});
```

### Pagination Strategies

| Strategy           | How it works               | Pros                       | Cons                                               |
| ------------------ | -------------------------- | -------------------------- | -------------------------------------------------- |
| **Offset / Limit** | `?page=2&limit=25`         | Simple, easy to jump pages | Slow on large datasets, duplicates if data changes |
| **Cursor**         | `?cursor=eyJpZCI6MTAwfQ==` | Fast at scale, no skipping | Can't jump to arbitrary page                       |

> Cursor pagination uses an encoded value (often the last item's ID) to fetch the next "page" efficiently.

---

## Casing and Formatting

URLs are often case-sensitive (depending on the server). To avoid confusion, consistency is key.

**❌ Don'ts**

```js
// Don't use CamelCase in URLs
router.get("/userProfiles", (req, res) => {});

// Don't use underscores (they can be hidden by browser underlining)
router.get("/user_profiles", (req, res) => {});

// Don't include file extensions
router.get("/users.json", (req, res) => {});
```

**✅ Do**

```js
// Use kebab-case (lowercase with hyphens)
router.get("/user-profiles", (req, res) => {});

// Rely on the 'Accept' header for file types
// (Client sends "Accept: application/json")
router.get("/users", (req, res) => {});
```

---

## Handling Actions (The Exception to the Rule)

Sometimes you need to perform an action that doesn't fit perfectly into Create, Read, Update, or Delete (CRUD)—like "logging in," "calculating," or "translating."

**❌ Don'ts**

```js
// Don't use a GET request for an action that changes state
router.get("/users/:id/activate", (req, res) => {});
```

**✅ Do**

```js
// OPTION A: Treat the action as a sub-resource
// "Create a search"
router.post("/search", (req, res) => {});

// OPTION B: Map it to a noun if possible
// Instead of /activate, create an "activation" resource
router.post("/users/:id/activations", (req, res) => {});

// OPTION C: Use a specific verb if strictly necessary (RPC style),
// but ensure it uses POST/PUT, not GET
router.put("/users/:id/reset-password", (req, res) => {});
```

---

## Field Naming (JSON Response)

While the URL uses `kebab-case`, the JSON body usually follows the conventions of the programming language. In JavaScript, that's `camelCase`.

**❌ Don'ts**

```json
// Don't mix casing styles in your response
{
  "user_id": 1,
  "FirstName": "John"
}
```

**✅ Do**

```json
// Stick to camelCase for JSON properties (standard in JS/Node)
{
  "userId": 1,
  "firstName": "John"
}
```

---

## Side Effects

In this example, let's say you have an endpoint such as `/groups/:id/admins/` which is supposed to set the admin for a given group. What if that group doesn't exist?

It could be tempting to create the group and then set the user as the admin of that new group, but that would be considered a **side effect**. In general, you should return that the group doesn't exist and then proceed with creating the group, then setting the admin in two separate operations.

Another option would be to add the ability to pass in admins for the group creation route to avoid extra calls. It's not necessarily out of scope to say who owns something when creating a resource, but the other way around is odd.

Like functional programming, keep endpoints more pure and referentially transparent from the HTTP method and path name structure.

---

## API Versioning 🏷️

APIs change over time. Versioning prevents you from breaking existing clients.

### Strategies

| Strategy        | Example                               | Pros                            | Cons                      |
| --------------- | ------------------------------------- | ------------------------------- | ------------------------- |
| **URL Path**    | `/api/v1/users`                       | Simple, explicit, easy to cache | Can clutter docs          |
| **Header**      | `Accept: application/vnd.api.v2+json` | Clean URLs                      | Harder to test in browser |
| **Query Param** | `/api/users?version=2`                | Easy to switch                  | Messy, not standard       |

> **💡 Recommendation:** For beginners, **URL path versioning** (`/api/v1/...`) is the easiest to understand and debug.

---

## Content Negotiation 📄

The client tells the server what format it wants via the `Accept` header. The server tells the client what it sent back via the `Content-Type` header.

```http
GET /users HTTP/1.1
Accept: application/json

HTTP/1.1 200 OK
Content-Type: application/json
```

Common types:

- `application/json` (the standard for APIs)
- `application/xml` (legacy enterprise)
- `text/plain` (simple responses)
- `multipart/form-data` (file uploads)

---

## Idempotency Keys 🔑

When a client sends a `POST` (e.g., charging a credit card), the network might hiccup. The client retries, and suddenly the charge happens twice! 💸

An **idempotency key** is a unique string the client sends (usually in a header like `Idempotency-Key: abc-123`) so the server recognizes a duplicate request and only processes it once.

```js
// Client sends:
POST /payments
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

// Server stores the result of this key for ~24 hours.
// If the same key arrives again, return the stored result instead of re-charging.
```

---

## Modern JS Runtimes & Frameworks

The JavaScript API landscape has exploded beyond Express. Here are the main players:

| Framework   | Runtime                  | Best For                  | Vibe                                  |
| ----------- | ------------------------ | ------------------------- | ------------------------------------- |
| **Express** | Node.js                  | Learning, huge ecosystem  | Classic, stable, middleware-heavy     |
| **Fastify** | Node.js                  | High performance, plugins | Fast, schema-based, low overhead      |
| **Hono**    | Bun, Deno, Node, Workers | Edge/serverless, speed    | 🔥 Ultrafast, tiny, Web Standard APIs |
| **Elysia**  | Bun                      | Type-safe APIs, speed     | End-to-end type safety, Bun-native    |

### 🍞 Bun + Hono

[Hono](https://hono.dev/) means "flame" in Japanese 🔥. It's a small, simple, and ultrafast web framework built on **Web Standards**.

```ts
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.text("Hello Hono!"));

export default app;
```

**Why it rocks:**

- **Ultrafast 🚀**: Uses `RegExpRouter`—no slow linear loops.
- **Tiny 🪶**: `hono/tiny` is under 14kB. Zero dependencies.
- **Multi-runtime 🌍**: Runs on Bun, Deno, Node.js, Cloudflare Workers, Vercel, AWS Lambda.
- **Batteries included 🔋**: Built-in middleware for CORS, JWT, ETag, compression, secure headers, and more.
- **TypeScript first 😃**: Path params are literal types. Validator + Hono Client (`hc`) enable end-to-end type safety.

> **💡 For someone coming from Next.js/Nuxt:** Hono feels like writing API routes, but without the frontend framework attached. If you're building a pure backend or edge functions, it's a fantastic modern choice.

### Quick Comparison: Hello World

```js
// Express (Node.js)
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Hello Express"));
app.listen(3000);

// Hono (Bun / Node / Deno / Workers)
import { Hono } from "hono";
const app = new Hono();
app.get("/", (c) => c.text("Hello Hono"));
// No listen needed for Workers; Bun: Bun.serve({ fetch: app.fetch })
```

---

## Data Validation

Never trust the client! Invalid data leads to crashes, security holes, and confusing bugs.

**🛡️ See the full deep-dive:** [validation.md](./validation.md)

Quick overview:

- **Zod**: The most popular schema validation library. Great TypeScript inference.
- **Valibot**: A lighter alternative with a modular API (tree-shakeable).

```ts
import { z } from "zod";

const UserSchema = z.object({
  email: z.string().email(),
  age: z.number().min(0).optional(),
});

const result = UserSchema.safeParse(req.body);
if (!result.success) {
  return res.status(400).json({ errors: result.error.issues });
}
```

---

## Error Handling

Users of your API need to know what went wrong so they can fix their request, but you should never expose enough internal mechanics to let someone reverse-engineer your system. Aim for **helpful, not vulnerable**.

**🛡️ See the full deep-dive:** [error-handling.md](./error-handling.md)

### The Golden Rule

Return a consistent error shape:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "The 'email' field must be a valid email address.",
    "status": 400
  }
}
```

---

## Logging

Logs are your flight recorder when things go wrong. Log enough to reconstruct events, but never log passwords, tokens, or credit card numbers.

**🛡️ See the full deep-dive:** [logging.md](./logging.md)

### Quick Checklist

| Log This?                   | Example          | Why                    |
| --------------------------- | ---------------- | ---------------------- |
| ✅ Request path & method    | `GET /users/123` | Debug routing issues   |
| ✅ Status code & duration   | `200 in 45ms`    | Performance monitoring |
| ✅ User ID (if authed)      | `userId=abc`     | Trace user actions     |
| ❌ Passwords / tokens       | `password=123`   | Security risk!         |
| ❌ Full credit card numbers | `card=4111...`   | Compliance/legal risk  |

---

## Security

Security is not a single library you install—it's a mindset. While tools like `helmet` are great, true API security involves layers.

**🛡️ See the full deep-dive:** [security.md](./security.md)

### Top Priorities

| Topic                  | What It Does                              | JS Tooling Example                           |
| ---------------------- | ----------------------------------------- | -------------------------------------------- |
| **HTTPS**              | Encrypts data in transit                  | Let's Encrypt, `https` module                |
| **CORS**               | Controls which websites can call your API | `cors` middleware, Hono built-in             |
| **Rate Limiting**      | Prevents brute force & spam               | `express-rate-limit`, Hono limiter           |
| **Secure Headers**     | Protects against XSS/clickjacking         | `helmet`, Hono `secure-headers`              |
| **Input Sanitization** | Prevents injection attacks                | Validation libs + libraries like `dompurify` |
| **Secrets Management** | Keeps API keys out of code                | `.env` + secret managers (AWS SM, Doppler)   |
| **Authentication**     | Verifies who you are                      | JWT, OAuth2, Sessions                        |
| **Authorization**      | Verifies what you can do                  | RBAC, ABAC, middleware checks                |

---

## Optimization Challenges

> ⚠️ First confirm bottlenecks, technical debt, security risks, cost, and API docs exist before reaching for optimization. Optimization alone can lead to unnecessary complexity.

### Caching

One of the most effective ways to speed up the API. Store the result of an expensive computation so that we can return it later without needing to recalculate over and over.

```js
// Pseudo-code
if (redis_cache.has(query)) {
  return redis_cache.get(query);
} else {
  const result = await db.query(query);
  redis_cache.set(query, result, { EX: 60 }); // expire in 60s
  return result;
}
```

Even a brief period of caching can significantly increase the speed of an API.

### Connection Pooling

Maintaining a pool of open connections instead of opening/closing a connection for each database query avoids the expensive handshake overhead.

If you're using a serverless approach, this can be challenging, as each instance creates its own connection. Services like **AWS RDS Proxy** or **Azure SQL Database** can handle pooling for you.

### N + 1 Query Problem

Let's say you have an API endpoint that fetches a blog post as well as the comments for that blog post.

If you first make a query for the blog post and then a separate query for each individual comment, you get N number of comments + 1 (for the original blog post they belong to).

To avoid this, leverage relations along with **JOINs**:

```sql
SELECT posts.id, posts.title, comments.id, comments.content
FROM posts
LEFT JOIN comments ON comments.post_id = posts.id
```

Or use an ORM that supports eager loading (e.g., Prisma's `include`, Drizzle's `with`).

### Compression

By enabling compression for large response payloads (like `gzip` or `brotli`), you can reduce the amount of data transferred over the network.

```js
// Express
const compression = require("compression");
app.use(compression());

// Hono
import { compress } from "hono/compress";
app.use(compress());
```

### Async Logging

Offload log entries to a background worker or non-blocking stream to write to disk or send to your logging service. Blocking the main thread to write logs slows down response times.

Tools like **Pino** are built for this: they log to stdout asynchronously.

---

## Webhooks

Webhooks are "reverse APIs." Instead of your client asking your server for data, your server pushes data to the client when something happens.

**🛡️ See the full deep-dive:** [webhooks.md](./webhooks.md)

Quick summary:

- The client gives you a URL to call back.
- When an event occurs (e.g., "payment succeeded"), your server sends a `POST` to that URL.
- Always verify webhook signatures to prove the payload came from you, not an attacker.

---

## Summary Table

| **Category**    | **Recommended Style**  | **Example**                                    |
| --------------- | ---------------------- | ---------------------------------------------- |
| **Resources**   | Plural Nouns           | `/products`                                    |
| **Separators**  | Hyphens (kebab-case)   | `/product-categories`                          |
| **Nesting**     | Max depth of 2         | `/products/12/reviews`                         |
| **Filtering**   | Query Parameters       | `/products?color=red`                          |
| **JSON Fields** | camelCase              | `{ "productId": 12 }`                          |
| **Versioning**  | URL Path (recommended) | `/api/v1/products`                             |
| **Errors**      | Consistent JSON shape  | `{ "error": { "code", "message", "status" } }` |
| **Pagination**  | Cursor or Offset/Limit | `?cursor=xyz` or `?page=2&limit=25`            |

---
