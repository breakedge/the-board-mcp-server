# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# 依存のインストール (lockfile を先に COPY して layer cache を効かせる)
# --ignore-scripts: prepare フック (npm run build) が src 未配置の段階で
# 走るのを防ぐ。ビルドは src 配置後に明示的に実行する。
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ソースをコピーしてビルド
COPY tsconfig.json ./
COPY src ./src
COPY openapi ./openapi
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 本番依存のみをインストール (devDependencies 除外, scripts 無効化)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ビルド成果物と OpenAPI スキーマをコピー
# (schema-loader は dist/openapi/ から ../../openapi/ を参照するため openapi/ が必要)
COPY --from=build /app/dist ./dist
COPY openapi ./openapi

# MCP は stdio トランスポートで通信する
ENTRYPOINT ["node", "dist/index.js"]
