FROM oven/bun:1.3.14-debian AS base
WORKDIR /app
RUN chown bun:bun /app
USER bun

FROM base AS build
COPY --chown=bun:bun package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY --chown=bun:bun . .
RUN bun run build

FROM base AS production-dependencies
ENV NODE_ENV=production
COPY --chown=bun:bun package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun package.json bunfig.toml ./
EXPOSE 3000
CMD ["bun", "--no-env-file", "dist/server.js", "production"]
