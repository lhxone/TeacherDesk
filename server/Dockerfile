# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:20-alpine AS build

# Prisma's query engine needs openssl at generate time on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma/schema.prisma ./prisma/
COPY prisma/migrations ./prisma/migrations/
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

# No prune: the migrate service shells out to the Prisma CLI, which lives in
# devDependencies. Pruning and reinstalling it leaves a partial tree that makes
# `migrate deploy` fail with a misleading "can't write to @prisma/engines".

# ---------- runtime ----------
FROM node:20-alpine AS runtime

# tini reaps zombies and forwards signals so the app shuts down cleanly.
# openssl + libc6-compat back the Prisma engine's runtime library lookup.
RUN apk add --no-cache tini openssl libc6-compat

ENV NODE_ENV=production
WORKDIR /app

# --chown so the unprivileged runtime user owns the tree it runs from.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./

# The engine target is pinned in schema.prisma (binaryTargets), so the CLI
# resolves the vendored musl/openssl-3 engine without probing for another.

# Run unprivileged; the base image already ships a `node` user.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
