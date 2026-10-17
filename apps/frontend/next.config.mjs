/** @type {import('next').NextConfig} */
/* global process */
import webpack from 'next/dist/compiled/webpack/webpack-lib.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const appDir = dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  // 并行 dev 实例隔离（v3-help-and-operational-issues-center E2E）：多个 `next dev`
  // 共用同一 .next 会互相踩坏 webpack 模块缓存（`__webpack_modules__[moduleId] is
  // not a function`）；NEXT_DIST_DIR 让 E2E 编排器用独立构建目录。生产/常规 dev 不变。
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // v3-docker-compose-runtime-foundation（task 4.1）：生产容器镜像使用 standalone 输出，
  // runner 只复制 standalone server + static + public；不影响 `pnpm dev` 开发路径。
  // Windows 本机在未开启 Developer Mode 时无法创建符号链接（fs.symlink EPERM），
  // `next build` 会在 standalone 复制阶段失败——故仅容器构建（Dockerfile 设
  // NEXT_STANDALONE=1）启用 standalone，本机 build 产出普通产物。
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  // Next.js 15+ outputFileTracingRoot 已稳定为顶层配置。monorepo standalone
  // 产物按仓库根追溯 workspace 依赖（@aiproj/types 等）。
  outputFileTracingRoot: join(appDir, '../../'),
  // Next.js 16 默认启用 Turbopack；空配置声明表明已知悉自定义 webpack 配置。
  turbopack: {},
  // 关闭内置 TypeScript 检查，统一走共享 typecheck 任务（strict 更可控）。
  typescript: {
    ignoreBuildErrors: false,
  },
  // 共享包源码直接编译（monorepo TS 源，无需 dist）。
  transpilePackages: ['@aiproj/types'],
  // 共享包（NodeNext 后端）内部用 `.js` 扩展写相对导入，webpack 需要
  // extensionAlias 把 `.js` 映射回 `.ts`。
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    }
    // packages/types 中 outgoing-webhook-delivery.ts 的 import crypto from 'node:crypto'
    // 仅供后端签名/验证使用，在前端构建时不需要；resolve.alias / fallback 对 node:
    // 协议不生效，用 NormalModuleReplacementPlugin 替换掉 node:crypto 请求。
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, (resource) => {
        resource.request = 'crypto'
      }),
    )
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      crypto: false,
    }
    // 简体/繁体文字变体（spec: text-variant）：`cc-loader` 在 SWC/TS 编译前把
    // 含 CJK 的单行 JSXText 改写为 `<CC s tw hk />` 并注入 import（规则见
    // compiler/cc-loader.js 顶注）。dev 与 build 两端的 webpack 都会执行本回调，
    // loader 对 server/client 模块一视同仁，无需按端过滤。
    config.module.rules.push({
      test: /\.tsx$/,
      enforce: 'pre',
      exclude: /node_modules/,
      use: [{ loader: join(appDir, 'compiler/cc-loader.js') }],
    })
    return config
  },
}

export default nextConfig
