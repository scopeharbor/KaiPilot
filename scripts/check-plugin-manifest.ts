#!/usr/bin/env tsx
/**
 * check-plugin-manifest —— V3 plugin manifest 的本机只读 checker（任务 7.3~7.6）。
 *
 * 用法：
 *   pnpm check:plugin-manifest [-- --json] [--output <path>] [--manifest <path>] [--fixture <path>]
 *     [--objective <text>] [--catalog-snapshot <path>]
 *
 * 语义：
 * - 默认模式：读取 curated valid/invalid manifest fixtures，跑 validateManifestShape 校验，
 *   产出低敏 text/JSON 报告。
 * - `--manifest <path>`：从 JSON 文件读取单个 manifest 替代 fixtures 校验。
 * - `--fixture <path>`：从 JSON 文件读取 `{ "manifests": [...] }` 或裸数组替代默认 fixtures。
 * - `--catalog-snapshot <path>`：从 JSON 文件读取 catalog snapshot 做 contextual validation。
 * - `--json`：stdout 输出机器可读报告（低敏）。
 * - `--output <path>`：把报告写到文件（默认 `.tmp/plugin-manifest/`）。
 * - `--objective <text>`：写入报告 observation 字段。
 * - 退出码：0 = passed；1 = blocking findings；2 = 调用/输入错误。
 * - 低敏纪律：所有输出先经 redactFinding/deepRedact 消毒；零网络、零真实 provider 调用。
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MANIFEST_CHECKER_EXIT,
  MANIFEST_FINDING_CODES,
  MANIFEST_REDLINE_CODES,
  computeManifestDigest,
  normalizeManifest,
  redactFinding,
  validateManifest,
  validateManifestShape,
  type ManifestFindingCode,
  type ManifestSeverity,
  type PluginManifestFinding,
  type PluginManifestV1,
  type PluginManifestValidationContext,
  type PluginManifestValidationResult,
} from '../packages/types/src/plugin-manifest.js'

// =============================================================================
// 参数解析
// =============================================================================

interface CliArgs {
  json: boolean
  output?: string
  manifest?: string
  fixture?: string
  objective?: string
  catalogSnapshot?: string
}

export function parseArgs(argv: string[]): { args: CliArgs; error?: string } {
  const args: CliArgs = { json: false }
  const clean = argv.filter((arg) => arg !== '--')
  for (let i = 0; i < clean.length; i += 1) {
    const a = clean[i]!
    switch (a) {
      case '--json':
        args.json = true
        break
      case '--output': {
        const v = clean[++i]
        if (!v) return { args, error: '--output 需要值' }
        args.output = v
        break
      }
      case '--manifest': {
        const v = clean[++i]
        if (!v) return { args, error: '--manifest 需要值' }
        args.manifest = v
        break
      }
      case '--fixture': {
        const v = clean[++i]
        if (!v) return { args, error: '--fixture 需要值' }
        args.fixture = v
        break
      }
      case '--objective': {
        const v = clean[++i]
        if (!v) return { args, error: '--objective 需要值' }
        args.objective = v
        break
      }
      case '--catalog-snapshot': {
        const v = clean[++i]
        if (!v) return { args, error: '--catalog-snapshot 需要值' }
        args.catalogSnapshot = v
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

function loadJsonFile(path: string): unknown {
  if (!existsSync(path)) throw new Error(`文件不存在: ${path}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    throw new Error(`文件不是合法 JSON: ${path}`)
  }
}

function loadManifest(path: string): PluginManifestV1 {
  const raw = loadJsonFile(path)
  if (!raw || typeof raw !== 'object') throw new Error(`manifest 不是对象: ${path}`)
  return raw as PluginManifestV1
}

function loadManifests(path: string): PluginManifestV1[] {
  const raw = loadJsonFile(path)
  if (Array.isArray(raw)) return raw as PluginManifestV1[]
  const obj = raw as Record<string, unknown>
  if (Array.isArray(obj.manifests)) return obj.manifests as PluginManifestV1[]
  throw new Error(`fixture 缺少 manifests 数组: ${path}`)
}

function loadCatalogSnapshot(path: string): PluginManifestValidationContext | undefined {
  if (!path) return undefined
  const raw = loadJsonFile(path) as PluginManifestValidationContext
  return raw
}

// =============================================================================
// Report types
// =============================================================================

interface ManifestCheckReport {
  reportId: string
  changeName?: string
  objective?: string
  generatedAt: string
  commit: string
  manifestCount: number
  validCount: number
  invalidCount: number
  totalFindings: number
  blockingCount: number
  warningCount: number
  infoCount: number
  findings: PluginManifestFinding[]
  digestStable: boolean
  redactionVerified: boolean
  exitCode: number
}

// =============================================================================
// Checker core
// =============================================================================

function runChecker(params: {
  manifests: PluginManifestV1[]
  context?: PluginManifestValidationContext
  objective?: string
}): ManifestCheckReport {
  const { manifests, context, objective } = params
  const commit = detectCommit()
  const generatedAt = new Date().toISOString()
  const reportId = `manifest-check-${generatedAt.replace(/[:.]/g, '-')}`

  const allFindings: PluginManifestFinding[] = []
  let validCount = 0

  for (const manifest of manifests) {
    let result: PluginManifestValidationResult
    if (context) {
      result = validateManifest(manifest, context)
    } else {
      const shapeResult = validateManifestShape(manifest)
      result = {
        valid: shapeResult.valid,
        findings: shapeResult.findings,
        normalizedManifest: shapeResult.manifest,
        manifestDigest: shapeResult.manifest
          ? computeManifestDigest(shapeResult.manifest)
          : undefined,
      }
    }
    allFindings.push(...result.findings.map(redactFinding))
    if (result.valid) validCount++
  }

  const blockingCount = allFindings.filter((f) => f.severity === 'blocking').length
  const warningCount = allFindings.filter((f) => f.severity === 'warning').length
  const infoCount = allFindings.filter((f) => f.severity === 'info').length

  // 验证 digest 稳定性
  let digestStable = true
  if (manifests.length > 0 && manifests[0]) {
    const d1 = computeManifestDigest(manifests[0])
    const d2 = computeManifestDigest(manifests[0])
    if (d1 !== d2) digestStable = false
  }

  // 验证 redaction
  let redactionVerified = true
  const sensitiveValues = ['sk_abc123456789012345678', 'Bearer eyJhbG']
  for (const sv of sensitiveValues) {
    const finding: PluginManifestFinding = {
      code: 'manifest-schema-invalid',
      severity: 'blocking',
      evidenceRef: sv,
    }
    const redacted = redactFinding(finding)
    if (redacted.evidenceRef === sv) {
      redactionVerified = false
      break
    }
  }

  const exitCode = blockingCount > 0 ? MANIFEST_CHECKER_EXIT.blocking : MANIFEST_CHECKER_EXIT.pass

  return {
    reportId,
    objective,
    generatedAt,
    commit,
    manifestCount: manifests.length,
    validCount,
    invalidCount: manifests.length - validCount,
    totalFindings: allFindings.length,
    blockingCount,
    warningCount,
    infoCount,
    findings: allFindings,
    digestStable,
    redactionVerified,
    exitCode,
  }
}

// =============================================================================
// Output formatting
// =============================================================================

function renderTextReport(report: ManifestCheckReport): string {
  const lines: string[] = [
    `Plugin Manifest Checker Report`,
    `═══════════════════════════════════════════`,
    `Report ID:    ${report.reportId}`,
    `Generated:    ${report.generatedAt}`,
    `Commit:       ${report.commit}`,
    `Objective:    ${report.objective ?? '(none)'}`,
    ``,
    `── Summary ──`,
    `  Manifests:  ${report.manifestCount} total, ${report.validCount} valid, ${report.invalidCount} invalid`,
    `  Findings:   ${report.totalFindings} total, ${report.blockingCount} blocking, ${report.warningCount} warning, ${report.infoCount} info`,
    `  Digest:     ${report.digestStable ? 'stable' : 'UNSTABLE'}`,
    `  Redaction:  ${report.redactionVerified ? 'verified' : 'FAILED'}`,
    ``,
  ]

  if (report.blockingCount > 0) {
    lines.push(`── Blocking Findings ──`)
    for (const f of report.findings.filter((f) => f.severity === 'blocking')) {
      lines.push(`  [${f.code}] ${f.path ?? ''} ${f.key ? `key=${f.key}` : ''}`)
    }
    lines.push(``)
  }

  if (report.warningCount > 0) {
    lines.push(`── Warnings ──`)
    for (const f of report.findings.filter((f) => f.severity === 'warning')) {
      lines.push(`  [${f.code}] ${f.path ?? ''} ${f.key ? `key=${f.key}` : ''}`)
    }
    lines.push(``)
  }

  lines.push(
    `Exit code: ${report.exitCode} (${report.exitCode === 0 ? 'PASS' : report.exitCode === 1 ? 'BLOCKING' : 'TOOL ERROR'})`,
  )
  return lines.join('\n')
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const { args, error } = parseArgs(process.argv.slice(2))
  if (error) {
    console.error(`错误: ${error}`)
    process.exit(MANIFEST_CHECKER_EXIT.toolError)
  }

  try {
    let manifests: PluginManifestV1[] = []

    if (args.manifest) {
      manifests = [loadManifest(resolve(REPO_ROOT, args.manifest))]
    } else if (args.fixture) {
      manifests = loadManifests(resolve(REPO_ROOT, args.fixture))
    } else {
      // 加载默认 fixtures（valid + invalid）
      const {
        VALID_MANIFEST_MINIMAL,
        VALID_MANIFEST_FULL,
        INVALID_MANIFEST_UNKNOWN_SCHEMA,
        INVALID_MANIFEST_BAD_PLUGIN_ID,
        INVALID_MANIFEST_BAD_SEMVER,
        INVALID_MANIFEST_PUBLIC_DISTRIBUTION,
        INVALID_MANIFEST_UNKNOWN_SEAM,
        INVALID_MANIFEST_DUPLICATE_CONTRIBUTION,
        INVALID_MANIFEST_GLOBAL_SCOPE,
        INVALID_MANIFEST_ORG_ID_LEAK,
        INVALID_MANIFEST_TRAVERSAL,
        INVALID_MANIFEST_SELF_DEPENDENCY,
        INVALID_MANIFEST_DUPLICATE_DEP,
        INVALID_MANIFEST_URL_DEP,
        INVALID_MANIFEST_RAW_SECRET,
        INVALID_MANIFEST_MULTI_ERROR,
      } = await import('../packages/types/src/plugin-manifest-fixtures.js')
      manifests = [
        VALID_MANIFEST_MINIMAL,
        VALID_MANIFEST_FULL,
        INVALID_MANIFEST_UNKNOWN_SCHEMA,
        INVALID_MANIFEST_BAD_PLUGIN_ID,
        INVALID_MANIFEST_BAD_SEMVER,
        INVALID_MANIFEST_PUBLIC_DISTRIBUTION,
        INVALID_MANIFEST_UNKNOWN_SEAM,
        INVALID_MANIFEST_DUPLICATE_CONTRIBUTION,
        INVALID_MANIFEST_GLOBAL_SCOPE,
        INVALID_MANIFEST_ORG_ID_LEAK,
        INVALID_MANIFEST_TRAVERSAL,
        INVALID_MANIFEST_SELF_DEPENDENCY,
        INVALID_MANIFEST_DUPLICATE_DEP,
        INVALID_MANIFEST_URL_DEP,
        INVALID_MANIFEST_RAW_SECRET,
        INVALID_MANIFEST_MULTI_ERROR,
      ]
    }

    const context = args.catalogSnapshot
      ? loadCatalogSnapshot(resolve(REPO_ROOT, args.catalogSnapshot))
      : undefined

    const report = runChecker({ manifests, context, objective: args.objective })

    if (args.json) {
      const jsonOutput = JSON.stringify(report, null, 2)
      if (args.output) {
        const dir = dirname(resolve(REPO_ROOT, args.output))
        mkdirSync(dir, { recursive: true })
        writeFileSync(resolve(REPO_ROOT, args.output), jsonOutput, 'utf8')
        console.log(`JSON report written to ${args.output}`)
      } else {
        console.log(jsonOutput)
      }
    } else {
      const textOutput = renderTextReport(report)
      if (args.output) {
        const dir = dirname(resolve(REPO_ROOT, args.output))
        mkdirSync(dir, { recursive: true })
        writeFileSync(resolve(REPO_ROOT, args.output), textOutput, 'utf8')
        console.log(`Text report written to ${args.output}`)
      } else {
        console.log(textOutput)
      }
    }

    process.exit(report.exitCode)
  } catch (e) {
    console.error(`工具错误: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(MANIFEST_CHECKER_EXIT.toolError)
  }
}

main()
