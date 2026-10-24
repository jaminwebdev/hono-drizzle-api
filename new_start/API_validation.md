---
created: 2026-06-22
updated: 2026-06-25
tags: [dev/apis, dev/javascript, dev/typescript, resource, evergreen]
status: evergreen
source: resource
---

# Data Validation in APIs 🛡️

> "Never trust the client." Every piece of data coming into your API—URL params, query strings, headers, and especially the request body—must be checked before you touch your database or business logic.

---

## Why Validate?

Without validation, bad data sneaks in and causes all sorts of chaos:

| Problem             | What Happens                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------- |
| 💥 Crashes          | A string arrives where a number is expected, and your code throws an unhandled exception. |
| 🔓 Security holes   | Extra fields in a JSON body might overwrite protected properties (mass assignment).       |
| 🗄️ Corrupt data     | Invalid email formats or impossible dates end up in your database.                        |
| 😵 Confusing errors | The client gets a raw database error instead of a helpful message.                        |

---

## Where to Validate

| Location         | What to Check                          | Example                     |
| ---------------- | -------------------------------------- | --------------------------- |
| **Route params** | IDs are valid format (UUID, number)    | `/users/abc-123`            |
| **Query params** | Pagination, filters are correct types  | `?page=2&limit=25`          |
| **Headers**      | Content-Type, Auth tokens are present  | `Authorization: Bearer ...` |
| **Request Body** | All input fields match expected schema | JSON in a `POST` or `PUT`   |

---

## Schema Validation Libraries

Writing validation by hand (e.g., `if (!body.name) return 400`) gets tedious fast and is easy to mess up. Schema libraries let you define rules in one place and get both **runtime safety** and **TypeScript types** for free.

### Zod 🏆

[Zod](https://zod.dev/) is the most popular validation library in the TypeScript ecosystem. It's zero-dependency, tiny, and has fantastic type inference.

#### Installation

```bash
npm install zod
# or
bun add zod
```

#### Basic Usage

```ts
import { z } from "zod";

// Define a schema
const UserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  age: z.number().min(0).max(120).optional(),
  role: z.enum(["user", "admin"]).default("user"),
});

// Infer the TypeScript type automatically!
type User = z.infer<typeof UserSchema>;
// = { name: string; email: string; age?: number; role: "user" | "admin" }

// Validate incoming data
app.post("/users", async (c) => {
  const body = await c.req.json();
  const result = UserSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: result.error.issues, // Array of specific field errors
        },
      },
      400,
    );
  }

  // result.data is now fully typed and safe!
  await db.user.create(result.data);
  return c.json({ id: newId }, 201);
});
```

#### Coercion (Query Params)

Query parameters are always strings, so you need to **coerce** them to numbers or booleans.

```ts
const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().max(100).default(25),
  active: z.coerce.boolean().default(false),
});

// /users?page=2&active=true
// => { page: 2, limit: 25, active: true }
```

#### Custom Validation

```ts
const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[0-9]/, "Must contain a number");
```

---

### Valibot 🌱

[Valibot](https://valibot.dev/) is a newer alternative to Zod designed to be **modular** and **tree-shakeable**. If bundle size is critical (e.g., edge workers), Valibot can be a great choice.

#### Installation

```bash
npm install valibot
# or
bun add valibot
```

#### Basic Usage

```ts
import * as v from "valibot";

const UserSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  email: v.pipe(v.string(), v.email()),
  age: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(120))),
});

type User = v.InferOutput<typeof UserSchema>;

// In a route:
const result = v.safeParse(UserSchema, body);
if (!result.success) {
  return c.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        issues: v.flatten(result.issues).nested, // Friendly error object
      },
    },
    400,
  );
}
```

> **🤔 Zod vs Valibot?** If you want the biggest ecosystem and community, go with **Zod**. If you are hyper-focused on bundle size and edge deployments, try **Valibot**. Both are excellent.

---

## Validation Patterns

### 1. Reusable Middleware (Hono Example)

```ts
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono();

const UserSchema = z.object({ name: z.string(), email: z.string().email() });

app.post("/users", zValidator("json", UserSchema), async (c) => {
  const data = c.req.valid("json"); // Fully typed!
  await db.user.create(data);
  return c.json({ success: true }, 201);
});
```

### 2. Reusable Middleware (Express Example)

```ts
import { z } from "zod";

function validateBody(schema: z.ZodSchema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        details: result.error.issues,
      });
    }
    req.body = result.data; // Replace with parsed/cleaned data
    next();
  };
}

app.post("/users", validateBody(UserSchema), (req, res) => {
  // req.body is now guaranteed to match UserSchema
});
```

### 3. Strip Unknown Fields (Prevent Mass Assignment)

By default, Zod ignores extra keys but passes them through. You should **strip** them to prevent users from injecting fields like `isAdmin: true`.

```ts
const UserSchema = z
  .object({
    name: z.string(),
    email: z.string().email(),
  })
  .strict(); // ❌ Throws error if extra keys exist

// OR
const UserSchema = z
  .object({
    name: z.string(),
    email: z.string().email(),
  })
  .strip(); // Removes extra keys silently (safe default)
```

---

## Validation + TypeScript = ❤️

The magic of schema libraries is that you write validation rules **once**, and TypeScript knows the exact shape of your data everywhere else.

```ts
// One schema, infinite safety
const schema = z.object({ id: z.number(), title: z.string() });
type Post = z.infer<typeof schema>;

// Used in:
// - API routes (validates request)
// - Database layer (knows what to insert)
// - Frontend forms (validates client-side)
// - OpenAPI docs (auto-generates specs)
```

---

## Quick Checklist

| ✅ Do                                               | ❌ Don't                                    |
| --------------------------------------------------- | ------------------------------------------- |
| Validate every input (params, query, body, headers) | Assume the client sent the right shape      |
| Return specific, human-readable field errors        | Return vague "bad request" messages         |
| Strip or reject unknown body properties             | Allow mass assignment of hidden fields      |
| Coerce query params to proper types                 | ParseInt every query string manually        |
| Reuse schemas across frontend and backend           | Write validation twice in different formats |

---
