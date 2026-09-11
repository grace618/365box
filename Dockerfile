# 多阶段：构建 Web 静态资源 + 安装服务端依赖（含 better-sqlite3 原生模块）
FROM node:20-bookworm AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-bookworm AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./

# 与构建阶段同基础镜像，避免 better-sqlite3 原生模块缺库
FROM node:20-bookworm
WORKDIR /app
COPY --from=server-build /app/server ./server
COPY --from=web-build /app/web/dist ./web/dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3002
ENV WEB_DIST=/app/web/dist

VOLUME ["/app/server/data"]
EXPOSE 3002
WORKDIR /app/server
CMD ["npx", "tsx", "src/index.ts"]
