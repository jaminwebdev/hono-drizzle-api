# Simplicity review after phase 5C

The runtime is about 281 lines across five files. There are no application tables, feature layers, background workers, or additional runtime services. The code is small; the main risk is adding more policy and supporting code before the first working feature needs it.

## Keep

| Part | Why it earns its place |
| --- | --- |
| Explicit bootstrap and `createApp(database, settings)` | Startup owns one pool and passes dependencies visibly. Imports have no connection or server side effects. |
| One configuration schema | It validates supplied values and uses URL parsing rather than custom hostname rules. Error messages omit submitted values. |
| Hono body limits, CORS, method handling, and security headers | These reuse framework behavior. The custom stream reader and preflight checks are gone. |
| Common errors and the small `ApiError` class | They give parsing, readiness, and routing failures one response shape while hiding unexpected error details. A second error framework is unnecessary. |
| Simple readiness and bounded shutdown | Readiness is one SELECT 1. Shutdown has one function and a final deadline, without a lifecycle manager or retry system. |
| Metadata-only request logging | Five explicit fields avoid needing a general logging package or a growing redaction configuration. |

## Candidates to discuss before more implementation

| Candidate | Benefit and tradeoff | Recommendation |
| --- | --- | --- |
| Strict Accept negotiation | Always returning JSON would remove the negotiation middleware, its client-facing 406 rule, and its test cases. Clients already expect JSON. Keeping it teaches HTTP negotiation, but the app does not offer another response format. | This is the strongest optional runtime removal. Drop it if negotiation is not a learning goal. Keep logging. |
| Repeated setup and HTTP reference details | [README](../../README.md), [setup](../../docs/setup.md), [the API guide](../../docs/api.md), and [PROJECT_MAP](../../PROJECT_MAP.md) repeat some settings, endpoint behavior, and limits. Each change then requires several synchronized edits. Useful explanations should remain available. | Make setup the settings/commands reference and the API guide the HTTP reference. Keep README as a quick start and PROJECT_MAP as rules plus a file map. |
| Helpers before their first real caller | `readJson` is currently used only by a test route. It is now a small wrapper around Hono, but it arrived before registration needs it. Origin policy is also mostly preparation while the API has no write endpoints. | Add no more general infrastructure before registration. Removing and recreating the small helper immediately offers little benefit; judge it again with its first real handler. |

The existing CORS block is optional, uses Hono, and is off by default. Leave it small until a browser frontend exists. Do not add more browser configuration merely because the framework supports it.

## Process changes

The first versions of configuration, readiness, and JSON reading did more than the learning exercise needed. Framework helpers and small explicit checks now replace that machinery. Future work should start with the built-in behavior and add a custom rule only for a concrete requirement.

Phase 5B exceeded the file target because configuration touched startup, the app factory, tests, and several guides. Estimate that coupling before implementation. Do not introduce an abstraction merely to reduce the changed-file count. Consolidating the docs should make later feature reviews smaller.

The production Docker artifacts remain deferred and unverified. In particular, [production Compose](../../compose.production.yaml) does not yet supply the now-required API_ORIGIN. Fix and verify those artifacts in their planned deployment-check phases; they are not part of the current host-development path.

## Suggested next decision

Choose whether to keep strict Accept negotiation, then do a small documentation-consolidation commit if desired. After that, proceed to the users table and registration. Avoid another round of general-purpose infrastructure.

This review proposes changes. It does not apply cleanup or authorize phase 6. Phase 5C validation passed type checking, lint, all 82 Bun tests, and build. No API process or database container was started for this phase or review.
