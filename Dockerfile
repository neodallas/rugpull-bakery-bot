# syntax=docker/dockerfile:1.6
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN addgroup -S bot && adduser -S bot -G bot
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY config.json ./config.json
RUN mkdir -p /app/data && chown -R bot:bot /app
USER bot
CMD ["node", "dist/main.js"]
