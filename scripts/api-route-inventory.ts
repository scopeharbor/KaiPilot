#!/usr/bin/env tsx
/**
 * 当前 `/api/v1` 路由盘点提取器
 *
 * 从 `apps/backend/start/routes.ts` 确定性解析已注册路由，
 * 输出标准化的 route inventory 记录。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── 类型定义 ──────────────────────────────────────────────────────────
export interface InventoryRow {
  method: string
  path: string
  openApiPath: string
  routeName: string
  apiVersion: string
  classification: 'auth' | 'public' | 'dev-only' | 'whitelist'
  whitelistReason: string
  source: string
  middleware: string[]
}

export interface InventoryResult {
  version: string
  generatedAt: string
  source: string
  total: number
  whitelisted: number
  rows: InventoryRow[]
}

// ── 常量 ──────────────────────────────────────────────────────────────
const WHITELIST_PREFIXES: { prefix: string; reason: string }[] = [
  { prefix: '/api/v1/health', reason: 'public health endpoint' },
  { prefix: '/dev/', reason: 'dev-only sandbox' },
  { prefix: '/api/v1/dev/', reason: 'dev-only sandbox' },
]

const AUTH_MIDDLEWARE_NAMES = ['auth', 'auth:api', 'rbac']

// ── 解析器 ────────────────────────────────────────────────────────────

/**
 * 基于缩进追踪的 group 结构解析器。
 *
 * 原理：`.group(() => {` 行会增加缩进层级，`})` 行会减少。
 * 通过追踪每行的缩进和括号层级来确定 group 的闭合位置。
 */
export function extractRoutesFromFile(
  filePath: string,
  apiPrefix: string = '/api/v1',
): InventoryResult {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const source = path.relative(process.cwd(), filePath)

  // ── 阶段 1: 构建 group 结构索引 ──
  // 使用缩进追踪：每个 .group(() => { 增加一层，每个 }) 减少一层
  // 但我们需要精确匹配 .group 的 }) 闭包和它后面的 .prefix()/.use() 链式调用

  interface GroupInfo {
    openLine: number
    closeLine: number
    prefix: string
    middleware: string[]
    /** 记录该 group 的缩进层级 */
    indentLevel: number
  }

  const groups: GroupInfo[] = []
  // 栈：每个 group 的 openLine 和缩进
  const groupStack: { idx: number; indentLevel: number }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    const indentLevel = line.search(/\S/) // 缩进空格数

    // 检测 group 开始
    if (
      trimmed.endsWith('.group(() => {') ||
      trimmed.endsWith('.group(()=>{') ||
      trimmed === '.group(() => {' ||
      trimmed === '.group(()=>{'
    ) {
      const idx = groups.length
      groups.push({ openLine: i, closeLine: -1, prefix: '', middleware: [], indentLevel })
      groupStack.push({ idx, indentLevel })
      continue
    }

    // 检测 group 闭包
    // 关键：必须按缩进层级匹配，因为 routes.ts 中同一缩进层级可以有多层嵌套 `})`
    if (trimmed === '})' && groupStack.length > 0) {
      // 从栈末尾向前扫描，找到缩进层级匹配的 group
      let matchIdx = -1
      for (let k = groupStack.length - 1; k >= 0; k--) {
        if (groupStack[k]!.indentLevel === indentLevel) {
          matchIdx = k
          break
        }
      }

      if (matchIdx === -1) {
        // 没有匹配缩进的 group — 可能是函数闭包或其他代码块的 })
        continue
      }

      const top = groupStack[matchIdx]!
      groups[top.idx]!.closeLine = i

      // 读取后续链式调用行（.prefix(), .use(), .as()）
      let j = i + 1
      while (j < lines.length) {
        const nextLine = lines[j]!
        const nextTrim = nextLine.trim()
        const nextIndent = nextLine.search(/\S/)

        // 链式调用行以 . 开头，缩进低于或等于当前行
        if (nextTrim.startsWith('.prefix(')) {
          const match = nextTrim.match(/\.prefix\s*\(\s*['"]([^'"]+)['"]/)
          if (match) groups[top.idx]!.prefix = match[1]!
        } else if (nextTrim.startsWith('.use(')) {
          const match = nextTrim.match(/\.use\s*\(\s*([^)]+)\s*\)/)
          if (match) {
            const arg = match[1]!.trim()
            const mwMatch = arg.match(/middleware\.(\w+)/)
            groups[top.idx]!.middleware.push(mwMatch ? mwMatch[1]! : arg)
          }
        } else if (nextTrim.startsWith('.as(')) {
          // group 命名，跳过
          j++
          continue
        } else {
          break
        }
        j++
      }

      // 从栈中移除匹配的 group 及其之上的所有条目
      // 这处理了嵌套 `})` 在同一缩进层级的情况
      groupStack.splice(matchIdx)
      continue
    }
  }

  // 关闭未闭合的 group
  for (const g of groupStack) {
    groups[g.idx]!.closeLine = lines.length
  }

  // ── 阶段 2: 提取路由定义并匹配组上下文 ──
  const rows: InventoryRow[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()

    // 匹配 router.get/post/... 调用
    const methodMatch = trimmed.match(/router\.(get|post|patch|put|delete|head|options)\s*\(/)
    if (!methodMatch) continue
    const method = methodMatch[1]!.toUpperCase()

    // 提取路径
    const pathMatch = trimmed.match(
      /router\.(?:get|post|patch|put|delete|head|options)\s*\(\s*['"]([^'"]+)['"]/,
    )
    if (!pathMatch) continue
    const rawPath = pathMatch[1]!

    // 提取路由名称
    const nameMatch = trimmed.match(/\.as\s*\(\s*['"]([^'"]+)['"]/)
    const routeName = nameMatch ? nameMatch[1]! : ''

    // 查找活跃组：closeLine > i 且 openLine < i
    // 按 openLine 排序以确定嵌套顺序
    const activeGroups = groups
      .filter((g) => g.openLine < i && g.closeLine > i)
      .sort((a, b) => a.openLine - b.openLine)

    // 构建完整路径（按组嵌套顺序拼接前缀）
    const groupPrefix = activeGroups
      .map((g) => g.prefix)
      .filter(Boolean)
      .join('/')

    const fullPath = groupPrefix ? `/${groupPrefix}/${rawPath.replace(/^\//, '')}` : rawPath

    // 规范化路径
    const normalizedPath = fullPath.replace(/\/+/g, '/').replace(/\/$/, '') || '/'

    // 只处理 /api/v1 路由
    if (!normalizedPath.startsWith(apiPrefix)) continue

    // OpenAPI 路径格式
    const openApiPath = normalizedPath.replace(/:(\w+)/g, '{$1}')

    // 收集中间件
    const middleware = activeGroups.flatMap((g) => g.middleware)
    const hasAuth = middleware.some((m) =>
      AUTH_MIDDLEWARE_NAMES.some((authName) => m.includes(authName)),
    )

    // 确定分类
    const whitelistMatch = WHITELIST_PREFIXES.find((w) => {
      const p = w.prefix.startsWith('/') ? w.prefix : `/${w.prefix}`
      return normalizedPath.startsWith(p)
    })

    let classification: InventoryRow['classification'] = 'auth'
    let whitelistReason = ''
    if (whitelistMatch) {
      if (
        whitelistMatch.prefix.startsWith('/dev/') ||
        whitelistMatch.prefix.startsWith('/api/v1/dev/')
      ) {
        classification = 'dev-only'
      } else {
        classification = 'whitelist'
      }
      whitelistReason = whitelistMatch.reason
    } else if (!hasAuth) {
      classification = 'public'
    }

    rows.push({
      method,
      path: normalizedPath,
      openApiPath,
      routeName,
      apiVersion: 'v1',
      classification,
      whitelistReason,
      source,
      middleware,
    })
  }

  const total = rows.length
  const whitelisted = rows.filter(
    (r) => r.classification === 'whitelist' || r.classification === 'dev-only',
  ).length

  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    source,
    total,
    whitelisted,
    rows,
  }
}

// ── 主入口 ────────────────────────────────────────────────────────────
function main(): void {
  const repoRoot = import.meta.dirname ? path.resolve(import.meta.dirname, '..') : process.cwd()
  const routesPath =
    process.env.TEST_ROUTES_PATH || path.join(repoRoot, 'apps', 'backend', 'start', 'routes.ts')

  if (!fs.existsSync(routesPath)) {
    console.error(`routes.ts 不存在: ${routesPath}`)
    process.exit(1)
  }

  const result = extractRoutesFromFile(routesPath)
  const isCompact = process.argv.includes('--compact')

  if (isCompact) {
    console.log(`\n=== 当前 /api/v1 路由盘点 ===`)
    console.log(`  总路由: ${result.total}`)
    console.log(`  白名单/开发: ${result.whitelisted}`)
    console.log(`  正式路由: ${result.total - result.whitelisted}`)
    console.log(`  生成时间: ${result.generatedAt}`)
    console.log(`  来源: ${result.source}`)
    console.log()
    for (const row of result.rows) {
      const status = row.classification === 'auth' ? '' : ` [${row.classification}]`
      console.log(
        `  ${row.method.padEnd(6)} ${row.path}${status}${row.routeName ? ' → ' + row.routeName : ''}`,
      )
    }
  } else {
    const output = {
      version: result.version,
      generatedAt: result.generatedAt,
      source: result.source,
      total: result.total,
      whitelisted: result.whitelisted,
      rows: result.rows.map((r) => ({
        method: r.method,
        path: r.path,
        openApiPath: r.openApiPath,
        routeName: r.routeName,
        apiVersion: r.apiVersion,
        classification: r.classification,
        whitelistReason: r.whitelistReason,
        source: r.source,
      })),
    }
    console.log(JSON.stringify(output, null, 2))
  }
}

if (require.main === module || process.argv[1]?.endsWith('api-route-inventory.ts')) {
  main()
}
