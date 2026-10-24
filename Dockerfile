# USCIS Tracker's image: the built web app AND the API on one port (SERVE_WEB=1), so an install is this and
# Postgres. The server applies schema.sql, creates its secrets and Web Push keys on start, so nothing runs by
# hand. Built for linux/amd64 and linux/arm64 by .github/workflows/release.yml.

FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
# The server's dependencies only (tsx runs its TypeScript); React, Vite and the rest stay in the build stage.
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY schema.sql ./schema.sql
COPY --from=build /app/dist ./dist
RUN chown -R node:node /app
USER node
ENV NODE_ENV=production \
    PORT=8080 \
    SERVE_WEB=1 \
    WEB_ROOT=./dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]

LABEL org.opencontainers.image.title="USCIS Tracker" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
