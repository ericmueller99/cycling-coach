# One image serves the API and the built SPA (docs/DECISIONS.md #5).
#   docker build -t cycling-coach .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cycling-coach/web build && pnpm --filter @cycling-coach/api build
# A self-contained production node_modules for the API (workspace packages are bundled by tsup).
RUN pnpm --filter @cycling-coach/api deploy --prod /out

FROM node:22-alpine AS runtime
LABEL org.opencontainers.image.title="cycling-coach"
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    WEB_DIST=/app/web
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "dist/server.js"]
