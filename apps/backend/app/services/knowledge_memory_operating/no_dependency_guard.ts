/**
 * v3-knowledge-memory-operating-layer —— 静态依赖守卫（3.2）。
 *
 * 强制 read port 不得依赖以下模块：
 * - AIGateway / 任何 AI provider
 * - fetch / http / https / Webhook / Web Push
 * - 任何 plugin runtime code / 通用 UI slot
 * - W3b / W3c 候选（worker_threads / node:vm / isolated-vm）
 *
 * 实现方式：在 `forbidden_tokens` 列表里列出禁用的导出 / 字面量 / import path，
 * 启动时 + 单测中扫描本目录所有 .ts 文件的 import / require / 引用，
 * 命中即抛错。
 *
 * @aiproj/backend
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// ── 禁用 token 列表 ──────────────────────────────────────────────────

/** 严禁 import 的 specifier 子串（按目录扫描，命中即报错）。 */
const FORBIDDEN_IMPORT_SUBSTRINGS: readonly string[] = [
  // AI gateway / provider
  'AIGateway',
  'resolveAdapter',
  'ai_connection',
  'ai_model_catalog',
  'OpenAI',
  'Anthropic',
  'Gemini',
  'Mistral',
  'DeepSeek',
  // 网络
  'node:http',
  'node:https',
  'node:fetch',
  'undici',
  'axios',
  'got',
  'node-fetch',
  // Webhook / Web Push
  'webhook',
  'web_push',
  'web-push',
  'pwa-web-push',
  'outgoing_webhook',
  'incoming_webhook',
  // 插件 runtime
  'worker_threads',
  'node:vm',
  'isolated-vm',
  'iframe_sandbox',
  'plugin-runtime',
  'plugin_server_hook',
  'plugin-action-preview',
  // 通用 UI slot
  'ui-slot',
  'ui_command_extension',
  'plugin_ui_command',
]

/** 严禁 import 的相对路径（命中即报错，防止误引）。 */
const FORBIDDEN_RELATIVE_PATHS: readonly string[] = [
  'app/services/ai_m0',
  'app/services/ai_draft',
  'app/services/ai_evaluation',
  'app/services/ai_security',
  'app/services/integration',
  'app/services/copilot/turn',
  'app/services/copilot/routing',
  'app/services/copilot/agent',
  'app/services/outgoing_webhook',
  'app/services/incoming_webhook',
  'app/services/pwa_web_push',
  'app/services/transport_health',
]

/** 严禁出现在 source 里的字面量（防止动态加载或字符串拼接）。 */
const FORBIDDEN_LITERALS: readonly string[] = [
  'fetch(',
  'require(',
  'new OpenAI',
  'new Anthropic',
  'new Worker(',
  'new WorkerThreads',
  'isolated-vm',
  'iframe sandbox',
  'webhook delivery',
  'outgoing webhook',
  'incoming webhook',
  'AIGateway',
  'resolveAdapter',
  '/api/v2',
]

/** 允许的依赖（白名单），白名单外的依赖不得引入。 */
const ALLOWED_DEPENDENCIES: readonly string[] = [
  '@adonisjs/core',
  '@adonisjs/lucid',
  '@aiproj/types',
  'luxon',
  '#models/',
  '#services/knowledge/',
  '#services/compiler/skills/',
  '#services/copilot_memory/',
  '#services/audit_service',
  '#services/auth_service',
  '#services/feature_flags',
  './',
  '../',
]

// ── 扫描入口 ────────────────────────────────────────────────────────

export interface OperatingDependencyScanResult {
  readonly scannedFiles: number
  readonly violations: readonly {
    file: string
    line: number
    snippet: string
    category: 'import' | 'path' | 'literal' | 'dependency'
    matched: string
  }[]
}

/**
 * 扫描指定目录下所有 .ts 文件，报告 forbidden 命中。
 * 适用于 CI / 单元测试中调用以静态保证 port 不引入禁依赖。
 */
export function scanOperatingPortDependencies(rootDir: string): OperatingDependencyScanResult {
  const absRoot = resolve(rootDir)
  const files = walkTs(absRoot)
  const violations: OperatingDependencyScanResult['violations'][number][] = []
  for (const file of files) {
    const rel = relative(absRoot, file)
    const raw = readFileSync(file, 'utf8')
    const text = stripComments(raw)
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      const lineNo = i + 1
      // 1. 相对路径命中
      for (const forbidden of FORBIDDEN_RELATIVE_PATHS) {
        if (line.includes(`'${forbidden}`) || line.includes(`"${forbidden}`)) {
          violations.push({
            file: rel,
            line: lineNo,
            snippet: line.trim().slice(0, 200),
            category: 'path',
            matched: forbidden,
          })
        }
      }
      // 2. import substring 命中
      for (const token of FORBIDDEN_IMPORT_SUBSTRINGS) {
        if (line.includes(token)) {
          violations.push({
            file: rel,
            line: lineNo,
            snippet: line.trim().slice(0, 200),
            category: 'import',
            matched: token,
          })
        }
      }
      // 3. 字面量命中（兜底）
      for (const literal of FORBIDDEN_LITERALS) {
        if (line.includes(literal)) {
          violations.push({
            file: rel,
            line: lineNo,
            snippet: line.trim().slice(0, 200),
            category: 'literal',
            matched: literal,
          })
        }
      }
    })
  }
  return { scannedFiles: files.length, violations }
}

/** 抛出版本（用于启动时 fail-closed 检查）。 */
export function assertNoOperatingPortForbiddenDependency(rootDir: string): void {
  const r = scanOperatingPortDependencies(rootDir)
  if (r.violations.length > 0) {
    const sample = r.violations
      .slice(0, 5)
      .map((v) => `  ${v.file}:${v.line} [${v.category}=${v.matched}] ${v.snippet}`)
      .join('\n')
    throw new Error(
      `Operating port forbidden dependency detected (${r.violations.length} hits in ${r.scannedFiles} files):\n${sample}`,
    )
  }
}

/** 提取文件中的所有 import 路径，用于白名单校验（best-effort，扫描 `import ... from` 与 `import(...)`）。 */
export function extractImportSpecifiers(text: string): readonly string[] {
  const out = new Set<string>()
  const re = /import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g
  const reDyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.add(m[1]!)
  while ((m = reDyn.exec(text))) out.add(m[1]!)
  return Array.from(out)
}

/** 检查 import 是否在白名单内。 */
export function isImportAllowed(specifier: string): boolean {
  return ALLOWED_DEPENDENCIES.some((allow) => specifier.startsWith(allow))
}

// ── 内部 ────────────────────────────────────────────────────────────

function walkTs(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    // 跳过扫描器自身——它必然包含禁依赖字面量（用于检测）
    if (name === 'no_dependency_guard.ts') continue
    const p = join(dir, name)
    let stat
    try {
      stat = statSync(p)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__' || name === 'tests') continue
      out.push(...walkTs(p))
    } else if (stat.isFile()) {
      if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.spec.ts')) {
        out.push(p)
      }
    }
  }
  return out
}

/** 去掉块注释与行注释，避免注释中的示例代码影响扫描。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}
