---
created: 2026-06-25
updated: 2026-09-18
tags: [dev/databases, dev/sql, resource, growing]
status: growing
source: resource
---

# Database Design for Product Apps

> A beginner-friendly process for turning product requirements into safe, understandable SQL schemas. The goal is not to memorize rules—it is to explain why each table, constraint, and index exists.

## The 5-Step Blueprint for Any Database

A complementary, workflow-level process for going from fuzzy requirements to a concrete schema. Use it before the scenario-driven checklist below when you are starting from a blank page.

1. **Gather and clarify requirements.**
   Review wireframes, PRDs, or user flows and ask what the application must actually do. For a clinic: patients book appointments, doctors have schedules, appointments have notes, prescriptions, billing. Do not design yet — understand. Write down the questions the app must answer: “Which appointments does Dr. Smith have today?” “What prescriptions has this patient received?”

2. **Identify entities and relationships.**
   Draw boxes and lines before worrying about fields or keys. Map out patients, doctors, appointments, prescriptions, and the relationships between them (one-to-one, one-to-many, many-to-many). Mermaid diagrams, whiteboards, or scratch paper all work. The goal is shape, not perfection.

3. **Add attributes and keys.**
   Add only the smallest set of attributes and keys that proves the design works. Resist over-optimization: you do not need every possible column on day one. Prefer surrogate keys for standalone things; use composite keys when the relationship itself is the identity. See [[Keys_Simple_Composite_Compound|Keys: Simple vs Composite vs Compound]].

4. **Review and refactor the design.**
   Validate relationships for clarity and consistency, then normalize. A fact should live in one clear place without duplication. Break compound attributes into smaller parts (e.g., split `address` into `city`, `state`, `zip`) or move them to their own table if they repeat or have their own lifecycle. Ask:
   - Are you storing the same information in multiple places?
   - Does every table have a clear purpose?
   - Are there any attributes that belong somewhere else?
   - Does the design support the scenarios from Step 1?

5. **Review with other people and run realistic scenarios.**
   Walk through real queries, writes, and edge cases with a teammate or rubber duck. Check for orphan records, missing constraints, and whether the schema can answer the questions from Step 1. This step catches assumptions that look obvious only to the designer.

## The Process: Design a Schema From a Scenario

Use this order every time. It prevents a schema from becoming a collection of tables without a reason.

1. **Write the user actions.** Example: “A customer places an order containing several products.”
2. **Write the questions the app must answer.** “Show a customer's orders,” “show the items in an order,” and “prevent duplicate payment records.”
3. **Find the nouns and ownership.** Customers, products, orders, and order items are entities; an order belongs to one customer.
4. **List invariants.** An order item must belong to an order, quantity must be positive, and a provider payment ID can appear only once.
5. **Model relationships and choose keys.** Use the simplest shape that expresses those rules.
6. **Design the common reads and writes.** Index the columns these queries actually filter, join, or sort by. See [[Indexing]].
7. **Decide lifecycle and conflict behavior.** Can data be deleted? Must history remain? Can two requests make the same change at once?

> [!tip] Start with a boring design
> For most product apps, start with normalized relational tables, foreign keys, database constraints, and a small number of query-driven indexes. Add denormalization or special infrastructure only after a real access pattern needs it.

## Worked Foundation: One Order, Many Items

An order contains several products. The product catalog holds today's price, but an order must preserve the price actually paid.

```sql
CREATE TABLE customers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  current_price NUMERIC(12,2) NOT NULL CHECK (current_price >= 0)
);

CREATE TABLE orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
  order_id BIGINT NOT NULL REFERENCES orders(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC);
```

This is **normalized**: customer facts live once, product facts live once, and the relationship between an order and its products lives in `order_items`. `unit_price` deliberately repeats the price because it is historical order data, not a second product catalog.

## Relationships and Keys

| Situation                                                 | Good starting shape                                       | Why                                             |
| --------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| One customer has many orders                              | `orders.customer_id`                                      | The foreign key belongs on the “many” side.     |
| Posts and tags relate many-to-many                        | `post_tags(post_id, tag_id)`                              | The junction row represents the relationship.   |
| One stock count per product and warehouse                 | `PRIMARY KEY (product_id, warehouse_id)`                  | The pair is the fact's natural identity.        |
| A relationship has its own children or external reference | `memberships.id` plus `UNIQUE (user_id, organization_id)` | Give the relationship its own durable identity. |

A **surrogate key** is a generated ID such as `id BIGINT GENERATED ALWAYS AS IDENTITY`. It is a strong default for a standalone thing—user, order, product—because names, emails, and SKUs can change.

A **composite key** uses more than one column together. `PRIMARY KEY (post_id, tag_id)` means “there can be only one row connecting this exact post and tag.” It is not less legitimate than a generated ID; it simply fits a pure relationship better. See [[Keys_Simple_Composite_Compound|Keys: Simple vs Composite vs Compound]] for a full decision map.

Use public IDs or slugs for URLs when useful, but do not mistake an unguessable ID for authorization. The server must still check that the current user may access the record.

## Constraints Are Product Rules

Put rules in the database when every writer must obey them, including admin scripts and future services.

| Requirement            | Database tool      | Example                            |
| ---------------------- | ------------------ | ---------------------------------- |
| Required value         | `NOT NULL`         | Every order has a customer.        |
| No duplicates          | `UNIQUE`           | A user email occurs once.          |
| Valid range or state   | `CHECK`            | Quantity is positive.              |
| Existing parent        | `FOREIGN KEY`      | An order item references an order. |
| Unique within a tenant | composite `UNIQUE` | `UNIQUE (organization_id, slug)`   |

Choose `ON DELETE` behavior intentionally. `CASCADE` fits a disposable child such as `post_tags`; `RESTRICT` fits data that should not vanish accidentally, such as orders; `SET NULL` fits an optional attribution such as a deleted author on an old comment.

## Normalization and Deliberate Copies

Normalization means a fact has one clear home. It prevents conflicting copies and makes edits safer. Aim for it first; then copy a value only when you can say why and how it stays correct.

Good deliberate copies include a checkout-time item price, an order total derived in the same transaction, or a cached counter that can be rebuilt from source data. A copy needs an owner, an update/rebuild plan, and an answer for what happens during a failed write.

## Values: `NULL`, JSON, Arrays, and Statuses

| Need                                       | Prefer              | Why                                                                                  |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------ | ---------------------- |
| Unknown or not applicable value            | `NULL`              | It expresses a real absence; do not invent a misleading default.                     |
| Stable small set of internal states        | `CHECK` constraint  | Clear and enforced close to the row.                                                 |
| Admin-managed options with labels/metadata | Lookup table        | The options are data with their own lifecycle. See [[#Lookup Tables: Options as Data | Lookup Tables]] below. |
| Core relationship or frequent filter       | Normal column/table | It can be constrained, joined, and indexed normally.                                 |

## Lookup Tables: Options as Data

A **lookup table** stores a bounded set of values that the application treats as reference data rather than core entities. Classic examples are statuses, categories, countries, roles, tags, services in a booking app, and payment methods.

### When to prefer a lookup table over a `CHECK` constraint

| Use a `CHECK` constraint when...                               | Use a lookup table when...                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The set is tiny and rarely changes.                            | The set is admin-managed or user-facing.                                                |
| The value has no extra metadata (no label, color, sort order). | Each option needs extra columns such as `label`, `color`, `sort_order`, or `is_active`. |
| A code change is acceptable to add a value.                    | A non-developer should be able to add or rename values.                                 |
| Only the database enforces the rule.                           | The list itself is shown in dropdowns, reports, or admin panels.                        |

### Typical shape

```sql
CREATE TABLE order_statuses (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status_code TEXT NOT NULL REFERENCES order_statuses(code),
  -- ...
);
```

`code` is a stable natural key. Using `TEXT PRIMARY KEY` instead of a surrogate `id` makes the `orders` row readable without a join, while the foreign key still prevents nonsense values.

### When to use a surrogate key anyway

Use a generated `id` as the lookup key when the natural code might change (e.g., a SKU prefix overhaul) or when the same code must mean different things in different contexts. Otherwise, a short text code keeps joins simple and query plans readable.

### Common pitfalls

- **Soft-deleting a lookup value without handling old rows.** If `order_statuses.is_active` becomes `false`, existing orders still reference that code. Decide whether old rows keep their historical value or must migrate.
- **Renaming a code that is used as the foreign key.** PostgreSQL `ON UPDATE CASCADE` can propagate the change, but application caches, external reports, and API clients may still hold the old code.
- **Letting the lookup table grow into a general classification system.** If options start having sub-options, effective dates, and per-tenant overrides, you may need a more general entity table instead.
- **Joining a lookup table for every row when the app already caches the list.** The join is fine; just remember the database still executes it unless the planner decides it can optimize it away.

### Guideline

Start with a `CHECK` constraint for internal state machines. Promote to a lookup table as soon as the value needs a label, sort order, admin UI, or history.

## Values: `NULL`, JSON, Arrays, and the Rest

| Need                                              | Prefer                                | Why                                                              |
| ------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Unknown or not applicable value                   | `NULL`                                | It expresses a real absence; do not invent a misleading default. |
| Flexible preferences or archived external payload | JSON                                  | Shape may vary and is not the core query path.                   |
| Small, bounded value collection owned by one row  | Array can be reasonable in PostgreSQL | Do not use it for foreign-key relationships such as tags.        |

## Time, History, and Deletion

Store instants as `TIMESTAMPTZ`; present them in the user's timezone. Usually include `created_at`, and add `updated_at` when edits matter. Use a separate business-time field such as `occurred_at` or `published_at` when it means something different from creation time.

Soft delete (`deleted_at`) is useful for a recovery window or audit requirement, but it makes every query, unique rule, and retention policy more complex. Use it deliberately; otherwise a real delete plus backups may be simpler. For financial or other audit-critical records, prefer immutable movements and reversal records over rewriting history.

## Transactions and Concurrent Requests

A transaction makes related writes succeed or fail together. Use one when an operation changes more than one table: create an order and its items, insert an inventory movement and update stock, or create a booking and reserve its time.

Two users can act at the same time. Constraints stop invalid final data; transactions and locks coordinate the work. For an appointment, an overlap query alone is not enough—two requests can both see “available.” Use an appropriate lock or a PostgreSQL exclusion constraint when the business rule requires no overlap.

For external side effects such as payments, store the provider's transaction ID with a unique constraint. That lets a retry return the existing payment rather than recording it twice. See [[Programming/APIs/basics|API Basics]] for idempotency keys.

## Multi-Tenancy and Security Boundaries

In a shared SaaS database, records owned by an organization usually carry `organization_id`. Include it in tenant-scoped uniqueness and common indexes, for example `UNIQUE (organization_id, slug)` and `INDEX (organization_id, created_at DESC)`. This makes the intended query path obvious, but it does not replace server-side authorization or careful tenant filtering.

## Change a Schema Safely

Use the **expand/contract** pattern: add a compatible column/table, backfill in safe batches, deploy code that can read both shapes, move writes/reads, then remove the old shape only after it is unused. Plan migrations, backups, retention, and restore testing as part of database design—not after it.

## Schema Review Checklist

- [ ] The user actions and common queries are written down.
- [ ] Each table has a clear purpose, owner, and lifecycle.
- [ ] Every important invariant has a database constraint or a documented reason it cannot.
- [ ] IDs, relationship cardinality, and `ON DELETE` behavior are deliberate.
- [ ] Historical facts such as prices and financial movements cannot be silently rewritten.
- [ ] Tenant scope, authorization, and scoped uniqueness match the product boundary.
- [ ] Indexes come from real queries; see [[Indexing]] and [[Query Optimization]].
- [ ] Concurrent writes, retries, failure recovery, migration, and deletion have an answer.

## Schema Recipe Book

The recipes below are starting points, not copy-and-paste contracts. Read the “why” and “trade-off” sections first; then adapt the schema to your user actions, invariants, and queries.

---

### Recipe 1: Reddit-Style Forum

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  karma INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE communities (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE posts (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  community_id BIGINT NOT NULL REFERENCES communities(id),
  author_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE comments (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  post_id BIGINT NOT NULL REFERENCES posts(id),
  parent_id BIGINT REFERENCES comments(id),
  author_id BIGINT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Separate tables keep each relationship and uniqueness rule obvious.
CREATE TABLE post_votes (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE comment_votes (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, comment_id)
);

CREATE INDEX idx_posts_community_created ON posts(community_id, created_at DESC);
CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_comments_post_created ON comments(post_id, created_at DESC);
CREATE INDEX idx_comments_parent ON comments(parent_id);
```

**Why this shape**

- **Public IDs are UUIDs.** Internal `BIGSERIAL` keys stay inside the database. UUIDs make sequential enumeration harder and keep URLs separate from internal joins, but authorization still decides who may access a post.
- **`score` is stored on posts and comments.** Recalculating `SUM(value)` on every page load works when tiny, but becomes expensive as vote counts grow. Updating a single integer column keeps read queries fast. You still keep the `votes` table as the source of truth; update `score` when a vote is inserted or deleted.
- **Comments use an adjacency list (`parent_id`).** Each comment points to its parent comment or to nothing for a top-level comment. This is enough for nested threads up to a few levels deep. If you need fast "whole subtree" queries at massive scale, consider a closure table or path enumeration later.
- **Votes are two explicit relationships.** A post vote and a comment vote have different parents. Two small tables make “one vote per user per target” a simple composite primary key and avoid nullable foreign keys or database-specific expression indexes.
- **Indexes target the main read paths.** `posts(community_id, created_at DESC)` gives you a community feed, `posts(author_id)` gives a user profile, and the comment indexes let you render a post thread quickly.

**Trade-off to watch:** If you want "hot" or "top" sorting, `score` alone is not enough. You will need a decay function (Reddit's "hot" algorithm, Hacker News ranking, or a materialized score column updated by a background job).

---

### Recipe 2: Recipe / Cookbook App

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recipes (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  author_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  prep_time_minutes INTEGER,
  cook_time_minutes INTEGER,
  servings INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ingredients (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  unit TEXT
);

CREATE TABLE recipe_ingredients (
  recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id),
  quantity NUMERIC(10,3) NOT NULL,
  notes TEXT,
  PRIMARY KEY (recipe_id, ingredient_id)
);

CREATE TABLE recipe_steps (
  id BIGSERIAL PRIMARY KEY,
  recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  instruction TEXT NOT NULL,
  UNIQUE (recipe_id, step_number)
);

CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE recipe_tags (
  recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);

CREATE INDEX idx_recipes_author ON recipes(author_id);
CREATE INDEX idx_recipe_tags_tag ON recipe_tags(tag_id);
CREATE INDEX idx_recipe_ingredients_ingredient ON recipe_ingredients(ingredient_id);
```

**Why this shape**

- **Ingredients are normalized into their own table.** If ingredients lived as text inside a JSON column, searching for every recipe that uses "chicken" would be slow and case-fuzzy. A proper table lets you build a search index, shopping lists, and substitution suggestions later.
- **`recipe_ingredients` is the junction with domain data.** It stores `quantity` and `notes` per recipe because "2 cups flour, sifted" belongs to the recipe, not to flour itself.
- **`recipe_steps` are separate rows, not a list.** Ordered rows make reordering cheap: swap two `step_number` values instead of rewriting a JSON blob. They also localize edits and avoid parsing nested data in every query.
- **`quantity` uses `NUMERIC(10,3)`.** Money should use `NUMERIC(12,2)`, but ingredient quantities need three decimals for things like "0.125 teaspoon." Using floating-point (`REAL`/`DOUBLE`) would introduce rounding errors when scaling recipes.
- **Tags are a classic many-to-many.** `recipe_tags(tag_id)` is indexed so "show all breakfast recipes" is fast.

**Trade-off to watch:** This schema assumes one canonical unit per ingredient. If you need to convert between cups, grams, and ounces, add a `units` table and a `ingredient_unit_conversions` table instead of storing free-text units.

---

### Recipe 3: E-Commerce

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL
);

CREATE TABLE product_inventory (
  product_id BIGINT PRIMARY KEY REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
  total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL
);

CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  provider_transaction_id TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE UNIQUE INDEX idx_payments_provider_tx ON payments(provider, provider_transaction_id);
```

**Why this shape**

- **`orders` and `order_items` are split.** An order can have many items. Putting line items in their own table avoids duplicating order-level data and lets you query product sales history without parsing arrays.
- **`unit_price` is captured at checkout time.** Product prices change. The `orders` total and each line item's price must remain historically accurate, so you copy the price into `order_items` instead of joining back to `products`.
- **`product_inventory` is separate from `products`.** Inventory counts change constantly, while product descriptions are read-heavy. Splitting them reduces lock contention: updating stock does not lock the product catalog row readers are looking at.
- **`payments` tracks provider details for reconciliation.** The unique index on `(provider, provider_transaction_id)` prevents double-recording the same external payment.
- **Status uses a `CHECK` constraint.** It keeps invalid values out of the database. Treat status changes as a state machine in your application: `pending -> paid -> shipped`, with `cancelled` allowed from early states.

**Trade-off to watch:** The `total` on `orders` is denormalized. Keep it in sync by recalculating from `order_items` whenever items change, or compute it on read until you need the speed. For strict accounting, do not allow edits to completed orders; create refund records instead.

---

### Recipe 4: Personal Finance Tracker

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit', 'investment')),
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  color TEXT,
  UNIQUE (user_id, name)
);

CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_account_date ON transactions(account_id, occurred_at DESC);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_categories_user ON categories(user_id);
```

**Why this shape**

- **Accounts belong to users; transactions belong to accounts.** This hierarchy matches how people think about money and makes balance queries simple: `SUM(amount)` per `account_id`.
- **`categories.user_id` is nullable.** A `NULL` user_id means a global default category shared by everyone; any value means a private custom category. This gives you a default chart of accounts while still allowing personalization.
- **`transactions` is the immutable ledger.** In finance, editing a past transaction should leave an audit trail. For a strict ledger, do not `UPDATE` amounts; insert a reversal row. For a casual tracker, updates are fine, but consider adding an `updated_at` column and a history table later.
- **`occurred_at` vs `created_at`.** `created_at` is when the row was inserted; `occurred_at` is when the money actually moved. Your monthly reports should group by `occurred_at`, not `created_at`.
- **Indexes support the two main views.** `transactions(account_id, occurred_at DESC)` makes the account register fast, and `transactions(category_id)` makes category spending reports fast.

**Trade-off to watch:** `UNIQUE (user_id, name)` allows multiple global categories to share the same name because `NULL != NULL` in SQL. If you want global category names to be unique, add `CREATE UNIQUE INDEX idx_categories_global_name ON categories(name) WHERE user_id IS NULL;`.

---

### Recipe 5: SaaS with Organizations and Members

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organizations (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memberships (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, organization_id)
);

CREATE TABLE projects (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memberships_org_role ON memberships(organization_id, role);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_projects_org_created ON projects(organization_id, created_at DESC);
```

**Why this shape**

- **Roles live on `memberships`, not on `users`.** The same person can be an owner of their startup and a member of a client workspace. A role only makes sense in the context of an organization.
- **`slug` is the human-friendly URL.** `/acme-corp/projects` is nicer than `/org/550e8400-e29b-41d4-a716-446655440000`. Enforce uniqueness at the database level so two orgs cannot claim the same slug.
- **`organizations` owns `projects`.** Projects are tied to the organization, not to an individual user. When someone leaves, the projects stay with the org; only their `membership` row is removed.
- **`plan` is a string, not an enum.** Plans change with billing experiments. A `CHECK` constraint would force a migration every time you add a tier; a string with application-level validation is more flexible for early products.
- **Indexes support "who is in this org" and "what orgs is this user in."** `memberships(organization_id, role)` also lets you quickly list all admins or owners.

**Trade-off to watch:** Deleting an organization cascades to memberships but not to projects. Decide whether `projects` should also `ON DELETE CASCADE` or be archived instead. In most SaaS apps, you want a soft delete or grace period before destroying customer data.

---

### Recipe 6: Task / Project Management (Trello-Style)

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT
);

CREATE TABLE workspaces (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id BIGINT NOT NULL REFERENCES users(id)
);

CREATE TABLE boards (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lists (
  id BIGSERIAL PRIMARY KEY,
  board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position FLOAT NOT NULL DEFAULT 0
);

CREATE TABLE cards (
  id BIGSERIAL PRIMARY KEY,
  list_id BIGINT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  position FLOAT NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lists_board_position ON lists(board_id, position);
CREATE INDEX idx_cards_list_position ON cards(list_id, position);
```

**Why this shape**

- **Floats for `position` are the classic Kanban trick.** If positions were integers (`1, 2, 3...`), inserting a card between positions 2 and 3 would require updating every later card. With floats, you insert at `2.5`, then `2.25`, then `2.125`. Only the moved card changes.
- **Cascade deletes match containment.** Lists and cards are useless without their parent board/list, so `ON DELETE CASCADE` keeps cleanup automatic. Workspaces are not cascaded because you may want to transfer boards to a new workspace or preserve them before deleting the workspace owner.
- **`board_id` is on `lists`, and `list_id` is on `cards`.** You do not need `board_id` on cards if you always fetch the list first, but adding a redundant `board_id` on cards lets you query all cards on a board without a join. That is a valid denormalization if you index it.
- **Indexes preserve order on read.** Both indexes lead with the parent ID and end with position so the UI can render boards and lists in the right order without a separate sort.

**Trade-off to watch:** Float precision is finite. After thousands of reorders you can run out of space between two neighbors. Run an occasional "rebalance" job that resets positions back to clean integers when the gaps get small.

---

### Recipe 7: Blogging / CMS Platform

```sql
CREATE TABLE authors (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  bio TEXT
);

CREATE TABLE posts (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  author_id BIGINT NOT NULL REFERENCES authors(id),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE post_tags (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES posts(id),
  parent_id BIGINT REFERENCES comments(id),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_posts_status_published ON posts(status, published_at DESC)
  WHERE status = 'published';
CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);
CREATE INDEX idx_comments_post_created ON comments(post_id, created_at DESC);
```

**Why this shape**

- **Posts have both a UUID and a slug.** The UUID is the opaque API identifier; the slug is the SEO-friendly URL path (`/blog/schema-design-guide`). Keeping them separate lets you change a slug without breaking external links, as long as you redirect the old slug.
- **Status plus a partial index for published posts.** The public blog list only shows `status = 'published'`. The partial index `WHERE status = 'published'` stays small and fast because drafts and archived posts are excluded.
- **`published_at` is separate from `created_at`.** You can write drafts days before publishing. Sorting the public blog by `published_at` gives readers a chronological archive; sorting by `created_at` would leak your draft schedule.
- **Authors are separate from users.** A CMS often has guest contributors or imported authors who do not have login accounts. A separate table keeps that option open.
- **Comments use an adjacency list.** `parent_id` gives you threaded replies. If you need to render a whole comment tree in one query, use a recursive CTE (`WITH RECURSIVE`).

**Trade-off to watch:** `slug` is globally unique here, which means two authors cannot write posts titled "Hello World." If you want slugs scoped per author, change the unique constraint to `(author_id, slug)`.

---

### Recipe 8: Appointment Scheduling

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT
);

CREATE TABLE services (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price NUMERIC(10,2)
);

CREATE TABLE appointments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_appointments_user_starts ON appointments(user_id, starts_at DESC);
CREATE INDEX idx_appointments_time_range ON appointments(starts_at, ends_at);
```

**Why this shape**

- **`starts_at` and `ends_at` are both stored.** Even though `ends_at` could be derived from `starts_at + duration`, storing it makes overlap queries and range scans simpler. You can also override duration for one-off appointments without creating a custom service.
- **The `CHECK (ends_at > starts_at)` constraint prevents nonsense rows.** Status validation keeps the state machine honest.
- **`services` is a lookup table.** It defines the default duration and price. `appointments.unit_price` copies the price at booking time so historical invoices stay correct even if service prices change.
- **The time-range index supports conflict detection.** To find any appointment that overlaps a candidate slot, query `WHERE starts_at < candidate_end AND ends_at > candidate_start`. The index on `(starts_at, ends_at)` makes that fast.

**Trade-off to watch:** This simplified recipe assumes one shared scheduling calendar. Real booking apps normally add a `provider_id`, room, or resource ID and prevent overlaps within that resource. The index and `CHECK` constraint do not, by themselves, prevent double-booking under concurrent requests; use row-level locking or a PostgreSQL exclusion constraint when the rule must be enforced.

---

### Recipe 9: Inventory / Warehouse

```sql
CREATE TABLE warehouses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE inventory (
  product_id BIGINT NOT NULL REFERENCES products(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  delta INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inventory_warehouse ON inventory(warehouse_id);
CREATE INDEX idx_movements_product_created ON inventory_movements(product_id, created_at DESC);
```

**Why this shape**

- **`inventory` stores the current state; `inventory_movements` stores every change.** This is event-sourcing lite. The current row answers "how many do we have now?" The movements table answers "who changed it and why?"
- **`inventory` uses a composite primary key.** A product can exist in many warehouses, so the natural key is `(product_id, warehouse_id)`. That also makes "all products in warehouse X" queries efficient.
- **`delta` can be positive or negative.** Receiving stock is `+10`; a sale is `-1`; a damage write-off is `-3`. This avoids needing separate tables for every movement type.
- **Movements are indexed for audit trails.** `inventory_movements(product_id, created_at DESC)` lets you quickly show the recent history of a single SKU.

**Trade-off to watch:** Keeping `inventory.quantity` in sync with the sum of movements is a classic consistency problem. You can compute quantity from movements only and skip the `inventory` table, but reads become slower. Alternatively, update `inventory.quantity` inside the same transaction that inserts the movement and guard it with row-level locking.

---

### Recipe 10: Job Board

```sql
CREATE TABLE companies (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name TEXT NOT NULL,
  website TEXT
);

CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  remote BOOLEAN NOT NULL DEFAULT false,
  salary_min NUMERIC(12,2),
  salary_max NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'filled')),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE job_tags (
  job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, tag_id)
);

CREATE INDEX idx_jobs_company ON jobs(company_id);
CREATE INDEX idx_jobs_status_posted ON jobs(status, posted_at DESC)
  WHERE status = 'open';
```

**Why this shape**

- **Companies are separate from jobs.** A company posts many jobs, has its own profile page, and may outlive individual listings. Using a separate table avoids repeating company details in every job row.
- **Partial index on open jobs.** The homepage almost always lists `status = 'open'`. The partial index excludes closed and filled jobs, so it stays small and the hot query stays fast even after years of listings accumulate.
- **`salary_min` and `salary_max` are nullable ranges.** Not every job posts a salary. Using two columns (instead of one text field) lets you filter and sort by compensation later.
- **`remote` is a boolean.** You could model this as a location value like "remote", but a dedicated boolean makes the common "remote only" filter trivial and indexable.
- **Tags are reused from the same pattern as Recipe 2 and Recipe 7.** A `tags` lookup table plus a junction table keeps tag names normalized.

**Trade-off to watch:** Job seekers can apply; you will eventually need an `applications` table with `user_id`, `job_id`, `resume_url`, `status`, and `applied_at`. Keep applications in their own table, not as a column on `jobs`, because one job receives many applications and one user applies to many jobs.

---

### Recipe 11: URL Shortener

```sql
CREATE TABLE links (
  id BIGSERIAL PRIMARY KEY,
  short_code TEXT NOT NULL UNIQUE,
  destination_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE link_clicks (
  id BIGSERIAL PRIMARY KEY,
  link_id BIGINT NOT NULL REFERENCES links(id),
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX idx_clicks_link_time ON link_clicks(link_id, clicked_at DESC);
```

**Why this shape**

- **`short_code` is the natural key.** Lookups happen by short code, not by internal id. Make it unique and the primary query path. In production you often generate short codes from a base-62 or base-64 encoding of an integer to keep them short and collision-free.
- **`destination_url` is plain text.** URLs can be longer than 2048 characters, so `VARCHAR(255)` is not safe. Use `TEXT`.
- **`expires_at` allows cleanup.** Old links can be deleted or archived by a scheduled job. Without it, your short-code namespace slowly fills up.
- **`link_clicks` is append-only analytics.** Every redirect inserts a row. It is naturally write-heavy and rarely updated. The `INET` type stores IP addresses compactly if you use PostgreSQL; otherwise a string works fine.
- **`clicked_at` is indexed per link.** That lets you show "clicks over time" for a specific short link without scanning the whole click table.

**Trade-off to watch:** At very high scale, `link_clicks` becomes huge. Consider partitioning it by month, writing clicks to a time-series store, or sampling analytics data instead of recording every click in the primary database.

---

### Recipe 12: Address Book

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE addresses (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL DEFAULT 'home',
  line_1 TEXT NOT NULL,
  line_2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country_code TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_addresses_user ON addresses(user_id);
CREATE UNIQUE INDEX idx_addresses_one_default_per_user
  ON addresses(user_id) WHERE is_default = true;
```

**Why this shape**

- **Addresses live in their own table.** One user can have many addresses (home, work, shipping, billing). Storing them as columns on `users` would force you to pick a fixed number upfront and duplicate user data.
- **`is_default` is a boolean, not an enum.** Users usually have one "default" address for checkout. The partial unique index enforces at most one default address per user.
- **`country_code` is short text.** Use ISO 3166-1 alpha-2 codes (`US`, `CA`, `DE`). They are compact, standardized, and easy to map to formatting and validation rules.
- **`postal_code` and `state` are `TEXT`, not fixed-length strings.** Postal codes can contain letters and spaces (`SW1A 1AA` in the UK), and state/province names vary wildly across countries. Avoid `VARCHAR(5)` which only works for US ZIP codes.
- **`label` is free text.** Labels like "home", "work", "parents" are user-defined, so an enum would be too restrictive. If you want to offer presets while allowing custom labels, keep it as text and validate in the app.

**Trade-off to watch:** This schema assumes a generic address format. International addresses can have more lines, provinces instead of states, and other fields. If you ship globally, add a `region` and additional address lines, or use a structured address library and store the raw formatted address as a fallback.

---

## How to Use These Recipes

1. Start with the recipe's user actions and trade-off—not the SQL.
2. List your own invariants and common reads/writes before adding or removing tables.
3. Adapt names, ownership, statuses, and lifecycle to your domain.
4. Add constraints first; add indexes from expected queries and verify them with `EXPLAIN ANALYZE`.
5. Decide how retries, concurrent writes, deletion, and history behave.
6. See [[Case Studies]] for deeper domain-specific discussion and trade-offs.

---

## Further Reading

- [[Keys_Simple_Composite_Compound|Keys: Simple vs Composite vs Compound]] — how to choose the right primary-key shape
- [[Indexing]] — how to speed up your well-designed tables
- [[Query Optimization]] — how to write queries that work with your design
- [[Case Studies]] — deeper discussion of a few domain schemas
- [[Drizzle_Recipes|Drizzle Recipes]] — these schemas implemented in Drizzle ORM with valibot validators
- [Database Design for Mere Mortals](https://www.amazon.com/Database-Design-Mere-Mortals-Hands-/dp/0321884493) (book)

## Talk It Through With an LLM

- “Give me a small product scenario. Ask for my user actions, invariants, and common queries before letting me draw tables.”
- “Review this schema as a senior backend engineer. Point out missing constraints, risky deletes, tenant leaks, and concurrent-write problems before discussing indexes.”
- “Explain why this relationship uses a composite key or a generated ID in plain language, then ask me to explain it back.”
