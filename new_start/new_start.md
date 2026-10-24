I want to build an application with the following stack:

- Bun
- Hono for the API layer
- postgres running in a docker container (with a persistent volume of course)
- Drizzle as the ORM
- seed scripts to seed the dev database
- valibot for any runtime validation needs
- proper .env.local and .env.production files (as well as a .env.example for the README to reference)

I want the application to be a moderately comprehensive API for a finance tracker: the ability to add accounts, transactions, categories, and tags for both accounts and transactions to power search.

The Bun and Hono API should be run locally and connect to the docker postgres instance.

## Coding Style

I want commits to be small and incremental as possible. No 10+ file commits outside of any initial scaffolding and setup.

Make the code straight forward and free of unnecessary abstractions as possible. Llm agents tend to over abstract and create over engineered solutions with 4+ wrapping functions. I'm more of a "WET" programmer (write everything three times) before I decided to abstract. The implementations should be straight forward. Llms also tend to abstract and spread things into many small modules, which can make following data flows difficult - none of that. I'll direct abstractions when appropriate.

## Best Practices

Follow industry best practices for the database and API designs in ./new_start.

I also want Hono routes separated into their own namespaces (a file for account related endpoints, another for transaction related endpoints, etc), but not in a pattern that separates route files from handlers. I think that pattern is a code smell with unnecessary abstraction.

## Scripts

There should be scripts in package.json to allow for easily calling docker commands like db:up for running a compose file and db:down for spinning it down, drizzle studio, typical checks and dev scripts for checking and running the API as well as test commands.

## Testing

Unit tests with Bun test runner. Ensure tests are focused on business logic, not things like "execute drizzle insert data and then evaluate the data is in the database". We're testing application logic, not packages.

## Deliverable

Write a comprehensive and thorough todo document to scaffold and create this application.

I want it broken into small phases with approval gates so I can review the code and make the commit manually. Suggest a commit when each todo/phase is implemented.

All documentation generated should be generally beginner-friendly, free of overly technical jargon. It should be generous with code snippets and mermaid diagrams. Some features may have their own guide in a /docs directory to further explain their details.

## Future Considerations

- Auth: some form of auth. I don't have a preference as long as it's an industry standard and avoids the most common security pitfalls for things like XSS, CSRF, broken access controls, etc. Session I believe is likely the "best" option but I'm not married to it. I just know that JWT is prone to more lax revoke capabilities, etc.
