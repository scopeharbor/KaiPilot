// apps/backend — V3 Copilot 官方第一方四工具宿主适配器（v3-copilot-first-party-tool-pack）
//
// 本模块是 CopilotPluginToolInvocationService 的生产 executeTool 实现：
// toolId → 四个领域 adapter（项目查询 / TRIZ 顾问 / 周报草稿 / 风险解释）。
//
// 核心裁决（change design.md D2/D3/D4）：
// - 只委托既有只读/建议 facade，不复制领域算法；facade 缺处只建「薄只读 facade」；
// - 全部输出为有界 JSON 文本：零网络、零 provider、零正式表写入（draftPersisted=false）；
// - 风险解释为 advisory 类：草稿内结构化建议动作预览块 applied=false，
//   正式登记/改级/关闭只能走既有核心风控流程人工确认；
// - 周报草稿复用 report_v2 纯函数 fakeAiDraft（provider='fake'），绝不调用 generateAiDraft
//   （后者写 report_versions 表）。

import type { CopilotToolDeclaration } from '@aiproj/types'
import {
  COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD,
  FIRST_PARTY_TOOL_PROJECT_QUERY_ID,
  FIRST_PARTY_TOOL_RISK_EXPLAINER_ID,
  FIRST_PARTY_TOOL_TRIZ_ADVISOR_ID,
  FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID,
} from '@aiproj/types'

// ===========================================================================
// 1. 依赖接口（全部可注入；默认实现见 §5 工厂）
// ===========================================================================

/** 有界项目摘要条目（仅可见项目；不含隐藏实体任何信息）。 */
export interface BoundedProjectSummaryItem {
  readonly projectId: number
  readonly name: string
  readonly code: string | null
  readonly status: string
  readonly priority: string | null
}

export interface FirstPartyToolAdapterDeps {
  /** 当前用户可见项目列表（组织隔离 + 成员可见性由实现保证）。 */
  readonly listVisibleProjects: (params: {
    readonly organizationId: number
    readonly userId: number
    readonly search?: string
    readonly status?: string
    readonly limit: number
  }) => Promise<readonly BoundedProjectSummaryItem[]>

  /** 项目头信息（可见性校验由实现保证；不可见返回 null）。 */
  readonly getVisibleProjectHeader: (params: {
    readonly organizationId: number
    readonly projectId: number
    readonly userId: number
  }) => Promise<{ readonly name: string; readonly status: string } | null>

  /** 周报事实聚合（薄只读 facade；不可访问来源只计缺口不披露名称）。 */
  readonly getWeeklyFacts: (params: {
    readonly organizationId: number
    readonly projectId: number
    readonly userId: number
    readonly weekStartISODate: string
    readonly weekEndISODate: string
  }) => Promise<{
    readonly accessible: boolean
    readonly totalTasks: number
    readonly completedTasks: number
    readonly overdueTasks: number
    readonly openRisks: number
  }>

  /** TRIZ 建议（委托既有 TrizSkillLayerService；未激活时返回合成引导）。 */
  readonly getTrizAdvisory: (params: {
    readonly organizationId: number
    readonly projectId: number
    readonly userId: number
    readonly problem: string
  }) => Promise<{
    readonly activationState: string
    readonly availableDestinationCount: number
    readonly guidance: string
  }>

  /** 可解释风险列表（RiskService.list 薄包装；组织+项目双隔离）。 */
  readonly listExplainableRisks: (params: {
    readonly organizationId: number
    readonly projectId: number
    readonly keyword?: string
    readonly limit: number
  }) => Promise<
    readonly {
      readonly id: number
      readonly title: string
      readonly riskLevel: string
      readonly score: number
      readonly status: string
      readonly category: string | null
    }[]
  >

  /** 周报草稿渲染（默认用 report_v2 fakeAiDraft 纯函数；providerCalls=0）。 */
  readonly renderWeeklyDraft: (input: {
    readonly projectName: string
    readonly fromDate: string
    readonly toDate: string
    readonly totalTasks: number
    readonly completedPercent: string
    readonly overdueTaskCount: number
    readonly warningMessages: readonly string[]
  }) => { readonly draft: string }

  /** 当前时间（ISO 8601）。 */
  readonly now: () => string
}

/** 适配器调用上下文。 */
export interface FirstPartyToolCallContext {
  readonly organizationId: number
  /** Copilot 层 actor key（`user:<id>`）。 */
  readonly actorId: string
  readonly projectId?: number
}

type ToolHandler = (
  deps: FirstPartyToolAdapterDeps,
  ctx: FirstPartyToolCallContext,
  input: Record<string, unknown>,
) => Promise<string>

// ===========================================================================
// 2. 纯函数 helpers（有界投影 / 输入收敛）
// ===========================================================================

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : Number.NaN
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 从 actor key 提取数字用户 id（`user:42` → 42）；非法即抛错 fail-closed。 */
export function userIdFromActorKey(actorKey: string): number {
  const m = /^user:(\d+)$/.exec(actorKey)
  if (!m) throw new Error(`first-party-tool: 非法 actor key "${actorKey.slice(0, 12)}"`)
  return Number(m[1])
}

/** 输出文本硬上限（低于各工具声明预算，正常路径不会触发宿主截断标记）。 */
const MAX_ADAPTER_OUTPUT_CHARS = 6000

function boundedJson(payload: Record<string, unknown>): string {
  const text = JSON.stringify(payload)
  return text.length <= MAX_ADAPTER_OUTPUT_CHARS
    ? text
    : JSON.stringify({
        ...payload,
        itemsJson: undefined,
        summary:
          String(payload['summary'] ?? '').slice(0, MAX_ADAPTER_OUTPUT_CHARS - 256) + '…[截断]',
        truncatedByAdapter: true,
      })
}

/** 由 ISO 时间推导 [周一起始, 周日结束] 的 YYYY-MM-DD 区间（weekOffset ∈ [-4, 0]）。 */
export function weekRangeFor(
  nowIso: string,
  rawWeekOffset: unknown,
): {
  readonly fromDate: string
  readonly toDate: string
} {
  const offset = clampInt(rawWeekOffset, -4, 0, 0)
  const base = new Date(nowIso)
  const day = base.getUTCDay() // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7
  const monday = new Date(base)
  monday.setUTCDate(base.getUTCDate() - daysSinceMonday + offset * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { fromDate: fmt(monday), toDate: fmt(sunday) }
}

// ===========================================================================
// 3. 四个适配器
// ===========================================================================

/**
 * 工具一：项目查询（query）。
 * 只回显当前 permission/scope 可见的有界摘要；隐藏项目零披露——结果中不存在，
 * totalVisible 只统计可见集合。
 */
export const projectQueryAdapter: ToolHandler = async (deps, ctx, input) => {
  const userId = userIdFromActorKey(ctx.actorId)
  const limit = clampInt(input['limit'], 1, 20, 10)
  const search = asString(input['search'])
  const status = asString(input['status'])
  const rows = await deps.listVisibleProjects({
    organizationId: ctx.organizationId,
    userId,
    ...(search !== undefined ? { search } : {}),
    ...(status !== undefined ? { status } : {}),
    limit,
  })
  return boundedJson({
    totalVisible: rows.length,
    itemsJson: JSON.stringify(rows),
    dataCutoffAt: deps.now(),
    scopeNote: '仅包含当前账号在组织内有权限查看的项目；无权限项目不计入、不披露。',
  })
}

/**
 * 工具二：TRIZ 顾问（advisory）。
 * 委托既有 TRIZ Skill 层（activation/预算/审计语义留在宿主）；Skill 未激活或
 * feature flag 关闭时降级为确定性合成引导（synthetic），零 provider 调用、零写入。
 */
export const trizAdvisorAdapter: ToolHandler = async (deps, ctx, input) => {
  if (ctx.projectId === undefined) {
    throw new Error('first-party-tool: triz-advisor 需要项目上下文')
  }
  const problem = asString(input['problem']) ?? ''
  const advisory = await deps.getTrizAdvisory({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    userId: userIdFromActorKey(ctx.actorId),
    problem,
  })
  const guidance =
    advisory.guidance ||
    `针对问题「${problem.slice(0, 120)}」的一般性 TRIZ 引导：先识别技术/物理矛盾，` +
      '再从 40 条发明原理中选取候选（分割/抽取/局部质量/不对称/合并/通用性等），最后评估资源与理想度。'
  return boundedJson({
    summary:
      `【建议草稿 · 仅供参考】${guidance}\n` +
      '本草稿不修改任何项目或 Compiler blueprint 数据；采纳需人工确认。',
    activationState: advisory.activationState,
    dataCutoffAt: deps.now(),
  })
}

/**
 * 工具三：周报草稿（advisory）。
 * 复用可访问项目事实生成有界中文草稿；标注数据截止时间、来源范围与一般性缺口；
 * 不发布、不外发、不写回正式报表（report_versions 表零变化）。
 */
export const weeklyReportDraftAdapter: ToolHandler = async (deps, ctx, input) => {
  if (ctx.projectId === undefined) {
    throw new Error('first-party-tool: weekly-report-draft 需要项目上下文')
  }
  const userId = userIdFromActorKey(ctx.actorId)
  const header = await deps.getVisibleProjectHeader({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    userId,
  })
  // 不可访问项目：泛化能力限制，不披露目标项目存在性
  if (!header) {
    return boundedJson({
      summary: '无法访问该项目或该项目不在当前可见范围内：不能为它生成周报草稿。',
      sourceScopeNote: '来源范围受限；被过滤来源的名称、数量与存在性一律不披露。',
      dataCutoffAt: deps.now(),
    })
  }
  const { fromDate, toDate } = weekRangeFor(deps.now(), input['weekOffset'])
  const facts = await deps.getWeeklyFacts({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    userId,
    weekStartISODate: fromDate,
    weekEndISODate: toDate,
  })
  const completedPercent =
    facts.totalTasks > 0 ? String(Math.round((facts.completedTasks / facts.totalTasks) * 100)) : '0'
  const warnings = facts.accessible
    ? facts.overdueTasks > 0
      ? [`存在 ${facts.overdueTasks} 个逾期任务`]
      : []
    : ['部分项目数据源暂不可访问']
  const { draft } = deps.renderWeeklyDraft({
    projectName: header.name,
    fromDate,
    toDate,
    totalTasks: facts.totalTasks,
    completedPercent,
    overdueTaskCount: facts.overdueTasks,
    warningMessages: warnings,
  })
  return boundedJson({
    summary:
      `${draft}\n\n---\n` +
      `*本工具只生成草稿：不会发布、发送或外发，也不写回正式报表；正式发布请走报表模块人工流程。*`,
    sourceScopeNote: facts.accessible
      ? `来源范围：项目「${header.name}」在 ${fromDate} 至 ${toDate} 的任务与风险计数（当前账号可见部分）。一般性缺口：不含会话外渠道与外部系统数据。`
      : '来源范围：部分项目数据源不可访问，草稿仅基于可访问来源；缺口只做一般性标注，不披露具体来源。',
    dataCutoffAt: deps.now(),
  })
}

/**
 * 工具四：风险解释（advisory）。
 * 解释当前可见风险的原因/影响/建议；附结构化「建议动作预览块」applied=false；
 * 不自动新增风险、不改级、不关闭——确认前风险表零变化，正式变更走核心风控流程。
 */
export const riskExplainAdapter: ToolHandler = async (deps, ctx, input) => {
  if (ctx.projectId === undefined) {
    throw new Error('first-party-tool: risk-explainer 需要项目上下文')
  }
  const limit = clampInt(input['limit'], 1, 10, 5)
  const keyword = asString(input['keyword'])
  const risks = await deps.listExplainableRisks({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    ...(keyword !== undefined ? { keyword } : {}),
    limit,
  })

  const lines: string[] = []
  const suggestedActions: Record<string, unknown>[] = []
  for (const r of risks) {
    lines.push(
      `- ${r.title}（等级 ${r.riskLevel}，评分 ${r.score}，状态 ${r.status}${r.category ? `，类别 ${r.category}` : ''}）：` +
        `该风险来自其类别与当前评分组合，建议按应对策略跟踪并在复核周期内重新评估概率与影响。`,
    )
    if (r.score >= 15 && r.status !== 'closed') {
      suggestedActions.push({
        targetRef: `risk:${r.id}`,
        field: 'review_priority',
        currentValue: r.status,
        suggestion: '提高复核优先级并安排应对计划评审',
        applicableVia: 'core-risk-flow',
        applied: false,
      })
    }
  }
  const summaryText =
    lines.length > 0
      ? `【风险解释 · 仅供参考】\n${lines.join('\n')}\n以上解释不改变任何风险记录；调整等级/关闭等正式变更须经项目管理流程人工确认。`
      : '当前可见范围内没有匹配的风险记录。'
  return boundedJson({
    summary: summaryText,
    suggestedActionPreviewJson: JSON.stringify(suggestedActions),
    dataCutoffAt: deps.now(),
  })
}

// ===========================================================================
// 4. 调度器（CopilotPluginToolInvocationService.deps.executeTool 的生产实现）
// ===========================================================================

const HANDLERS: Readonly<Record<string, ToolHandler>> = {
  [FIRST_PARTY_TOOL_PROJECT_QUERY_ID]: projectQueryAdapter,
  [FIRST_PARTY_TOOL_TRIZ_ADVISOR_ID]: trizAdvisorAdapter,
  [FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID]: weeklyReportDraftAdapter,
  [FIRST_PARTY_TOOL_RISK_EXPLAINER_ID]: riskExplainAdapter,
}

export interface FirstPartyToolExecuteEntry {
  readonly toolId: string
  readonly version: string
  readonly budget: { readonly timeoutMs: number }
}

/**
 * 官方四工具调度器：fail-closed——未知/未收录 toolId 一律抛错（wrapper 捕获后
 * 记 error receipt）；官方声明外的工具不进入 HANDLERS。
 */
export class FirstPartyToolDispatcher {
  constructor(private readonly deps: FirstPartyToolAdapterDeps) {}

  async execute(
    entry: FirstPartyToolExecuteEntry,
    ctx: FirstPartyToolCallContext,
    input: Record<string, unknown>,
  ): Promise<string> {
    const handler = HANDLERS[entry.toolId]
    if (!handler) {
      throw new Error(`first-party-tool: 未收录的工具 "${entry.toolId}"`)
    }
    return await handler(this.deps, ctx, input)
  }
}

/**
 * 按调用上下文绑定 executeTool 闭包（与上游 InvocationService.deps.executeTool 签名对齐）。
 * 生产接线按「组织 × actor × project 会话」构造一次；上下文在绑定时固定，
 * 工具本体不自行解析身份（fail-closed，防越权扩大）。
 */
export function bindFirstPartyToolExecuteTool(
  deps: FirstPartyToolAdapterDeps,
  ctx: FirstPartyToolCallContext,
): (
  entry: { toolId: string; version: string; budget: { timeoutMs: number } },
  input: Record<string, unknown>,
) => Promise<string> {
  const dispatcher = new FirstPartyToolDispatcher(deps)
  return async (entry, input) => dispatcher.execute(entry, ctx, input)
}

/** 官方包声明（供接线层核对 toolId ↔ 声明一致性）。 */
export const OFFICIAL_PACK_DECLARATIONS: readonly CopilotToolDeclaration[] =
  COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools
