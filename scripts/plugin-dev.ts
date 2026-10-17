#!/usr/bin/env tsx
/**
 * plugin-dev —— V3 本机插件开发套件统一 CLI（W5b）
 *
 * 用法：
 *   pnpm plugin:dev -- validate --plugin <repo-relative-dir> [--format text|json]
 *   pnpm plugin:dev -- install-dry-run --plugin <repo-relative-dir> --profile <repo-relative-json> --action <install|enable|disable|uninstall|upgrade> [--format text|json]
 *   pnpm plugin:dev -- audit-summary --input <repo-relative-json> [--format text|json]
 *
 * 语义：
 * - 单一薄适配层：参数解析 → 受限文件读取 → 调用纯函数 → 渲染 text/JSON → 设置退出码。
 * - 显式仓库相对路径，经 lexical + realpath 双重边界；只读取 allowlist 文件；单文件/总字节/文件数/ findings 有界。
 * - 复用 manifest / seam / contribution 唯一事实来源；dry-run 复用安装状态机纯函数，零 DB/handle/grant/审计写入。
 * - 统一 envelope：local-plugin-dev-report-v1 / local-plugin-host-profile-v1 / local-plugin-install-plan-v1；warning-only 返回 0；退出码 0/1/2。
 * - 低敏：所有输出经 allowlist redaction + 二次扫描；禁止回显 secret/token/URL/绝对路径/stack/原始 manifest。
 * - 零副作用：默认只写 stdout/stderr；不访问网络/DB/模型/provider/插件执行；测试可用 fail-fast spy 证明计数为零。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LOCAL_PLUGIN_ALLOWED_FILES,
  LOCAL_PLUGIN_DEV_BUDGETS,
  LOCAL_PLUGIN_DEV_EXIT,
  LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION,
  LOCAL_PLUGIN_HOST_PROFILE_SCHEMA_VERSION,
  buildLocalInstallDryRun,
  computeDevDigest,
  devDeepRedact,
  devSecondaryScan,
  devStableSerialize,
  devStatusToExitCode,
  isLocalPluginDevCommand,
  isLocalPluginDevFormat,
  isLocalPluginInstallDryRunAction,
  isRepoRelativePathSafe,
  mapToolError,
  normalizeDevReport,
  redactDevFinding,
  sortDevFindings,
  summarizeLocalPluginDiagnostics,
  validateHostProfile,
  validateLocalPlugin,
  type LocalPluginDevCommand,
  type LocalPluginDevFinding,
  type LocalPluginDevFormat,
  type LocalPluginDevReport,
  type LocalPluginHostProfileV1,
} from '../packages/types/src/local-plugin-developer-kit.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function detectCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

// =============================================================================
// 参数解析（封闭）
// =============================================================================

interface ValidateArgs {
  command: 'validate'
  plugin: string
  format: LocalPluginDevFormat
}
interface InstallDryRunArgs {
  command: 'install-dry-run'
  plugin: string
  profile: string
  action: string
  format: LocalPluginDevFormat
}
interface AuditSummaryArgs {
  command: 'audit-summary'
  input: string
  format: LocalPluginDevFormat
}
type ParsedArgs = ValidateArgs | InstallDryRunArgs | AuditSummaryArgs

export function parsePluginDevArgs(argv: string[]): { args?: ParsedArgs; error?: string } {
  const clean = argv.filter((a) => a !== '--')
  if (clean.length === 0)
    return { error: '缺少子命令（validate | install-dry-run | audit-summary）' }
  const command = clean[0]!
  if (!isLocalPluginDevCommand(command)) return { error: `未知子命令: ${command}` }

  if (command === 'validate') {
    const result: Partial<ValidateArgs> = { command, format: 'text' as LocalPluginDevFormat }
    for (let i = 1; i < clean.length; i++) {
      const a = clean[i]!
      if (a === '--plugin') {
        const v = clean[++i]
        if (!v) return { error: '--plugin 需要值' }
        result.plugin = v
      } else if (a === '--format') {
        const v = clean[++i]
        if (!v || !isLocalPluginDevFormat(v)) return { error: '--format 必须为 text|json' }
        result.format = v
      } else {
        return { error: `未知参数: ${a}` }
      }
    }
    if (!result.plugin) return { error: 'validate 需要 --plugin <repo-relative-dir>' }
    return { args: result as ValidateArgs }
  }

  if (command === 'install-dry-run') {
    const result: Partial<InstallDryRunArgs> = { command, format: 'text' as LocalPluginDevFormat }
    for (let i = 1; i < clean.length; i++) {
      const a = clean[i]!
      if (a === '--plugin') {
        const v = clean[++i]
        if (!v) return { error: '--plugin 需要值' }
        result.plugin = v
      } else if (a === '--profile') {
        const v = clean[++i]
        if (!v) return { error: '--profile 需要值' }
        result.profile = v
      } else if (a === '--action') {
        const v = clean[++i]
        if (!v) return { error: '--action 需要值' }
        result.action = v
      } else if (a === '--format') {
        const v = clean[++i]
        if (!v || !isLocalPluginDevFormat(v)) return { error: '--format 必须为 text|json' }
        result.format = v
      } else {
        return { error: `未知参数: ${a}` }
      }
    }
    if (!result.plugin) return { error: 'install-dry-run 需要 --plugin <repo-relative-dir>' }
    if (!result.profile) return { error: 'install-dry-run 需要 --profile <repo-relative-json>' }
    if (!result.action)
      return { error: 'install-dry-run 需要 --action <install|enable|disable|uninstall|upgrade>' }
    if (!isLocalPluginInstallDryRunAction(result.action))
      return { error: `--action 非法: ${result.action}` }
    return { args: result as InstallDryRunArgs }
  }

  // audit-summary
  const result: Partial<AuditSummaryArgs> = { command, format: 'text' as LocalPluginDevFormat }
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i]!
    if (a === '--input') {
      const v = clean[++i]
      if (!v) return { error: '--input 需要值' }
      result.input = v
    } else if (a === '--format') {
      const v = clean[++i]
      if (!v || !isLocalPluginDevFormat(v)) return { error: '--format 必须为 text|json' }
      result.format = v
    } else {
      return { error: `未知参数: ${a}` }
    }
  }
  if (!result.input) return { error: 'audit-summary 需要 --input <repo-relative-json>' }
  return { args: result as AuditSummaryArgs }
}

// =============================================================================
// 受限文件读取（显式插件根 + allowlist + 双重边界 + 预算）
// =============================================================================

function lexicalAndRealpathCheck(
  repoRoot: string,
  requested: string,
  pluginRootAbs: string,
): { ok: boolean; finding?: LocalPluginDevFinding; abs?: string } {
  const safe = isRepoRelativePathSafe(requested)
  if (!safe.valid) {
    const mapping: Record<string, LocalPluginDevFinding['code']> = {
      'dev-tool-missing-input': 'dev-tool-missing-input',
      'dev-tool-path-url': 'dev-tool-path-url',
      'dev-tool-path-absolute': 'dev-tool-path-absolute',
      'dev-tool-path-traversal': 'dev-tool-path-traversal',
      'dev-tool-path-control-char': 'dev-tool-path-control-char',
    }
    const code = mapping[safe.reason ?? 'dev-tool-path-traversal'] ?? 'dev-tool-path-traversal'
    return {
      ok: false,
      finding: {
        code,
        severity: 'blocking',
        phase: 'input',
        fieldPath: '$.plugin',
        message: `路径被拒绝: ${requested}`,
      },
    }
  }
  const lexicalAbs = resolve(repoRoot, requested)
  // lexical boundary: must be inside repo
  const relToRepo = relative(repoRoot, lexicalAbs)
  if (relToRepo.startsWith('..')) {
    return {
      ok: false,
      finding: {
        code: 'dev-tool-path-escape',
        severity: 'blocking',
        phase: 'input',
        fieldPath: '$.plugin',
        message: '路径越界',
      },
    }
  }
  // realpath boundary
  let real: string
  try {
    real = realpathSync(lexicalAbs)
  } catch {
    return {
      ok: false,
      finding: {
        code: 'dev-tool-read-error',
        severity: 'blocking',
        phase: 'input',
        fieldPath: '$.plugin',
        message: '无法解析路径',
      },
    }
  }
  const relReal = relative(repoRoot, real)
  if (relReal.startsWith('..')) {
    return {
      ok: false,
      finding: {
        code: 'dev-tool-path-symlink-escape',
        severity: 'blocking',
        phase: 'input',
        fieldPath: '$.plugin',
        message: '符号链接越界',
      },
    }
  }
  // for plugin file reads, also ensure inside pluginRootAbs
  if (pluginRootAbs) {
    const relToPlugin = relative(pluginRootAbs, real)
    if (relToPlugin.startsWith('..') && relToPlugin !== '') {
      // allow reading the pluginRoot itself
      const isRootItself = real === pluginRootAbs
      if (!isRootItself) {
        return {
          ok: false,
          finding: {
            code: 'dev-tool-path-escape',
            severity: 'blocking',
            phase: 'input',
            fieldPath: '$.plugin',
            message: '文件越界',
          },
        }
      }
    }
  }
  return { ok: true, abs: real }
}

export function readPluginManifest(pluginRelativeDir: string): {
  manifest?: unknown
  findings: LocalPluginDevFinding[]
  manifestDigest?: string
  inputBytes?: number
} {
  const findings: LocalPluginDevFinding[] = []
  const check = lexicalAndRealpathCheck(REPO_ROOT, pluginRelativeDir, '')
  if (!check.ok) return { findings: [check.finding!] }
  const pluginAbs = check.abs!
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(pluginAbs)
  } catch {
    return {
      findings: [
        {
          code: 'dev-tool-read-error',
          severity: 'blocking',
          phase: 'input',
          fieldPath: '$.plugin',
          message: '插件目录不存在',
        },
      ],
    }
  }
  if (!stat.isDirectory()) {
    return {
      findings: [
        {
          code: 'dev-tool-path-escape',
          severity: 'blocking',
          phase: 'input',
          fieldPath: '$.plugin',
          message: '插件路径不是目录',
        },
      ],
    }
  }
  // 尝试读取 allowlist 文件
  let chosenFile: string | null = null
  let rawText: string | null = null
  for (const fname of LOCAL_PLUGIN_ALLOWED_FILES) {
    const candidateRel = join(pluginRelativeDir, fname)
    const candidateCheck = lexicalAndRealpathCheck(REPO_ROOT, candidateRel, pluginAbs)
    if (!candidateCheck.ok) continue
    const abs = candidateCheck.abs!
    if (!existsSync(abs)) continue
    try {
      const s = statSync(abs)
      if (s.size > LOCAL_PLUGIN_DEV_BUDGETS.maxFileBytes) {
        findings.push({
          code: 'dev-tool-budget-exceeded',
          severity: 'blocking',
          phase: 'input',
          fieldPath: fname,
          message: '单文件超过预算',
        })
        return { findings }
      }
      rawText = readFileSync(abs, 'utf8')
      if (Buffer.byteLength(rawText, 'utf8') > LOCAL_PLUGIN_DEV_BUDGETS.maxFileBytes) {
        findings.push({
          code: 'dev-tool-budget-exceeded',
          severity: 'blocking',
          phase: 'input',
          fieldPath: fname,
          message: '单文件超过预算',
        })
        return { findings }
      }
      chosenFile = abs
      break
    } catch {
      findings.push({
        code: 'dev-tool-read-error',
        severity: 'blocking',
        phase: 'input',
        fieldPath: fname,
        message: '读取失败',
      })
      return { findings }
    }
  }
  if (!chosenFile || rawText === null) {
    findings.push({
      code: 'dev-tool-read-error',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$.plugin',
      message:
        '未找到允许的 manifest 文件（plugin.json/manifest.json/package.json/aiproj.plugin.json）',
    })
    return { findings }
  }
  // 总字节预算
  if (Buffer.byteLength(rawText, 'utf8') > LOCAL_PLUGIN_DEV_BUDGETS.maxTotalBytes) {
    findings.push({
      code: 'dev-tool-budget-exceeded',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$.plugin',
      message: '插件总字节超过预算',
    })
    return { findings }
  }
  // JSON 解析
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    findings.push({
      code: 'dev-tool-json-parse-error',
      severity: 'blocking',
      phase: 'input',
      fieldPath: chosenFile,
      message: 'manifest 不是合法 JSON',
    })
    return { findings }
  }
  // 检查是否有 plugin 字段包裹
  const manifest = (parsed as Record<string, unknown>).manifest ?? parsed
  return { manifest, findings, inputBytes: Buffer.byteLength(rawText, 'utf8') }
}

export function readJsonFileSafe(
  relativePath: string,
  pluginAbsForBoundary?: string,
): { data?: unknown; findings: LocalPluginDevFinding[] } {
  const check = lexicalAndRealpathCheck(REPO_ROOT, relativePath, pluginAbsForBoundary ?? '')
  if (!check.ok) return { findings: [check.finding!] }
  const abs = check.abs!
  if (!existsSync(abs))
    return {
      findings: [
        {
          code: 'dev-tool-read-error',
          severity: 'blocking',
          phase: 'input',
          fieldPath: relativePath,
          message: '文件不存在',
        },
      ],
    }
  try {
    const s = statSync(abs)
    if (s.size > LOCAL_PLUGIN_DEV_BUDGETS.maxFileBytes) {
      return {
        findings: [
          {
            code: 'dev-tool-budget-exceeded',
            severity: 'blocking',
            phase: 'input',
            fieldPath: relativePath,
            message: '单文件超过预算',
          },
        ],
      }
    }
    const text = readFileSync(abs, 'utf8')
    const data = JSON.parse(text)
    return { data, findings: [] }
  } catch (e) {
    if (e instanceof SyntaxError) {
      return {
        findings: [
          {
            code: 'dev-tool-json-parse-error',
            severity: 'blocking',
            phase: 'input',
            fieldPath: relativePath,
            message: '不是合法 JSON',
          },
        ],
      }
    }
    return {
      findings: [
        {
          code: 'dev-tool-read-error',
          severity: 'blocking',
          phase: 'input',
          fieldPath: relativePath,
          message: '读取失败',
        },
      ],
    }
  }
}

// =============================================================================
// 报告构建与渲染
// =============================================================================

function makeReportId(command: LocalPluginDevCommand, generatedAt: string): string {
  return `${command}-${generatedAt.replace(/[:.]/g, '-')}`
}

function buildReport(params: {
  command: LocalPluginDevCommand
  findings: LocalPluginDevFinding[]
  inputDigest?: string
  compatibilitySummary?: { catalogDigest?: string; manifestDigest?: string }
  commit: string
  generatedAt: string
}): LocalPluginDevReport {
  const sorted = sortDevFindings(params.findings)
  const blocking = sorted.filter((f) => f.severity === 'blocking').length
  const warning = sorted.filter((f) => f.severity === 'warning').length
  const info = sorted.filter((f) => f.severity === 'info').length
  const status: LocalPluginDevReport['status'] =
    blocking > 0
      ? 'blocking'
      : params.findings.some((f) => f.phase === 'tool-error')
        ? 'tool-error'
        : 'passed'
  const phase: LocalPluginDevReport['phase'] = sorted[0]?.phase ?? 'input'
  const counts = { total: sorted.length, blocking, warning, info, omitted: 0 }
  const canonical = {
    schemaVersion: LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION,
    kind: 'local-plugin-dev-report-v1',
    command: params.command,
    status,
    phase,
    findings: sorted.map((f) => ({
      code: f.code,
      severity: f.severity,
      phase: f.phase,
      fieldPath: f.fieldPath,
    })),
    counts,
    inputDigest: params.inputDigest,
    compatibilitySummary: params.compatibilitySummary,
  }
  const resultDigest = computeDevDigest(canonical)
  const report: LocalPluginDevReport = {
    schemaVersion: LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION,
    kind: 'local-plugin-dev-report-v1',
    reportId: makeReportId(params.command, params.generatedAt),
    generatedAt: params.generatedAt,
    commit: params.commit,
    command: params.command,
    status,
    phase,
    findings: sorted.map(redactDevFinding),
    counts,
    inputDigest: params.inputDigest,
    resultDigest,
    compatibilitySummary: params.compatibilitySummary,
    trustedAudit: false,
    omittedCounts: {},
  }
  return report
}

function renderText(report: LocalPluginDevReport): string {
  const lines: string[] = [
    `Local Plugin Developer Report`,
    `══════════════════════════════`,
    `Report:     ${report.reportId}`,
    `Command:    ${report.command}`,
    `Status:     ${report.status}`,
    `Phase:      ${report.phase}`,
    `Generated:  ${report.generatedAt}`,
    `Commit:     ${report.commit}`,
    `InputDigest:${report.inputDigest ?? '(none)'}`,
    `ResultDigest:${report.resultDigest}`,
    ``,
    `Counts: total=${report.counts.total} blocking=${report.counts.blocking} warning=${report.counts.warning} info=${report.counts.info} omitted=${report.counts.omitted}`,
  ]
  if (report.compatibilitySummary) {
    lines.push(
      `Compatibility: catalog=${report.compatibilitySummary.catalogDigest ?? '(none)'} manifest=${report.compatibilitySummary.manifestDigest ?? '(none)'}`,
    )
  }
  if (report.findings.length > 0) {
    lines.push(``, `Findings:`)
    for (const f of report.findings) {
      lines.push(
        `  [${f.severity}] ${f.phase}/${f.code} ${f.fieldPath ?? ''} ${f.message ?? ''}`.trimEnd(),
      )
    }
  }
  lines.push(``, `Exit code: ${devStatusToExitCode(report.status)} (${report.status})`)
  lines.push(`Trusted audit: false — 静态通过不等于安装/授权/执行`)
  const text = lines.join('\n')
  // 二次低敏扫描（不应命中）
  const violations = devSecondaryScan(text)
  if (violations.length > 0) {
    // 已 redacted，仍命中说明 redaction 失败；此处仅记录，不回显原始值
    lines.push(`[redaction-warning: ${violations.join(',')}]`)
    return lines.join('\n')
  }
  return text
}

// =============================================================================
// 子命令实现
// =============================================================================

export async function runValidate(
  args: ValidateArgs,
): Promise<{ report: LocalPluginDevReport; exitCode: number; text: string; json: string }> {
  const commit = detectCommit()
  const generatedAt = new Date().toISOString()
  const read = readPluginManifest(args.plugin)
  let findings: LocalPluginDevFinding[] = [...read.findings]
  let manifestDigest: string | undefined
  let catalogDigest: string | undefined

  if (read.manifest) {
    const inputDigest = read.manifest ? computeDevDigest(read.manifest) : undefined
    // 尝试加载 curated catalog digest 作为兼容性参考（本机零网络）
    try {
      const { PLUGIN_SEAM_CURATED_DIGEST } =
        await import('../packages/types/src/plugin-capability-seam-catalog-curated.js')
      catalogDigest = PLUGIN_SEAM_CURATED_DIGEST
    } catch {
      catalogDigest = undefined
    }
    const pipeline = validateLocalPlugin({ manifest: read.manifest })
    findings.push(...pipeline.findings)
    manifestDigest = pipeline.manifestDigest
    const report = buildReport({
      command: 'validate',
      findings,
      inputDigest,
      compatibilitySummary: { catalogDigest, manifestDigest },
      commit,
      generatedAt,
    })
    // 预算截断（有界）
    if (report.findings.length > LOCAL_PLUGIN_DEV_BUDGETS.maxFindings) {
      const omitted = report.findings.length - LOCAL_PLUGIN_DEV_BUDGETS.maxFindings
      report.findings = report.findings.slice(0, LOCAL_PLUGIN_DEV_BUDGETS.maxFindings)
      report.counts.omitted = omitted
      report.omittedCounts = { findings: omitted }
    }
    const text = renderText(report)
    const json = JSON.stringify(devDeepRedact(report), null, 2)
    const exitCode = devStatusToExitCode(report.status)
    return { report, exitCode, text, json }
  } else {
    const report = buildReport({ command: 'validate', findings, commit, generatedAt })
    const text = renderText(report)
    const json = JSON.stringify(devDeepRedact(report), null, 2)
    const exitCode = devStatusToExitCode(report.status)
    return { report, exitCode, text, json }
  }
}

export async function runInstallDryRun(args: InstallDryRunArgs): Promise<{
  report: LocalPluginDevReport
  exitCode: number
  text: string
  json: string
  plan?: unknown
}> {
  const commit = detectCommit()
  const generatedAt = new Date().toISOString()
  // 读取插件 manifest
  const read = readPluginManifest(args.plugin)
  let findings: LocalPluginDevFinding[] = [...read.findings]
  // 读取 profile
  const profileRead = readJsonFileSafe(args.profile)
  findings.push(...profileRead.findings)
  let profile: LocalPluginHostProfileV1 | undefined
  if (profileRead.data) {
    const check = validateHostProfile(profileRead.data)
    findings.push(...check.findings)
    if (check.valid) profile = check.profile
  }
  if (read.manifest && profile) {
    const validated = validateLocalPlugin({ manifest: read.manifest })
    findings.push(...validated.findings)
    const hasBlocking = validated.findings.some((f) => f.severity === 'blocking')
    if (hasBlocking) {
      findings.push({
        code: 'dev-install-contribution-blocked',
        severity: 'blocking',
        phase: 'install-plan',
        message: '前置校验 blocking，dry-run 终止',
      })
    } else {
      const dry = buildLocalInstallDryRun({
        validatedManifest: validated.normalizedManifest ?? read.manifest,
        hostProfile: profile,
        action: args.action as 'install' | 'enable' | 'disable' | 'uninstall' | 'upgrade',
        referenceTime: profile.referenceTime,
      })
      findings.push(...dry.findings)
      if (dry.plan) {
        // 将 plan 的关键摘要也纳入 report 的 compatibilitySummary
        const planAny = dry.plan as { planDigest: string; catalogDigest: string }
        const report = buildReport({
          command: 'install-dry-run',
          findings,
          inputDigest: computeDevDigest({ manifest: read.manifest, profile }),
          compatibilitySummary: {
            catalogDigest: planAny.catalogDigest,
            manifestDigest: validated.manifestDigest,
            sourceDigest: planAny.planDigest,
          },
          commit,
          generatedAt,
        })
        const text =
          renderText(report) + '\n\n' + `Plan digest: ${planAny.planDigest}\nConfirmable: false`
        const json = JSON.stringify(devDeepRedact({ report, plan: dry.plan }), null, 2)
        const exitCode = devStatusToExitCode(report.status)
        return { report, exitCode, text, json, plan: dry.plan }
      }
    }
  }
  const report = buildReport({ command: 'install-dry-run', findings, commit, generatedAt })
  const text = renderText(report)
  const json = JSON.stringify(devDeepRedact(report), null, 2)
  const exitCode = devStatusToExitCode(report.status)
  return { report, exitCode, text, json }
}

export async function runAuditSummary(
  args: AuditSummaryArgs,
): Promise<{ report: LocalPluginDevReport; exitCode: number; text: string; json: string }> {
  const commit = detectCommit()
  const generatedAt = new Date().toISOString()
  const read = readJsonFileSafe(args.input)
  let findings: LocalPluginDevFinding[] = [...read.findings]
  let summary: LocalPluginDevReport | null = null
  if (read.data) {
    const dataAny = read.data as unknown
    let reports: unknown[] = []
    if (Array.isArray(dataAny)) reports = dataAny as unknown[]
    else if (
      dataAny &&
      typeof dataAny === 'object' &&
      Array.isArray((dataAny as Record<string, unknown>).reports)
    )
      reports = (dataAny as Record<string, unknown>).reports as unknown[]
    else reports = [dataAny]
    // 尝试作为 dev reports 聚合
    const inputReports = reports.filter(
      (r) =>
        r &&
        typeof r === 'object' &&
        (r as Record<string, unknown>).schemaVersion === LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION,
    ) as unknown as LocalPluginDevReport[]
    if (inputReports.length === 0) {
      findings.push({
        code: 'dev-audit-unknown-schema',
        severity: 'blocking',
        phase: 'audit-summary',
        message: '输入不是受支持的本机诊断 envelope',
      })
    } else {
      const agg = summarizeLocalPluginDiagnostics({ reports: inputReports })
      findings.push(...agg.findings)
      if (agg.summary) {
        // 将聚合摘要转为统一报告形式（保持 envelope 一致性）
        const report = buildReport({
          command: 'audit-summary',
          findings: agg.summary.topFindings,
          inputDigest: computeDevDigest(reports),
          compatibilitySummary: { catalogDigest: agg.summary.digest },
          commit,
          generatedAt,
        })
        // 补充聚合计数
        report.counts = {
          total: agg.summary.totalFindings,
          blocking: agg.summary.blockingCount,
          warning: agg.summary.warningCount,
          info: 0,
          omitted: 0,
        }
        report.omittedCounts = agg.summary.omittedCounts
        const text =
          renderText(report) +
          '\n\n' +
          `Aggregated reports: ${agg.summary.totalReports} totalFindings=${agg.summary.totalFindings} digest=${agg.summary.digest} trustedAudit=false`
        const json = JSON.stringify(devDeepRedact({ report, summary: agg.summary }), null, 2)
        const exitCode = devStatusToExitCode(report.status)
        return { report, exitCode, text, json }
      }
    }
  }
  const report = buildReport({ command: 'audit-summary', findings, commit, generatedAt })
  const text = renderText(report)
  const json = JSON.stringify(devDeepRedact(report), null, 2)
  const exitCode = devStatusToExitCode(report.status)
  return { report, exitCode, text, json }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const { args, error } = parsePluginDevArgs(process.argv.slice(2))
  if (error) {
    const finding = mapToolError(error)
    const commit = detectCommit()
    const generatedAt = new Date().toISOString()
    const report = buildReport({ command: 'validate', findings: [finding], commit, generatedAt })
    // 对于解析错误，强制 tool-error 状态
    report.status = 'tool-error'
    report.phase = 'tool-error'
    const text = renderText(report)
    console.error(text)
    process.exit(LOCAL_PLUGIN_DEV_EXIT.toolError)
  }

  try {
    let result: { report: LocalPluginDevReport; exitCode: number; text: string; json: string }
    if (args!.command === 'validate') {
      result = await runValidate(args as ValidateArgs)
    } else if (args!.command === 'install-dry-run') {
      result = await runInstallDryRun(args as InstallDryRunArgs)
    } else {
      result = await runAuditSummary(args as AuditSummaryArgs)
    }
    // 根据请求的 format 输出（默认 text 写 stdout，json 也写 stdout；错误用 stderr 已在上层处理）
    const wantJson = (args as { format?: string }).format === 'json'
    if (wantJson) console.log(result.json)
    else console.log(result.text)
    process.exit(result.exitCode)
  } catch (e) {
    const finding = mapToolError(e)
    const commit = detectCommit()
    const generatedAt = new Date().toISOString()
    const report = buildReport({ command: 'validate', findings: [finding], commit, generatedAt })
    report.status = 'tool-error'
    console.error(renderText(report))
    process.exit(LOCAL_PLUGIN_DEV_EXIT.toolError)
  }
}

const isDirectRun = ((): boolean => {
  try {
    if (!process.argv[1]) return false
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()
if (isDirectRun) {
  main()
}
