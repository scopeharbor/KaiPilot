/**
 * AI 草案回归评测：对固定案例集逐个生成草案并计算质量指标，与基线比较找出退化。
 *
 * 指标（每个案例）：
 * - blocking / warning：导入前校验的阻断与警告数；
 * - factCoverage：已确认关键事实覆盖率；
 * - durationDeviationDays：计划完工日 − 案例截止日（日历天，正数 = 延期）；
 * - retries / attemptFailures / repetitionLoops：重跑次数、阶段尝试失败次数、重复循环中止次数；
 * - stageGateCoverage / traceabilityCoverage / onTimeProbability / capacityUtilization：计划体检指标。
 *
 * 模式：
 * - deterministic（默认）：不调用模型，走确定性引擎，只验证评测链路本身；
 * - real：调用真实模型。按项目规则属于需用户明确授权的动作，命令层要求显式开关。
 */

import type {
  ConfirmedProjectContext,
  DraftValidationIssue,
  ProjectDraftPlanInsights,
} from '@aiproj/types'
import IntentParserService from '#services/ai_intent/intent_parser_service'
import type { ResolvedAdapter } from '#services/ai_m0/resolver'
import { ProjectDraftGenerationService } from '../generation_service.ts'
import {
  applyGenerationQualityGate,
  StructuralDraftValidationGateway,
} from '../validation_gateway.ts'
import { validateSemanticGrounding } from '../semantic_grounding_gate.ts'
import { computePlanInsights } from '../plan_insights.ts'
import type { DraftEvalCase } from './cases.ts'

export interface DraftEvalMetrics {
  caseId: string
  status: 'completed' | 'failed'
  reasonCode: string | null
  blocking: number
  warning: number
  blockingRules: string[]
  factCoverage: number
  durationDeviationDays: number | null
  retries: number
  attemptFailures: number
  repetitionLoops: number
  tasks: number
  wbsNodes: number
  stageGateCoverage: number | null
  traceabilityCoverage: number | null
  onTimeProbability: number | null
  capacityUtilization: number | null
  elapsedMs: number
}

export interface DraftEvalReport {
  version: '1.0'
  mode: 'deterministic' | 'real'
  model: string
  startedAt: string
  cases: DraftEvalMetrics[]
}

export interface DraftEvalRegression {
  caseId: string
  metric: string
  baseline: number | null
  current: number | null
  detail: string
}

const DAY_MS = 86_400_000

function countWbs(nodes: unknown): number {
  if (!Array.isArray(nodes)) return 0
  return nodes.reduce(
    (sum: number, node) =>
      sum + 1 + countWbs((node as { children?: unknown } | null)?.children ?? []),
    0,
  )
}

/** 从原始描述构造确认上下文（评测只用意图解析，不走人工澄清）。 */
export function buildEvalContext(rawInput: string): ConfirmedProjectContext {
  const parsedIntent = new IntentParserService().parse(rawInput)
  return {
    schemaVersion: '1.0',
    rawInput,
    parsedIntent,
    resolvedFields: {},
    assumptions: {},
    unresolvedCriticalFields: [],
    unansweredOptionalFields: [],
  }
}

export async function runDraftEvalCase(
  evalCase: DraftEvalCase,
  resolved: ResolvedAdapter,
  mode: 'deterministic' | 'real',
): Promise<DraftEvalMetrics> {
  const startedAt = Date.now()
  const context = buildEvalContext(evalCase.rawInput)
  let attemptFailures = 0
  let repetitionLoops = 0
  const result = await new ProjectDraftGenerationService().generate({
    context,
    resolved,
    useStagePipeline: true,
    maxRetries: 2,
    onAttemptFailed: () => {
      attemptFailures += 1
    },
    rawTextProvider:
      mode === 'real'
        ? async ({
            prompt,
            strategy,
            jsonSchema,
            sentence,
            maxOutputTokens,
            attempt,
            stageAttempt,
            promptName,
          }) => {
            let rawText = ''
            for await (const chunk of resolved.gateway.stream({
              sentence: sentence ?? '生成结构化项目草案',
              promptSet: prompt,
              strategy,
              jsonSchema,
              maxOutputTokens,
              attemptNumber: stageAttempt ?? attempt + 1,
              promptName: promptName ?? 'draft.single',
            })) {
              if (chunk.kind === 'error') {
                if (chunk.errorKind === 'repetition_loop') repetitionLoops += 1
                throw new Error(chunk.errorKind ?? 'adapter_stream_error')
              }
              if (chunk.kind === 'text' && chunk.text) rawText += chunk.text
            }
            return rawText
          }
        : undefined,
  })

  const draft = result.draft
  let blockingIssues: DraftValidationIssue[] = []
  let warningCount = 0
  let factCoverage = 0
  let insights: ProjectDraftPlanInsights | null = null
  if (draft) {
    const report = applyGenerationQualityGate(
      new StructuralDraftValidationGateway().validate({ draft }),
      { meta: result.meta, qualityIssues: result.qualityIssues },
    )
    blockingIssues = report.blocking
    warningCount = report.warning.length
    if (result.meta.groundingManifest) {
      const semantic = validateSemanticGrounding(draft, result.meta.groundingManifest)
      const total = semantic.coveredFactIds.length + semantic.missingFactIds.length
      factCoverage = total > 0 ? semantic.coveredFactIds.length / total : 1
    }
    insights = computePlanInsights({
      draft: draft as unknown as Record<string, unknown>,
      rawInput: evalCase.rawInput,
      manifest: result.meta.groundingManifest,
    })
  }
  const plannedEnd = insights?.scheduleConfidence.deterministicEndDate ?? null
  const deviation =
    plannedEnd !== null
      ? Math.round(
          (Date.parse(`${plannedEnd}T00:00:00Z`) - Date.parse(`${evalCase.deadline}T00:00:00Z`)) /
            DAY_MS,
        )
      : null
  const gates = insights?.stageGates.gates ?? []
  return {
    caseId: evalCase.id,
    status: result.status,
    reasonCode: result.reasonCode ?? result.errorCode ?? null,
    blocking: blockingIssues.length,
    warning: warningCount,
    blockingRules: [...new Set(blockingIssues.map((issue) => issue.ruleId))],
    factCoverage: Math.round(factCoverage * 100) / 100,
    durationDeviationDays: deviation,
    retries: result.retries,
    attemptFailures,
    repetitionLoops,
    tasks: draft?.tasks.length ?? 0,
    wbsNodes: countWbs(draft?.wbs ?? []),
    stageGateCoverage:
      gates.length > 0
        ? Math.round((gates.filter((gate) => gate.present).length / gates.length) * 100) / 100
        : null,
    traceabilityCoverage: insights?.traceability.coverage ?? null,
    onTimeProbability: insights?.scheduleConfidence.onTimeProbability ?? null,
    capacityUtilization: insights?.capacity.utilization ?? null,
    elapsedMs: Date.now() - startedAt,
  }
}

export async function runDraftEvalSuite(args: {
  cases: readonly DraftEvalCase[]
  resolved: ResolvedAdapter
  mode: 'deterministic' | 'real'
  onCaseDone?: (metrics: DraftEvalMetrics) => void
}): Promise<DraftEvalReport> {
  const report: DraftEvalReport = {
    version: '1.0',
    mode: args.mode,
    model: args.resolved.model,
    startedAt: new Date().toISOString(),
    cases: [],
  }
  // 顺序执行：真实模型下并发会互相抢限流配额，指标（耗时、重跑）失真。
  for (const evalCase of args.cases) {
    const metrics = await runDraftEvalCase(evalCase, args.resolved, args.mode)
    report.cases.push(metrics)
    args.onCaseDone?.(metrics)
  }
  return report
}

/** 与基线逐案例比较；只报告明确变差的指标（容差内的波动不算）。 */
export function compareDraftEvalReports(
  baseline: DraftEvalReport,
  current: DraftEvalReport,
): DraftEvalRegression[] {
  const regressions: DraftEvalRegression[] = []
  const byId = new Map(baseline.cases.map((item) => [item.caseId, item]))
  for (const now of current.cases) {
    const before = byId.get(now.caseId)
    if (!before) continue
    const push = (metric: string, a: number | null, b: number | null, detail: string) =>
      regressions.push({ caseId: now.caseId, metric, baseline: a, current: b, detail })
    if (before.status === 'completed' && now.status === 'failed') {
      push('status', 1, 0, `生成失败（${now.reasonCode ?? '未知原因'}）`)
    }
    if (now.blocking > before.blocking) {
      push('blocking', before.blocking, now.blocking, `阻断数增加：${now.blockingRules.join('、')}`)
    }
    if (now.factCoverage < before.factCoverage - 0.05) {
      push(
        'factCoverage',
        before.factCoverage,
        now.factCoverage,
        '已确认事实覆盖率下降超过 5 个百分点',
      )
    }
    if (
      before.durationDeviationDays !== null &&
      now.durationDeviationDays !== null &&
      Math.abs(now.durationDeviationDays) > Math.abs(before.durationDeviationDays) + 7
    ) {
      push(
        'durationDeviationDays',
        before.durationDeviationDays,
        now.durationDeviationDays,
        '工期偏差扩大超过 7 天',
      )
    }
    if (now.retries > before.retries + 1) {
      push('retries', before.retries, now.retries, '重跑次数增加')
    }
    if (now.repetitionLoops > before.repetitionLoops) {
      push('repetitionLoops', before.repetitionLoops, now.repetitionLoops, '重复循环次数增加')
    }
    if (
      before.stageGateCoverage !== null &&
      now.stageGateCoverage !== null &&
      now.stageGateCoverage < before.stageGateCoverage - 0.1
    ) {
      push(
        'stageGateCoverage',
        before.stageGateCoverage,
        now.stageGateCoverage,
        '行业阶段门覆盖率下降',
      )
    }
    if (
      before.traceabilityCoverage !== null &&
      now.traceabilityCoverage !== null &&
      now.traceabilityCoverage < before.traceabilityCoverage - 0.1
    ) {
      push(
        'traceabilityCoverage',
        before.traceabilityCoverage,
        now.traceabilityCoverage,
        '追溯链完整率下降',
      )
    }
  }
  return regressions
}

/** 报告的 Markdown 摘要（命令行输出与存档用）。 */
export function formatDraftEvalMarkdown(
  report: DraftEvalReport,
  regressions: DraftEvalRegression[] = [],
): string {
  const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)
  const lines = [
    `# AI 草案回归评测（${report.mode === 'real' ? '真实模型' : '确定性引擎'} · ${report.model}）`,
    '',
    `开始时间：${report.startedAt}`,
    '',
    '| 案例 | 状态 | 阻断 | 警告 | 事实覆盖 | 工期偏差(天) | 重跑 | 循环 | 任务 | 阶段门 | 追溯链 | 按期概率 | 人天利用率 | 耗时(秒) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...report.cases
      .map((item) =>
        [
          item.caseId,
          item.status === 'completed' ? '完成' : `失败 ${item.reasonCode ?? ''}`,
          item.blocking,
          item.warning,
          percent(item.factCoverage),
          item.durationDeviationDays ?? '—',
          item.retries,
          item.repetitionLoops,
          item.tasks,
          percent(item.stageGateCoverage),
          percent(item.traceabilityCoverage),
          percent(item.onTimeProbability),
          percent(item.capacityUtilization),
          Math.round(item.elapsedMs / 1000),
        ].join(' | '),
      )
      .map((row) => `| ${row} |`),
  ]
  if (regressions.length > 0) {
    lines.push('', '## 相对基线的退化', '')
    for (const item of regressions) {
      lines.push(
        `- ${item.caseId} · ${item.metric}：${item.baseline ?? '—'} → ${item.current ?? '—'}（${item.detail}）`,
      )
    }
  }
  return lines.join('\n')
}
