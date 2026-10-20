# syntax=docker/dockerfile:1
# =============================================================================
# 开项 KaiPilot —— backend 生产式镜像（v3-docker-compose-runtime-foundation, design D3）
#
# 基线决策（task 2.3，evidence 见 observation-and-inventory.md §2.3）：
# - Node 26.10.0 bookworm-slim（当前最新 Current 稳定版，精确到 patch）：仓库
#   engines.node>=26；Node 25+ 不再内置 Corepack，因此显式安装固定 Corepack。
# - Debian slim/glibc：better-sqlite3、@napi-rs/canvas 等 native module 走 glibc 预编译，
#   不用 Alpine/musl。
# - pnpm 由 Corepack 按根 packageManager 固定为 12.8.1（原生二进制分发，Corepack 经
#   其 bin/pnpm.mjs 入口拉起）；禁止 Bun 与 latest 标签。
# - workspace 共享包（@aiproj/types、@aiproj/compiler-spec）导出 .ts 源：
#   runner 以显式 runtime dependency `tsx` 作 TS ESM loader 执行已编译入口
#   （已在协作主机验证：无 loader 时 Node 报 ai-m0.js 解析失败；--import tsx 后
#   migration:status/run exit 0）。未来共享包 dist 发布契约属后续独立 change。
# =============================================================================

ARG NODE_IMAGE=node:26.10.0-bookworm-slim

# --- 基础层：Corepack + 固定 pnpm ---
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Node 26 不再内置 Corepack；固定引导器与 pnpm，并在可缓存层预热下载。
RUN npm install --global corepack@0.36.0 \
  && corepack enable \
  && corepack prepare pnpm@12.8.1 --activate \
  && pnpm --version

# --- 依赖层：仅清单先行，最大化构建缓存 ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/types/package.json packages/types/
COPY packages/compiler-spec/package.json packages/compiler-spec/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --filter @aiproj/backend...

# --- 构建层：定向 Adonis build ---
FROM deps AS build
COPY packages/types packages/types
COPY packages/compiler-spec packages/compiler-spec
COPY packages/config packages/config
COPY apps/backend apps/backend
# Lucid 官方建议将生成的 database/schema.ts 纳入版本控制，使 fresh clone、CI
# 与 production image 可直接 typecheck/build。迁移与 schema generation 在开发/CI
# 验证流程中保持同步；生产镜像构建不创建 scratch DB、不重放迁移。运行期迁移仍由
# Compose 的一次性 migrate service 在真实目标数据库上执行并作为启动闸门。
# `node ace build` 的 init hook 会生成 .adonisjs indexes，因此 Dockerfile 不需要再
# 显式运行 codegen:indexes；该独立命令只保留给 fresh-clone typecheck 前置。
# NODE_OPTIONS heap 仅作用于构建进程（GCP 实测默认约 2GB OOM，4096MB 通过）；
# production runtime 不继承此设置。
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @aiproj/backend build

# --- 生产依赖层：只装 production 依赖（workspace 包已在 dependencies 声明） ---
FROM base AS prod-deps
WORKDIR /app
# native module 兜底编译工具（better-sqlite3 无预编译包时回退源码构建）
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/types/package.json packages/types/
COPY packages/compiler-spec/package.json packages/compiler-spec/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --prod --filter @aiproj/backend...

# --- 运行时层：非 root、最小产物 ---
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
WORKDIR /app

# 固定非 root 运行身份（UID/GID 10001），与 docker-entrypoint.sh 约定一致
RUN groupadd --gid 10001 aiproj \
  && useradd --uid 10001 --gid aiproj --shell /usr/sbin/nologin --no-create-home aiproj

# 生产 node_modules（含 tsx 与 workspace 链接）+ workspace TS 源 + 构建产物
# 注：packages/types 零运行时依赖（无 node_modules 目录），只复制其 manifest 与 TS 源；
# packages/compiler-spec 的运行时依赖（zod）经 prod-deps 的 node_modules 提供。
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=prod-deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=prod-deps /app/packages/types/package.json ./packages/types/package.json
COPY --from=prod-deps /app/packages/compiler-spec/package.json ./packages/compiler-spec/package.json
COPY --from=prod-deps /app/packages/compiler-spec/node_modules ./packages/compiler-spec/node_modules
COPY packages/types ./packages/types
COPY packages/compiler-spec ./packages/compiler-spec
COPY --from=build /app/apps/backend/build ./apps/backend/build

# 容器入口与探针
COPY apps/backend/docker/docker-entrypoint.sh /app/docker/docker-entrypoint.sh
COPY apps/backend/docker/healthcheck.mjs /app/docker/healthcheck.mjs
COPY apps/backend/docker/select-database.mjs /app/docker/select-database.mjs
RUN chmod 0555 /app/docker/docker-entrypoint.sh /app/docker/healthcheck.mjs /app/docker/select-database.mjs

# 最小可写目录：SQLite 数据目录与 storage/uploads（named volume 挂载点，首次挂载继承属主）
RUN mkdir -p /app/data /app/storage/uploads \
  && chown -R 10001:10001 /app/data /app/storage

USER 10001:10001
EXPOSE 3333

ENTRYPOINT ["/app/docker/docker-entrypoint.sh"]
CMD ["serve"]
