# syntax=docker/dockerfile:1
# =============================================================================
# 开项 KaiPilot —— frontend 生产式镜像（v3-docker-compose-runtime-foundation, design D3/D4）
#
# - 与 backend 同一 Node 26.10.0 bookworm-slim / Corepack 0.36.0 / pnpm 12.8.1 基线。
# - Next.js standalone 输出 + monorepo file-tracing root（next.config.mjs），
#   runner 只复制 standalone server、.next/static 与 public 运行产物。
# - `NEXT_PUBLIC_API_URL=/api/v1` 固定为相对同源路径：浏览器经 edge 访问同一公开端口，
#   目标主机换 IP/域名无需 rebuild；禁止把 Compose 内部 `backend` DNS 或目标机地址
#   烘焙进前端产物。
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

# --- 依赖层：仅清单先行 ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/types/package.json packages/types/
COPY packages/compiler-spec/package.json packages/compiler-spec/
COPY packages/config/package.json packages/config/
COPY apps/frontend/scripts/patch-r3f.mjs apps/frontend/scripts/patch-r3f.mjs
RUN pnpm install --frozen-lockfile --filter @aiproj/frontend...

# --- 构建层 ---
FROM deps AS build
# 相对同源 API 基址在构建期固化（design D4）
ENV NEXT_PUBLIC_API_URL=/api/v1
# 新 UI 组织级灰度门控（lib/feature-flags/next-ui-gate.ts）：NEXT_PUBLIC_* 在构建期内联，
# 运行时注入无效，必须经 compose build.args 传入后 rebuild。缺省 Fail-Closed 关闭。
ARG NEXT_PUBLIC_FF_NEXT_UI=
ARG NEXT_PUBLIC_FF_NEXT_UI_ORGS=
ENV NEXT_PUBLIC_FF_NEXT_UI=${NEXT_PUBLIC_FF_NEXT_UI}
ENV NEXT_PUBLIC_FF_NEXT_UI_ORGS=${NEXT_PUBLIC_FF_NEXT_UI_ORGS}
# 「源代码」链接地址（AGPL 第 13 条，components/edition/SourceCodeLink.tsx）；留空不显示
ARG NEXT_PUBLIC_AIPROJ_SOURCE_URL=https://github.com/scopeharbor/KaiPilot
ENV NEXT_PUBLIC_AIPROJ_SOURCE_URL=${NEXT_PUBLIC_AIPROJ_SOURCE_URL}
# 容器构建期启用 Next standalone 输出（Windows 本机无符号链接权限，默认关闭）
ENV NEXT_STANDALONE=1
COPY packages/types packages/types
COPY packages/compiler-spec packages/compiler-spec
COPY packages/config packages/config
COPY apps/frontend apps/frontend
# NODE_OPTIONS heap 仅作用于构建进程（含 next build 派生的 TypeScript 检查 worker）：
# GCP 实测默认约 2GB 堆在「Running TypeScript」阶段 OOM；production runtime 不继承此设置。
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @aiproj/frontend build

# --- 运行时层：非 root、standalone 最小产物 ---
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

# 固定非 root 运行身份（与 backend 同一 UID/GID 约定）
RUN groupadd --gid 10001 aiproj \
  && useradd --uid 10001 --gid aiproj --shell /usr/sbin/nologin --no-create-home aiproj

# monorepo standalone：server.js 位于 standalone/apps/frontend/，依赖在 standalone/node_modules
COPY --from=build --chown=10001:10001 /app/apps/frontend/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=build --chown=10001:10001 /app/apps/frontend/public ./apps/frontend/public
# 帮助中心 Markdown 内容树：/help 首页在构建期预渲染，但文章详情、搜索与 /api/help/*
# 是运行期按请求读盘（lib/help/load.ts），standalone 追踪不会带上非 import 的文件，
# 缺失时 readdirSync ENOENT → 页面 500。
COPY --from=build --chown=10001:10001 /app/apps/frontend/content ./apps/frontend/content
COPY apps/frontend/docker/healthcheck.mjs /app/docker/healthcheck.mjs
RUN chmod 0555 /app/docker/healthcheck.mjs

USER 10001:10001
EXPOSE 3000

CMD ["node", "apps/frontend/server.js"]
