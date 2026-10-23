FROM node:24.22.1-bookworm-slim AS base
WORKDIR /app
RUN chown node:node /app
USER node

FROM base AS development
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
CMD ["npm", "run", "dev"]

FROM development AS build
RUN npm run build

FROM base AS production-dependencies
ENV NODE_ENV=production
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
EXPOSE 3000
CMD ["node", "dist/server.js", "production"]
