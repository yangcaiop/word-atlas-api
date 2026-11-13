ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY=https://registry.npmjs.org/
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --registry="${NPM_REGISTRY}" --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --registry="${NPM_REGISTRY}" --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 TZ=UTC

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node docker/api/entrypoint.mjs docker/api/healthcheck.mjs ./docker/

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 CMD ["node", "docker/healthcheck.mjs"]
ENTRYPOINT ["node", "docker/entrypoint.mjs"]
CMD ["serve"]
