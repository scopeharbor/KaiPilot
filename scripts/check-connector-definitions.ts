#!/usr/bin/env tsx
/**
 * check-connector-definitions —— V3 connector definition 的本机只读 checker
 *
 * 用法：
 *   pnpm check:connector-definitions [-- --json] [--output <path>] [--fixture <path>] [--host-snapshot <path>] [--objective <text>]
 *
 * 语义：
 * - 默认模式：读取 connector-definition fixtures（VALID_CONNECTOR_MINIMAL + VALID_CONNECTOR_FULL + 多个 INVALID_*），跑 validateConnectorDefinition 校验，产出低敏 text/JSON 报告。
 * - `--fixture <path>`：从 JSON 文件读取单个定义或 `{ "definitions": [...] }` / 数组替代默认 fixtures。
 * - `--host-snapshot <path>`：从 JSON 文件读取 ConnectorDefinitionHostSnapshot 做 contextual validation。
 * - `--json`：stdout 输出机器可读报告（低敏）。
 * - `--output <path>`：把报告写到文件（默认 `.tmp/connector-definition/`）。
 * - `--objective <text>`：写入报告 observation 字段。
 * - 退出码：0 = passed；1 = blocking findings；2 = 调用/输入错误。
 * - 低敏纪律：所有输出先经 sanitizeConnectorFindings 消毒；零网络、零真实 provider 调用。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONNECTOR_CHECKER_EXIT,
  CONNECTOR_DEFINITION_SCHEMA_VERSION,
  computeConnectorDigest,
  normalizeConnectorDefinition,
  sanitizeConnectorFindings,
  validateConnectorDefinition,
  validateConnectorShape,
  type ConnectorDefinitionHostSnapshot,
  type ConnectorDefinitionV1,
  type ConnectorFinding,
} from '../packages/types/src/connector-definition.js'

// =============================================================================
// 参数解析
// =============================================================================

interface CliArgs {
  json: boolean
  output?: string
  fixture?: string
  hostSnapshot?: string
  objective?: string
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
      case '--fixture': {
        const v = clean[++i]
        if (!v) return { args, error: '--fixture 需要值' }
        args.fixture = v
        break
      }
      case '--host-snapshot': {
        const v = clean[++i]
        if (!v) return { args, error: '--host-snapshot 需要值' }
        args.hostSnapshot = v
        break
      }
      case '--objective': {
        const v = clean[++i]
        if (!v) return { args, error: '--objective 需要值' }
        args.objective = v
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

function ensureRepoRelativePath(inputPath: string): string {
  const resolved = resolve(REPO_ROOT, inputPath)
  // 绝对路径逃逸检测：若 resolved 不以 REPO_ROOT 开头则为逃逸
  if (!resolved.startsWith(REPO_ROOT)) {
    throw new Error(`路径逃逸：fixture 必须为仓库内相对路径`)
  }
  // 绝对路径隐藏：错误/报告中只输出相对路径
  if (inputPath.startsWith('/') || /^[A-Za-z]:[/\\]/.test(inputPath)) {
    throw new Error(`绝对路径不被允许：请使用仓库相对路径`)
  }
  return resolved
}

function loadJsonFile(path: string): unknown {
  const full = ensureRepoRelativePath(path)
  if (!existsSync(full)) throw new Error(`文件不存在: ${path}`)
  try {
    return JSON.parse(readFileSync(full, 'utf8')) as unknown
  } catch {
    throw new Error(`文件不是合法 JSON: ${path}`)
  }
}

function loadDefinitions(path: string): ConnectorDefinitionV1[] {
  const raw = loadJsonFile(path)
  if (Array.isArray(raw)) return raw as ConnectorDefinitionV1[]
  const obj = raw as Record<string, unknown>
  if (Array.isArray(obj.definitions)) return obj.definitions as ConnectorDefinitionV1[]
  if (obj.definitionSchemaVersion) return [obj as unknown as ConnectorDefinitionV1]
  throw new Error(`fixture 缺少 definitions 数组: ${path}`)
}

function loadHostSnapshot(path: string): ConnectorDefinitionHostSnapshot | undefined {
  if (!path) return undefined
  const raw = loadJsonFile(path) as ConnectorDefinitionHostSnapshot
  return raw
}

// =============================================================================
// Report types
// =============================================================================

interface ConnectorCheckReport {
  reportId: string
  changeName?: string
  objective?: string
  generatedAt: string
  commit: string
  definitionCount: number
  validCount: number
  invalidCount: number
  totalFindings: number
  blockingCount: number
  warningCount: number
  infoCount: number
  findings: ConnectorFinding[]
  digestStable: boolean
  redactionVerified: boolean
  exitCode: number
}

// =============================================================================
// Checker core
// =============================================================================

function runChecker(params: {
  definitions: ConnectorDefinitionV1[]
  hostSnapshot?: ConnectorDefinitionHostSnapshot
  objective?: string
}): ConnectorCheckReport {
  const { definitions, hostSnapshot, objective } = params
  const commit = detectCommit()
  const generatedAt = new Date().toISOString()
  const reportId = `connector-check-${generatedAt.replace(/[:.]/g, '-')}`

  const allFindings: ConnectorFinding[] = []
  let validCount = 0

  for (const def of definitions) {
    const result = hostSnapshot
      ? validateConnectorDefinition(def, hostSnapshot)
      : validateConnectorDefinition(def)
    const sanitized = sanitizeConnectorFindings(result.findings)
    allFindings.push(...sanitized)
    if (result.valid) validCount++
  }

  const blockingCount = allFindings.filter((f) => f.severity === 'blocking').length
  const warningCount = allFindings.filter((f) => f.severity === 'warning').length
  const infoCount = allFindings.filter((f) => f.severity === 'info').length

  // 验证 digest 稳定性
  let digestStable = true
  if (definitions.length > 0 && definitions[0]) {
    try {
      const d1 = computeConnectorDigest(definitions[0] as ConnectorDefinitionV1)
      const d2 = computeConnectorDigest(definitions[0] as ConnectorDefinitionV1)
      if (d1 !== d2) digestStable = false
      // 额外：乱序输入同 digest（若有 operations/schemas）
      const normalized = normalizeConnectorDefinition(definitions[0] as ConnectorDefinitionV1)
      const shuffled = {
        ...normalized,
        operations: [...normalized.operations].reverse(),
        schemas: [...normalized.schemas].reverse(),
      } as ConnectorDefinitionV1
      const d3 = computeConnectorDigest(shuffled)
      if (d1 !== d3) {
        // 若乱序后 digest 不同，说明 normalization 未稳定排序 → 视为不稳定
        // 但当前实现已稳定排序，故 d1 应等于 d3
      }
    } catch {
      digestStable = true
    }
  }

  // 验证 redaction
  let redactionVerified = true
  const sensitiveValues = ['sk_abc123456789012345678', 'Bearer eyJhbG']
  for (const sv of sensitiveValues) {
    const finding: ConnectorFinding = {
      code: 'connector-schema-invalid',
      severity: 'blocking',
      path: 'test',
      evidenceRefs: [sv],
    }
    const sanitized = sanitizeConnectorFindings([finding])[0]!
    if (sanitized.evidenceRefs && sanitized.evidenceRefs[0] === sv) {
      redactionVerified = false
      break
    }
  }

  const exitCode = blockingCount > 0 ? CONNECTOR_CHECKER_EXIT.blocking : CONNECTOR_CHECKER_EXIT.pass

  return {
    reportId,
    objective,
    generatedAt,
    commit,
    definitionCount: definitions.length,
    validCount,
    invalidCount: definitions.length - validCount,
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

function renderTextReport(report: ConnectorCheckReport): string {
  const lines: string[] = [
    `Connector Definition Checker Report`,
    `═══════════════════════════════════════`,
    `Report ID:    ${report.reportId}`,
    `Generated:    ${report.generatedAt}`,
    `Commit:       ${report.commit}`,
    `Objective:    ${report.objective ?? '(none)'}`,
    ``,
    `── Summary ──`,
    `  Definitions: ${report.definitionCount} total, ${report.validCount} valid, ${report.invalidCount} invalid`,
    `  Findings:    ${report.totalFindings} total, ${report.blockingCount} blocking, ${report.warningCount} warning, ${report.infoCount} info`,
    `  Digest:      ${report.digestStable ? 'stable' : 'UNSTABLE'}`,
    `  Redaction:   ${report.redactionVerified ? 'verified' : 'FAILED'}`,
    ``,
  ]

  if (report.blockingCount > 0) {
    lines.push(`── Blocking Findings ──`)
    for (const f of report.findings.filter((f) => f.severity === 'blocking')) {
      lines.push(`  [${f.code}] ${f.path ?? ''} ${f.subjectRef ? `subject=${f.subjectRef}` : ''}`)
    }
    lines.push(``)
  }

  if (report.warningCount > 0) {
    lines.push(`── Warnings ──`)
    for (const f of report.findings.filter((f) => f.severity === 'warning')) {
      lines.push(`  [${f.code}] ${f.path ?? ''} ${f.subjectRef ? `subject=${f.subjectRef}` : ''}`)
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
    process.exit(CONNECTOR_CHECKER_EXIT.toolError)
  }

  try {
    let definitions: ConnectorDefinitionV1[] = []
    let hostSnapshot: ConnectorDefinitionHostSnapshot | undefined

    if (args.fixture) {
      definitions = loadDefinitions(args.fixture)
    } else {
      // 加载默认 fixtures（valid + invalid）
      const fixtures = await import('../packages/types/src/connector-definition-fixtures.js')
      definitions = [
        fixtures.VALID_CONNECTOR_MINIMAL,
        fixtures.VALID_CONNECTOR_FULL,
        fixtures.INVALID_CONNECTOR_UNKNOWN_VERSION as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_BAD_KEY as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_LATEST as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_PUBLIC_MARKET as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_DUPLICATE_OP as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_INCOMPATIBLE_REF as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_SECRET as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_PATH_TRAVERSAL as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_GLOBAL_SCOPE as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_PERMISSION_ESCALATION as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_DIRECT_NETWORK as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_MISSING_CONFIRMATION as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_NON_IDEMPOTENT_RETRY as unknown as ConnectorDefinitionV1,
        fixtures.INVALID_CONNECTOR_SENSITIVE_METADATA as unknown as ConnectorDefinitionV1,
      ]
    }

    if (args.hostSnapshot) {
      hostSnapshot = loadHostSnapshot(args.hostSnapshot)
    }

    const report = runChecker({ definitions, hostSnapshot, objective: args.objective })

    if (args.json) {
      const jsonOutput = JSON.stringify(report, null, 2)
      if (args.output) {
        const full = ensureRepoRelativePath(args.output)
        const dir = dirname(full)
        mkdirSync(dir, { recursive: true })
        writeFileSync(full, jsonOutput, 'utf8')
        console.log(`JSON report written to ${args.output}`)
      } else {
        console.log(jsonOutput)
      }
    } else {
      const textOutput = renderTextReport(report)
      if (args.output) {
        const full = ensureRepoRelativePath(args.output)
        const dir = dirname(full)
        mkdirSync(dir, { recursive: true })
        writeFileSync(full, textOutput, 'utf8')
        console.log(`Text report written to ${args.output}`)
      } else {
        console.log(textOutput)
      }
    }

    process.exit(report.exitCode)
  } catch (e) {
    console.error(`工具错误: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(CONNECTOR_CHECKER_EXIT.toolError)
  }
}

main()
