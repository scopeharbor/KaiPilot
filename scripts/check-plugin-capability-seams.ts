#!/usr/bin/env tsx
/**
 * check-plugin-capability-seams —— V3 插件能力接缝目录的本机只读 checker（任务 5.1/5.3/5.5）。
 *
 * 用法：
 *   pnpm check:plugin-capability-seams [-- --list] [--json] [--output <path>]
 *     [--objective <text>] [--fixture <path>]
 *
 * 语义：
 * - 默认仓库模式：读取 curated catalog（`packages/types/src/plugin-capability-seam-catalog-curated.ts`），
 *   跑 `evaluateSeamCatalog`（required family 覆盖 + known refs + evidence ref 本地存在性 +
 *   digest + 红线/matrix/freshness + 低敏扫描），产出低敏 text/JSON 报告。
 * - `--fixture <path>`：从 JSON 文件读取 entries（`{ "entries": [...] }` 或裸数组）替代
 *   curated catalog 校验（负例/敏感输入验证用；fixture 仍受全部 validator 规则约束）。
 * - `--list`：打印 curated（或 fixture）目录条目的确定性低敏摘要：seamKey / seamVersion /
 *   surface / classification / deliveryStatus / availability，按稳定排序。
 * - `--json`：stdout 输出机器可读报告（低敏，供 OpenSpec/progress 消费）。
 * - `--output <path>`：把 text/JSON 报告写到文件（默认 `.tmp/plugin-capability-seams/`）。
 * - `--objective <text>`：写入报告 observation 字段。
 * - 退出码：0 = passed/degraded（无 blocking）；1 = 存在 blocking findings；2 = 调用/输入错误。
 * - 低敏纪律：所有输出先经 `sanitizeSeamOutput` 消毒；summary 恒定模板 + 低敏 refs；
 *   不打印完整源码/规范内容；零网络、零真实 provider/OAuth/Webhook/模型调用。
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLUGIN_SEAM_CURATED_CATALOG,
  PLUGIN_SEAM_CURATED_DIGEST,
  SEAM_KNOWN_CONTRACT_REFS,
  SEAM_KNOWN_OWNER_REFS,
} from '../packages/types/src/plugin-capability-seam-catalog-curated.js'
import {
  SEAM_SURFACES,
  aggregateSeamReportStatus,
  evaluateSeamCatalog,
  normalizeSeamEntries,
  sanitizeSeamOutput,
  type PluginCapabilitySeamEntry,
  type SeamCatalogReport,
  type SeamFinding,
} from '../packages/types/src/plugin-capability-seam-catalog.js'

// =============================================================================
// 参数解析（5.1）
// =============================================================================

interface CliArgs {
  list: boolean
  json: boolean
  output?: string
  objective?: string
  fixture?: string
}

/** 参数解析结果：error 存在时表示调用错误（main 以退出码 2 结束）。 */
export function parseArgs(argv: string[]): { args: CliArgs; error?: string } {
  const args: CliArgs = { list: false, json: false }
  const clean = argv.filter((arg) => arg !== '--')
  for (let i = 0; i < clean.length; i += 1) {
    const a = clean[i]!
    switch (a) {
      case '--list':
        args.list = true
        break
      case '--json':
        args.json = true
        break
      case '--output': {
        const v = clean[++i]
        if (!v) return { args, error: '--output 需要值' }
        args.output = v
        break
      }
      case '--objective': {
        const v = clean[++i]
        if (!v) return { args, error: '--objective 需要值' }
        args.objective = v
        break
      }
      case '--fixture': {
        const v = clean[++i]
        if (!v) return { args, error: '--fixture 需要值' }
        args.fixture = v
        break
      }
      default:
        return { args, error: `未知参数: ${a}` }
    }
  }
  return { args }
}

// =============================================================================
// 环境与输入加载
// =============================================================================

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function detectCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export function repoPathExists(relPath: string): boolean {
  const absolute = resolve(REPO_ROOT, relPath.replace(/^[./]+/, ''))
  if (existsSync(absolute)) return true
  if (absolute.endsWith('.js')) {
    return (
      existsSync(absolute.replace(/\.js$/, '.ts')) || existsSync(absolute.replace(/\.js$/, '.tsx'))
    )
  }
  return false
}

/** 从 JSON fixture 文件读取 entries（`{ "entries": [...] }` 或裸数组）；非法输入抛 Error。 */
export function loadSeamFixtureEntries(path: string): PluginCapabilitySeamEntry[] {
  if (!existsSync(path)) throw new Error(`fixture 文件不存在: ${path}`)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    throw new Error(`fixture 不是合法 JSON: ${path}`)
  }
  const list = Array.isArray(raw)
    ? (raw as unknown[])
    : (raw as { entries?: unknown[] } | null)?.entries
  if (!Array.isArray(list)) throw new Error(`fixture 缺少 entries 数组: ${path}`)
  return list as PluginCapabilitySeamEntry[]
}

/** 确定性 --list 摘要（低敏；curated/fixture 通用）。 */
export function renderSeamList(entries: PluginCapabilitySeamEntry[]): string {
  const rows = normalizeSeamEntries(entries).map(
    (e) =>
      `${e.seamKey}@${e.seamVersion} family=${e.surface} class=${e.classification} status=${e.deliveryStatus} avail=${e.availability}`,
  )
  return rows.join('\n')
}

// =============================================================================
// 报告组装（5.3）
// =============================================================================

export function buildSeamCatalogReport(params: {
  changeName?: string
  objective?: string
  commit: string
  entries: PluginCapabilitySeamEntry[]
  findings: SeamFinding[]
  digest: string
  graphFreshness: 'fresh' | 'stale' | 'unknown'
  now?: Date
}): SeamCatalogReport {
  const { changeName, objective, commit, entries, findings, digest, graphFreshness, now } = params
  const generatedAt = (now ?? new Date()).toISOString()
  const prefix = changeName ? `seam-${changeName}` : 'seam'
  const reportId = `${prefix}-${generatedAt.replace(/[:.]/g, '-')}`
  const families = SEAM_SURFACES.map((family) => {
    const familyEntries = entries.filter((e) => e.surface === family)
    return {
      family,
      entryCount: familyEntries.length,
      availabilities: [...new Set(familyEntries.map((e) => e.availability))].sort(),
    }
  })
  return {
    schemaVersion: '1.0',
    reportId,
    generatedAt,
    changeName,
    commit,
    status: aggregateSeamReportStatus(findings),
    objective,
    environment: {
      platform: process.platform,
      nodeVersion: process.version,
      commit,
      graphFreshness,
    },
    catalogDigest: digest,
    entryCount: entries.length,
    families,
    findings,
    redactionSummary: { redactedCount: 0, reasons: {} },
  }
}

/** 低敏化报告（对 findings/环境做对象级 sanitize）。 */
export function sanitizeSeamReport(report: SeamCatalogReport): SeamCatalogReport {
  const { sanitized, redactedCount } = sanitizeSeamOutput(report) as {
    sanitized: SeamCatalogReport
    redactedCount: number
  }
  if (redactedCount > 0) {
    return {
      ...sanitized,
      redactionSummary: { redactedCount, reasons: {} },
    }
  }
  return sanitized
}

/**
 * 运行校验并组装报告（纯本地；默认仓库模式校验 curated catalog）。
 * 导出让 CLI 测试复用：`runSeamCheck({ fixturePath?, objective?, changeName? })`。
 */
export function runSeamCheck(options: {
  changeName?: string
  objective?: string
  fixturePath?: string
  entries?: PluginCapabilitySeamEntry[]
  commit?: string
  now?: Date
  graphFreshness?: 'fresh' | 'stale' | 'unknown'
}): { report: SeamCatalogReport; blocked: boolean; exitCode: number } {
  const commit = options.commit ?? detectCommit()
  const graphFreshness = options.graphFreshness ?? 'unknown'
  const changeName = options.changeName
  const objective = options.objective

  const fixtureEntries =
    options.entries ??
    (options.fixturePath ? loadSeamFixtureEntries(options.fixturePath) : undefined)
  const useFixture = fixtureEntries !== undefined
  const entries = useFixture ? fixtureEntries : [...PLUGIN_SEAM_CURATED_CATALOG]

  const validated = evaluateSeamCatalog(entries, {
    knownContractRefs: [...SEAM_KNOWN_CONTRACT_REFS],
    knownOwnerRefs: [...SEAM_KNOWN_OWNER_REFS],
    evidencePathResolver: useFixture ? undefined : (path: string): boolean => repoPathExists(path),
    graphAbsentWithoutFallback: false,
  })

  const digest = useFixture ? validated.digest : PLUGIN_SEAM_CURATED_DIGEST
  const report = buildSeamCatalogReport({
    changeName,
    objective,
    commit,
    entries: validated.entries,
    findings: validated.findings,
    digest,
    graphFreshness,
    now: options.now,
  })
  const sanitized = sanitizeSeamReport(report)
  const blocked = sanitized.status === 'blocked'
  return { report: sanitized, blocked, exitCode: blocked ? 1 : 0 }
}

/** 文本摘要（低敏，一行式）。 */
export function renderSeamSummary(report: SeamCatalogReport): string {
  const lines: string[] = []
  lines.push(`plugin-capability-seams report: ${report.reportId}`)
  lines.push(`status=${report.status} digest=${report.catalogDigest} entries=${report.entryCount}`)
  for (const f of report.families) {
    lines.push(`family=${f.family} entries=${f.entryCount} avail=${f.availabilities.join(',')}`)
  }
  for (const finding of report.findings) {
    lines.push(
      `[${finding.severity}] ${finding.ruleId} ${finding.code} ${finding.seamKey} ${finding.fieldPath}: ${finding.summary}`,
    )
  }
  return lines.join('\n')
}

// =============================================================================
// main
// =============================================================================

function main(argv: string[]): void {
  const { args, error } = parseArgs(argv)
  if (error) {
    console.error(`check-plugin-capability-seams: ${error}`)
    process.exit(2)
  }

  try {
    if (args.list) {
      const entries = args.fixture
        ? normalizeSeamEntries(loadSeamFixtureEntries(args.fixture))
        : normalizeSeamEntries([...PLUGIN_SEAM_CURATED_CATALOG])
      console.log(renderSeamList(entries))
      process.exit(0)
    }

    const { report, exitCode } = runSeamCheck({
      objective: args.objective,
      fixturePath: args.fixture,
    })

    const text = renderSeamSummary(report)
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(text)
    }
    if (args.output) {
      const outputPath = resolve(REPO_ROOT, args.output)
      mkdirSync(dirname(outputPath), { recursive: true })
      const content = args.json ? JSON.stringify(report, null, 2) : text
      writeFileSync(outputPath, content, 'utf8')
      console.error(`report written to ${outputPath}`)
    }
    process.exit(exitCode)
  } catch (err) {
    console.error(
      `check-plugin-capability-seams: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(2)
  }
}

// 主模块守卫：只有直接执行（pnpm/tsx 运行本文件）时才跑 main()；测试 import 时不触发。
const isDirectRun = ((): boolean => {
  try {
    if (!process.argv[1]) return false
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()
if (isDirectRun) {
  main(process.argv.slice(2))
}
