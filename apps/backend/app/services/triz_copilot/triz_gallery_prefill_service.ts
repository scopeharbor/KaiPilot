// v3-triz-contradiction-copilot W4 任务 4.2 —— 分馆产物预填服务（九屏幕九格 / 功能分析初始图）。
//
// 职责（spec「九屏幕 3×3 空间卡件」第 3/6 条 + 「功能分析节点关系图件」第 2 条 + tasks 4.2）：
// - 九屏幕：按项目上下文包（1.3）预填 9 格建议（过去 / 现在 / 未来 × 外部环境 / 系统 / 组件），
//   中心格锁定「当前系统 / 当前痛点」，目标「约 80% 格位有内容」而不是空白画布；
// - 功能分析：由上下文包的任务 / 风险 / 资源 / 里程碑实体生成初始节点与四类功能边建议；
// - **模型路径 + 确定性模板回退**：真实模型默认关闭（沿用 `AIPROJ_TRIZ_ENABLE_REAL_AI` 门），
//   未启用 / 无 `ai:trigger` / 通道不可用 / 调用失败 / 输出非法一律落到确定性模板，
//   响应携带 `path`（`ai` / `rule`）与触发原因，规则路径零 Token、零网络调用；
// - **反幻觉关卡**：预填引用的每个实体 ID 必须通过 `isContextRefWhitelisted` 白名单；
//   模型给出的引用未通过即该格（或该节点）降级为**通用模板**文案，且只记计数不记正文。
//
// 边界（红线）：
// - **只产草案**：`persisted: false` / `requiresHumanConfirmation: true`，模块内无任何数据写入端口；
//   落库由用户在前端确认后调用 4.1 的创建端点（`POST /triz-gallery-artifacts`）；
// - 低敏：所有文案有界（截断加省略号），不落 prompt / 模型输出全文（RL-12）。

import { z } from 'zod'
import app from '@adonisjs/core/services/app'
import { ValidationException } from '#exceptions/api_exception'
import { AI_TRIGGER } from '#rbac'
import RbacService from '#services/rbac_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import {
  TRIZ_CONTEXT_ENTITY_KINDS,
  boundContextLabel,
  isContextRefWhitelisted,
  type TrizContextEntityKind,
  type TrizContextPack,
  type TrizContextPermissionChecker,
} from './triz_context_pack_service.js'

// ---------------------------------------------------------------------------
// 闭集、限额与标签
// ---------------------------------------------------------------------------

/** 需要预填脚手架的两类产物（矛盾矩阵与 S 曲线为只读 / 参数带入件，不需要预填）。 */
export const TRIZ_GALLERY_PREFILL_ARTIFACT_TYPES = ['nine_windows', 'function_analysis'] as const
export type TrizGalleryPrefillArtifactType = (typeof TRIZ_GALLERY_PREFILL_ARTIFACT_TYPES)[number]

/** 九屏幕横轴（时间）。 */
export const TRIZ_NINE_WINDOWS_TIME_AXES = ['past', 'present', 'future'] as const
export type TrizNineWindowsTimeAxis = (typeof TRIZ_NINE_WINDOWS_TIME_AXES)[number]

/** 九屏幕纵轴（系统层级）；面向用户的标签一律平民化平替，古典术语不作唯一可见文案。 */
export const TRIZ_NINE_WINDOWS_LEVEL_AXES = ['supersystem', 'system', 'subsystem'] as const
export type TrizNineWindowsLevelAxis = (typeof TRIZ_NINE_WINDOWS_LEVEL_AXES)[number]

export const TRIZ_NINE_WINDOWS_TIME_LABELS: Readonly<Record<TrizNineWindowsTimeAxis, string>> = {
  past: '过去',
  present: '现在',
  future: '未来',
}

/** 平民化层级标签（spec：超系统 → 外部环境 / 市场 / 组织；子系统 → 组件 / 模块 / 角色）。 */
export const TRIZ_NINE_WINDOWS_LEVEL_LABELS: Readonly<Record<TrizNineWindowsLevelAxis, string>> = {
  supersystem: '外部环境 / 市场 / 组织',
  system: '当前系统',
  subsystem: '组件 / 模块 / 角色',
}

/** 中心格键（spec：MUST 锁定为「当前系统 / 当前痛点」）。 */
export const TRIZ_NINE_WINDOWS_CENTER_KEY = 'present.system'

/** 九格顺序（过去 → 现在 → 未来 × 外部环境 → 系统 → 组件）：输出顺序恒定，可复现。 */
export const TRIZ_NINE_WINDOWS_CELL_ORDER: readonly string[] = TRIZ_NINE_WINDOWS_TIME_AXES.flatMap(
  (time) => TRIZ_NINE_WINDOWS_LEVEL_AXES.map((level) => `${time}.${level}`),
)

/** 功能分析四类功能边闭集（spec 第 1 条）。 */
export const TRIZ_FUNCTION_EDGE_TYPES = ['useful', 'harmful', 'insufficient', 'excessive'] as const
export type TrizFunctionEdgeType = (typeof TRIZ_FUNCTION_EDGE_TYPES)[number]

/** 功能分析初始节点类别（系统本体 / 任务组件 / 风险 / 资源 / 里程碑）。 */
export const TRIZ_FUNCTION_NODE_KINDS = ['system', 'task', 'risk', 'resource', 'milestone'] as const
export type TrizFunctionNodeKind = (typeof TRIZ_FUNCTION_NODE_KINDS)[number]

/** 预填路径闭集：模型推理（`ai`）/ 确定性模板（`rule`）。规则路径 MUST NOT 冒充模型推理。 */
export const TRIZ_GALLERY_PREFILL_PATHS = ['ai', 'rule'] as const
export type TrizGalleryPrefillPath = (typeof TRIZ_GALLERY_PREFILL_PATHS)[number]

/** 回退触发原因闭集（诚实披露口径，与 1.4 的映射服务同源语义）。 */
export const TRIZ_GALLERY_PREFILL_FALLBACK_REASONS = [
  'MODEL_DISABLED',
  'NO_AI_TRIGGER',
  'MODEL_UNAVAILABLE',
  'MODEL_FAILED',
  'MODEL_TIMEOUT',
  'MODEL_OUTPUT_INVALID',
] as const
export type TrizGalleryPrefillFallbackReason =
  (typeof TRIZ_GALLERY_PREFILL_FALLBACK_REASONS)[number]

/** 质量标记：不整体降级，但如实标注（供前端徽标与观测计数）。 */
export const TRIZ_GALLERY_PREFILL_QUALITY_FLAGS = [
  /** 模型给出的实体引用未通过白名单，已降级为通用模板 */
  'CONTEXT_REFS_REJECTED',
  /** 上下文域被权限裁剪，预填只能使用可用域 */
  'CONTEXT_TRIMMED',
  /** 上下文本身为空（无任务 / 风险 / 资源 / 里程碑读数），走通用模板 */
  'CONTEXT_EMPTY',
] as const
export type TrizGalleryPrefillQualityFlag = (typeof TRIZ_GALLERY_PREFILL_QUALITY_FLAGS)[number]

export interface TrizGalleryPrefillLimits {
  maxCellChars: number
  maxNodes: number
  maxEdges: number
  maxContextRefsPerCell: number
  maxOutputTokens: number
  requestTimeoutMs: number
}

export const TRIZ_GALLERY_PREFILL_LIMITS: Readonly<TrizGalleryPrefillLimits> = {
  maxCellChars: 60,
  maxNodes: 12,
  maxEdges: 16,
  maxContextRefsPerCell: 3,
  // 2026-09-26 放开：原 900，思考模型常在输出 JSON 前耗尽额度
  maxOutputTokens: 16_000,
  requestTimeoutMs: 120_000,
}

/** 默认值只允许收紧（与 1.3 / 1.4 同款语义）。 */
export function resolveTrizGalleryPrefillLimits(
  overrides?: Partial<TrizGalleryPrefillLimits>,
): TrizGalleryPrefillLimits {
  const resolved: TrizGalleryPrefillLimits = { ...TRIZ_GALLERY_PREFILL_LIMITS }
  if (!overrides) return resolved
  for (const key of Object.keys(
    TRIZ_GALLERY_PREFILL_LIMITS,
  ) as (keyof TrizGalleryPrefillLimits)[]) {
    const value = overrides[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const tightened = Math.floor(value)
    if (tightened < 1) continue
    if (tightened < resolved[key]) resolved[key] = tightened
  }
  return resolved
}

// ---------------------------------------------------------------------------
// 草案结构
// ---------------------------------------------------------------------------

/** 预填来源标注：模型建议 / 上下文确定性模板 / 通用模板（无上下文或降级）。 */
export type TrizGalleryPrefillSource = 'model' | 'template' | 'generic-template'

export interface TrizNineWindowsCellDraft {
  key: string
  timeAxis: TrizNineWindowsTimeAxis
  levelAxis: TrizNineWindowsLevelAxis
  timeLabel: string
  levelLabel: string
  /** 平民化层级说明（如「外部环境 / 市场 / 组织」） */
  prompt: string
  text: string
  source: TrizGalleryPrefillSource
  /** 该格引用的项目实体（全部已过白名单） */
  contextRefs: string[]
  /** 是否为锁定的中心格（当前系统 / 当前痛点） */
  locked: boolean
}

export interface TrizFunctionNodeDraft {
  /** 草案内稳定局部 ID（前端渲染用，落库时由前端生成正式产物内容） */
  id: string
  kind: TrizFunctionNodeKind
  label: string
  source: TrizGalleryPrefillSource
  /** 绑定的项目实体引用（已过白名单；无绑定时为 null） */
  contextRef: string | null
}

export interface TrizFunctionEdgeDraft {
  id: string
  from: string
  to: string
  edgeType: TrizFunctionEdgeType
  label: string
  source: TrizGalleryPrefillSource
}

export interface TrizGalleryPrefillModelUsage {
  /** provider 调用次数：确定性模板路径恒为 0（单测据此断言） */
  providerCalls: number
  provider: string | null
  model: string | null
  totalTokens: number | null
}

export interface TrizGalleryPrefillCommon {
  /** 只产草案：落库走 4.1 的创建端点，由前端在人工确认后调用 */
  persisted: false
  requiresHumanConfirmation: true
  path: TrizGalleryPrefillPath
  fallbackReasons: TrizGalleryPrefillFallbackReason[]
  qualityFlags: TrizGalleryPrefillQualityFlag[]
  /** 预填实际使用的项目实体引用（全部已过白名单） */
  contextRefs: string[]
  modelUsage: TrizGalleryPrefillModelUsage
}

export interface TrizNineWindowsPrefillDraft extends TrizGalleryPrefillCommon {
  artifactType: 'nine_windows'
  cells: TrizNineWindowsCellDraft[]
  centerKey: string
  /** 有内容的格位数（9 格中）——空画布冷启动不存在：有上下文时 ≥ 8 */
  filledCells: number
}

export interface TrizFunctionAnalysisPrefillDraft extends TrizGalleryPrefillCommon {
  artifactType: 'function_analysis'
  nodes: TrizFunctionNodeDraft[]
  edges: TrizFunctionEdgeDraft[]
  /** 问题候选提示（如无后继节点 / 有害边积累），供前端标记，逐条人工确认 */
  problemCandidates: Array<{ id: string; kind: string; message: string; contextRefs: string[] }>
}

export type TrizGalleryPrefillDraft = TrizNineWindowsPrefillDraft | TrizFunctionAnalysisPrefillDraft

/** 权限判定端口的入参形态（与 `RbacService.check` 的 `user` 形参同源）。 */
export type TrizGalleryPrefillActor = Parameters<TrizContextPermissionChecker['check']>[0]

export interface TrizGalleryPrefillRequest {
  organizationId: number
  projectId: number
  actor: TrizGalleryPrefillActor
  artifactType: TrizGalleryPrefillArtifactType
  /** 1.3 组装的上下文包；本服务不重新读业务数据，也 MUST NOT 跨组织使用 */
  contextPack: TrizContextPack
  limits?: Partial<TrizGalleryPrefillLimits>
  /** 显式强制确定性模板路径（离线 / 测试场景） */
  forceTemplatePath?: boolean
  traceId?: string | null
}

// ---------------------------------------------------------------------------
// 模型通道端口（默认经既有 AIGateway；测试注入假实现，零真实调用）
// ---------------------------------------------------------------------------

export interface TrizGalleryPrefillGenerationRequest {
  systemPrompt: string
  userPrompt: string
  jsonSchema: Record<string, unknown>
  maxOutputTokens: number
  requestTimeoutMs: number
  signal: AbortSignal
}

export interface TrizGalleryPrefillGenerationResponse {
  rawText: string
  provider: string | null
  model: string | null
  totalTokens: number | null
  usingRealAdapter: boolean
}

export interface TrizGalleryPrefillModelPort {
  generate(
    request: TrizGalleryPrefillGenerationRequest,
  ): Promise<TrizGalleryPrefillGenerationResponse>
}

export const TRIZ_GALLERY_PREFILL_CAPABILITY = 'triz_gallery_prefill'
export const TRIZ_GALLERY_PREFILL_SURFACE = 'triz_gallery_prefill'

/** 能力面标识（模型通道记录上下文用）。 */
export function isTrizGalleryRealAiEnabled(): boolean {
  return process.env.AIPROJ_TRIZ_ENABLE_REAL_AI === 'true'
}

/**
 * 默认模型通道：经既有 `resolveAdapter` 解析真实适配器，再经 `AIGateway.generate` 生成。
 * 只解析到 mock/fake 适配器时返回 null（RL-13：mock 结果不得充当真实模型路径）。
 */
export async function createAIGatewayPrefillPort(args: {
  organizationId: number
  projectId: number
  userId: number
  estimatedTokens: number
  idempotencyKey: string
}): Promise<TrizGalleryPrefillModelPort | null> {
  const resolved = await resolveAdapter({
    organizationId: args.organizationId,
    requiredCapabilities: ['structured_output'],
    estimatedTokens: args.estimatedTokens,
    recordContext: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      userId: args.userId,
      capability: TRIZ_GALLERY_PREFILL_CAPABILITY,
      surface: TRIZ_GALLERY_PREFILL_SURFACE,
      idempotencyKey: args.idempotencyKey,
      source: 'user',
    },
  })
  if (!resolved.usingRealAdapter) return null

  return {
    async generate(
      request: TrizGalleryPrefillGenerationRequest,
    ): Promise<TrizGalleryPrefillGenerationResponse> {
      const result = await resolved.gateway.generate({
        sentence: request.userPrompt,
        promptSet: { systemPrompt: request.systemPrompt, userPrompt: request.userPrompt },
        strategy: 'native',
        jsonSchema: request.jsonSchema,
        maxOutputTokens: request.maxOutputTokens,
        requestTimeoutMs: request.requestTimeoutMs,
        signal: request.signal,
      })
      return {
        rawText: result.rawText,
        provider: resolved.provider,
        model: resolved.model,
        totalTokens: result.outputTokens,
        usingRealAdapter: result.usingRealAdapter,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 模型输出 Schema（强约束：闭集键 / 闭集边类型 / 有界文本）
// ---------------------------------------------------------------------------

const nineWindowsModelSchema = z.object({
  cells: z
    .array(
      z.object({
        key: z.string().max(32),
        text: z.string().max(400),
        contextRefs: z.array(z.string().max(48)).max(6).optional(),
      }),
    )
    .max(16),
})

const functionAnalysisModelSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().max(48),
        kind: z.enum(TRIZ_FUNCTION_NODE_KINDS),
        label: z.string().max(120),
        contextRef: z.string().max(48).nullable().optional(),
      }),
    )
    .max(24),
  edges: z
    .array(
      z.object({
        from: z.string().max(48),
        to: z.string().max(48),
        edgeType: z.enum(TRIZ_FUNCTION_EDGE_TYPES),
        label: z.string().max(120).optional(),
      }),
    )
    .max(32),
})

/** 解析模型输出：非 JSON / 字段缺失 / 闭集越界一律判非法（调用方落确定性模板）。 */
export function parseTrizGalleryPrefillModelOutput(
  artifactType: TrizGalleryPrefillArtifactType,
  rawText: string,
):
  | {
      ok: true
      value: z.infer<typeof nineWindowsModelSchema> | z.infer<typeof functionAnalysisModelSchema>
    }
  | { ok: false } {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return { ok: false }
  }

  const schema =
    artifactType === 'nine_windows' ? nineWindowsModelSchema : functionAnalysisModelSchema
  const result = schema.safeParse(parsed)
  return result.success ? { ok: true, value: result.data } : { ok: false }
}

// ---------------------------------------------------------------------------
// 确定性模板（回退路径；有上下文即用项目事实，否则通用模板）
// ---------------------------------------------------------------------------

const GENERIC_CELL_TEXTS: Readonly<Record<string, string>> = {
  'past.supersystem': '过去的外部环境：市场、组织与上下游发生过什么变化？',
  'past.system': '过去的系统：上一版方案或交付物关键变化是什么？',
  'past.subsystem': '过去的组件：哪些模块、角色或工具被替换过？',
  'present.supersystem': '现在的外部环境：当前市场 / 组织约束是什么？',
  'present.system': '当前的痛点：最需要解决的核心问题是什么？',
  'present.subsystem': '现在的组件：哪些模块或角色承担了主要工作？',
  'future.supersystem': '未来的外部环境：下一步市场 / 组织会如何变化？',
  'future.system': '未来的系统：目标形态与预期交付物是什么？',
  'future.subsystem': '未来的组件：需要新增或改造哪些模块与角色？',
}

/** 通用模板（无上下文或模型引用未过白名单时的降级文案；恒定、可复现）。 */
export function genericNineWindowsCell(key: string): string {
  return GENERIC_CELL_TEXTS[key] ?? '请补充该视角下的项目事实'
}

/** 上下文实体引用投影：只保留白名单内的引用，顺序去重并限量。 */
export function filterPrefillContextRefs(
  pack: TrizContextPack,
  refs: readonly string[],
  maxRefs: number = TRIZ_GALLERY_PREFILL_LIMITS.maxContextRefsPerCell,
): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = []
  const rejected: string[] = []
  for (const ref of refs) {
    if (typeof ref !== 'string' || ref.length === 0) continue
    if (isContextRefWhitelisted(pack, ref)) {
      if (!accepted.includes(ref) && accepted.length < maxRefs) accepted.push(ref)
    } else if (!rejected.includes(ref)) {
      rejected.push(ref)
    }
  }
  return { accepted, rejected }
}

/** 按实体类别取标签（低敏有界标签；缺失即回退到 `kind:id`）。 */
function labelOf(pack: TrizContextPack, kind: TrizContextEntityKind, id: number): string {
  const domains = pack.domains
  const item =
    kind === 'task'
      ? domains.tasks?.items.find((entry) => entry.id === id)
      : kind === 'risk'
        ? domains.risks?.items.find((entry) => entry.id === id)
        : kind === 'resource'
          ? domains.resources?.items.find((entry) => entry.id === id)
          : kind === 'milestone'
            ? domains.milestones?.items.find((entry) => entry.id === id)
            : domains.changeRequests?.items.find((entry) => entry.id === id)
  const label = item ? boundContextLabel((item as { label?: unknown }).label) : ''
  return label.length > 0 ? label : `${kind}:${id}`
}

function boundCellText(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxChars) return collapsed
  return `${collapsed.slice(0, maxChars)}…`
}

/** 上下文是否含任何可用事实（四个以上域全空即视为「上下文为空」）。 */
export function isContextPackEmpty(pack: TrizContextPack): boolean {
  const domains = pack.domains
  const counts = [
    domains.tasks?.items.length ?? 0,
    domains.risks?.items.length ?? 0,
    domains.resources?.items.length ?? 0,
    domains.milestones?.items.length ?? 0,
    domains.changeRequests?.items.length ?? 0,
  ]
  return counts.every((count) => count === 0)
}

/**
 * 九屏幕确定性预填（有上下文时用项目事实，否则通用模板）。
 * 中心格以「当前痛点」占位，非空；有上下文时 9 格全部有内容。
 */
export function buildNineWindowsTemplateCells(
  pack: TrizContextPack,
  limits: TrizGalleryPrefillLimits,
): TrizNineWindowsCellDraft[] {
  const domains = pack.domains
  const tasks = domains.tasks?.items ?? []
  const risks = domains.risks?.items ?? []
  const resources = domains.resources?.items ?? []
  const milestones = domains.milestones?.items ?? []
  const changeRequests = domains.changeRequests?.items ?? []

  const doneTask = tasks.find((task) => task.progressPercent >= 100) ?? tasks[0]
  const doingTask = tasks.find((task) => task.overdue) ?? tasks[0]
  const plannedTask = tasks.find((task) => task.status === 'not_started') ?? tasks[0]
  const topRisk = risks[0]
  const overloaded = resources.find((resource) => resource.overallocated) ?? resources[0]
  const achievedMilestone = milestones[0]
  const pendingChangeRequest = changeRequests[0]

  const cell = (
    key: string,
    text: string,
    refs: Array<[TrizContextEntityKind, number | undefined]>,
  ): TrizNineWindowsCellDraft => {
    const [time, level] = key.split('.') as [TrizNineWindowsTimeAxis, TrizNineWindowsLevelAxis]
    const declared = refs
      .filter((entry): entry is [TrizContextEntityKind, number] => typeof entry[1] === 'number')
      .map(([kind, id]) => `${kind}:${id}`)
    const { accepted } = filterPrefillContextRefs(pack, declared, limits.maxContextRefsPerCell)
    return {
      key,
      timeAxis: time,
      levelAxis: level,
      timeLabel: TRIZ_NINE_WINDOWS_TIME_LABELS[time],
      levelLabel: TRIZ_NINE_WINDOWS_LEVEL_LABELS[level],
      prompt: `${TRIZ_NINE_WINDOWS_TIME_LABELS[time]} · ${TRIZ_NINE_WINDOWS_LEVEL_LABELS[level]}`,
      text: boundCellText(text, limits.maxCellChars),
      source: 'template',
      contextRefs: accepted,
      locked: key === TRIZ_NINE_WINDOWS_CENTER_KEY,
    }
  }

  const empty = isContextPackEmpty(pack)

  return TRIZ_NINE_WINDOWS_CELL_ORDER.map((key) => {
    if (empty) {
      return cell(key, genericNineWindowsCell(key), [])
    }
    switch (key) {
      case 'past.supersystem':
        return cell(
          key,
          pendingChangeRequest
            ? `上一轮外部变化：${labelOf(pack, 'change_request', pendingChangeRequest.id)}`
            : '上一轮外部变化：市场 / 组织约束的调整',
          [['change_request', pendingChangeRequest?.id]],
        )
      case 'past.system':
        return cell(
          key,
          doneTask ? `已完成交付：${labelOf(pack, 'task', doneTask.id)}` : '上一版系统已交付的范围',
          [['task', doneTask?.id]],
        )
      case 'past.subsystem':
        return cell(
          key,
          doneTask
            ? `曾使用的组件 / 角色：${labelOf(pack, 'task', doneTask.id)}`
            : '曾使用的组件与角色',
          [['task', doneTask?.id]],
        )
      case 'present.supersystem':
        return cell(
          key,
          overloaded
            ? `当前外部约束：资源负载 ${overloaded.utilizationPercent}%（${labelOf(pack, 'resource', overloaded.id)}）`
            : '当前外部约束：市场 / 组织与资源供给',
          [['resource', overloaded?.id]],
        )
      case 'present.system':
        return cell(
          key,
          topRisk
            ? `当前痛点：${labelOf(pack, 'risk', topRisk.id)}`
            : doingTask
              ? `当前痛点：${labelOf(pack, 'task', doingTask.id)} 未按期推进`
              : '当前痛点：待补充核心问题',
          [
            ['risk', topRisk?.id],
            ['task', doingTask?.id],
          ],
        )
      case 'present.subsystem':
        return cell(
          key,
          doingTask ? `当前组件 / 模块：${labelOf(pack, 'task', doingTask.id)}` : '当前组件与角色',
          [['task', doingTask?.id]],
        )
      case 'future.supersystem':
        return cell(
          key,
          pendingChangeRequest
            ? `下一步外部变化：${labelOf(pack, 'change_request', pendingChangeRequest.id)}`
            : '下一步外部环境与组织变化',
          [['change_request', pendingChangeRequest?.id]],
        )
      case 'future.system':
        return cell(
          key,
          achievedMilestone
            ? `目标形态：达成 ${labelOf(pack, 'milestone', achievedMilestone.id)}`
            : '目标形态与预期交付物',
          [['milestone', achievedMilestone?.id]],
        )
      default:
        return cell(
          key,
          plannedTask
            ? `待建设组件：${labelOf(pack, 'task', plannedTask.id)}`
            : '需要新增或改造的模块与角色',
          [['task', plannedTask?.id]],
        )
    }
  })
}

/** 功能分析确定性初始图（系统节点 + 任务 / 风险 / 资源 / 里程碑节点与四类功能边）。 */
export function buildFunctionAnalysisTemplateGraph(
  pack: TrizContextPack,
  limits: TrizGalleryPrefillLimits,
): {
  nodes: TrizFunctionNodeDraft[]
  edges: TrizFunctionEdgeDraft[]
  problemCandidates: TrizFunctionAnalysisPrefillDraft['problemCandidates']
  contextRefs: string[]
} {
  const domains = pack.domains
  const tasks = domains.tasks?.items ?? []
  const risks = domains.risks?.items ?? []
  const resources = domains.resources?.items ?? []
  const milestones = domains.milestones?.items ?? []

  const nodes: TrizFunctionNodeDraft[] = []
  const edges: TrizFunctionEdgeDraft[] = []
  const problemCandidates: TrizFunctionAnalysisPrefillDraft['problemCandidates'] = []
  const usedRefs: string[] = []

  const systemId = 'node-system'
  nodes.push({
    id: systemId,
    kind: 'system',
    label: '当前项目系统',
    source: 'template',
    contextRef: null,
  })

  const pushNode = (
    id: string,
    kind: TrizFunctionNodeKind,
    label: string,
    contextRef: string | null,
  ): void => {
    if (nodes.length >= limits.maxNodes) return
    nodes.push({
      id,
      kind,
      label: boundCellText(label, limits.maxCellChars),
      source: 'template',
      contextRef,
    })
    if (contextRef && !usedRefs.includes(contextRef)) usedRefs.push(contextRef)
  }

  const pushEdge = (
    from: string,
    to: string,
    edgeType: TrizFunctionEdgeType,
    label: string,
  ): void => {
    if (edges.length >= limits.maxEdges) return
    edges.push({
      id: `edge-${edges.length + 1}`,
      from,
      to,
      edgeType,
      label: boundCellText(label, limits.maxCellChars),
      source: 'template',
    })
  }

  for (const task of tasks) {
    const id = `node-task-${task.id}`
    pushNode(id, 'task', labelOf(pack, 'task', task.id), `task:${task.id}`)
    // 逾期 / 关键路径任务对系统的功能供给不足；其余为有用功能。
    pushEdge(
      id,
      systemId,
      task.overdue || task.isCriticalPath ? 'insufficient' : 'useful',
      task.overdue ? '关键供给逾期' : '提供交付功能',
    )
    if (task.overdue) {
      problemCandidates.push({
        id: `candidate-task-${task.id}`,
        kind: 'insufficient_function',
        message: `${labelOf(pack, 'task', task.id)} 的供给不足，建议确认拆解或换人`,
        contextRefs: [`task:${task.id}`],
      })
    }
  }

  for (const risk of risks) {
    const id = `node-risk-${risk.id}`
    pushNode(id, 'risk', labelOf(pack, 'risk', risk.id), `risk:${risk.id}`)
    pushEdge(id, systemId, 'harmful', '对系统有害')
  }
  if (risks.length >= 2) {
    problemCandidates.push({
      id: 'candidate-harmful-accumulation',
      kind: 'harmful_accumulation',
      message: '有害功能边积累：风险条目多于 1 条，建议确认优先级与应对',
      contextRefs: risks.map((risk) => `risk:${risk.id}`),
    })
  }

  for (const resource of resources) {
    const id = `node-resource-${resource.id}`
    pushNode(id, 'resource', labelOf(pack, 'resource', resource.id), `resource:${resource.id}`)
    pushEdge(
      id,
      systemId,
      resource.overallocated ? 'excessive' : 'useful',
      resource.overallocated ? `过度投入（负载 ${resource.utilizationPercent}%）` : '资源投入',
    )
  }

  for (const milestone of milestones) {
    const id = `node-milestone-${milestone.id}`
    pushNode(id, 'milestone', labelOf(pack, 'milestone', milestone.id), `milestone:${milestone.id}`)
    pushEdge(
      id,
      systemId,
      milestone.displayStatus === 'at_risk' ? 'harmful' : 'useful',
      milestone.displayStatus === 'at_risk' ? '目标存在滑移风险' : '锚定交付目标',
    )
  }

  // 孤立节点（无任何功能边）作为问题候选（spec：问题候选 MUST 以可见标记呈现）。
  const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]))
  for (const node of nodes) {
    if (node.id === systemId || connected.has(node.id)) continue
    problemCandidates.push({
      id: `candidate-isolated-${node.id}`,
      kind: 'isolated_node',
      message: `${node.label} 未与其他组件建立功能关系`,
      contextRefs: node.contextRef ? [node.contextRef] : [],
    })
  }

  if (nodes.length === 1) {
    // 无任何上下文实体：给出通用模板骨架（不冒充真实项目事实）。
    pushNode('node-template-task', 'task', '待补充的任务 / 组件', null)
    pushNode('node-template-risk', 'risk', '待补充的风险 / 有害因素', null)
    pushEdge('node-template-task', systemId, 'useful', '提供交付功能')
    pushEdge('node-template-risk', systemId, 'harmful', '对系统有害')
  }

  return { nodes, edges, problemCandidates, contextRefs: usedRefs }
}

/** 由模型输出构造九屏幕草案（逐格白名单校验；未过校验的格降级为通用模板）。 */
export function buildNineWindowsAiCells(
  pack: TrizContextPack,
  output: z.infer<typeof nineWindowsModelSchema>,
  limits: TrizGalleryPrefillLimits,
): { cells: TrizNineWindowsCellDraft[]; rejectedRefs: number } {
  const byKey = new Map(output.cells.map((entry) => [entry.key, entry]))
  let rejectedRefs = 0

  const cells = TRIZ_NINE_WINDOWS_CELL_ORDER.map((key) => {
    const [time, level] = key.split('.') as [TrizNineWindowsTimeAxis, TrizNineWindowsLevelAxis]
    const model = byKey.get(key)
    const { accepted, rejected } = filterPrefillContextRefs(
      pack,
      model?.contextRefs ?? [],
      limits.maxContextRefsPerCell,
    )
    rejectedRefs += rejected.length

    // 模型声明了引用但无一通过 ⇒ 该格内容不可信，降级为通用模板文案。
    const degraded = (model?.contextRefs?.length ?? 0) > 0 && accepted.length === 0
    const text = degraded
      ? genericNineWindowsCell(key)
      : boundCellText(model?.text ?? genericNineWindowsCell(key), limits.maxCellChars)

    return {
      key,
      timeAxis: time,
      levelAxis: level,
      timeLabel: TRIZ_NINE_WINDOWS_TIME_LABELS[time],
      levelLabel: TRIZ_NINE_WINDOWS_LEVEL_LABELS[level],
      prompt: `${TRIZ_NINE_WINDOWS_TIME_LABELS[time]} · ${TRIZ_NINE_WINDOWS_LEVEL_LABELS[level]}`,
      text,
      source: degraded || !model ? 'generic-template' : 'model',
      contextRefs: accepted,
      locked: key === TRIZ_NINE_WINDOWS_CENTER_KEY,
    } satisfies TrizNineWindowsCellDraft
  })

  return { cells, rejectedRefs }
}

/** 由模型输出构造功能分析草案（未过白名单的节点被丢弃，孤立边一并丢弃）。 */
export function buildFunctionAnalysisAiGraph(
  pack: TrizContextPack,
  output: z.infer<typeof functionAnalysisModelSchema>,
  limits: TrizGalleryPrefillLimits,
): { nodes: TrizFunctionNodeDraft[]; edges: TrizFunctionEdgeDraft[]; rejectedRefs: number } {
  let rejectedRefs = 0
  const nodes: TrizFunctionNodeDraft[] = []

  for (const node of output.nodes) {
    if (nodes.length >= limits.maxNodes) break
    let contextRef: string | null = null
    if (node.contextRef) {
      const { accepted, rejected } = filterPrefillContextRefs(pack, [node.contextRef], 1)
      rejectedRefs += rejected.length
      if (accepted.length === 0) continue // 编造实体：整节点丢弃，不原样呈现
      contextRef = accepted[0]
    }
    nodes.push({
      id: node.id,
      kind: node.kind,
      label: boundCellText(node.label, limits.maxCellChars),
      source: 'model',
      contextRef,
    })
  }

  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges: TrizFunctionEdgeDraft[] = []
  for (const edge of output.edges) {
    if (edges.length >= limits.maxEdges) break
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
    edges.push({
      id: `edge-${edges.length + 1}`,
      from: edge.from,
      to: edge.to,
      edgeType: edge.edgeType,
      label: boundCellText(edge.label ?? '', limits.maxCellChars),
      source: 'model',
    })
  }

  return { nodes, edges, rejectedRefs }
}

// ---------------------------------------------------------------------------
// 提示词（低敏：只含实体 ID 与有界标签，不含任何全文）
// ---------------------------------------------------------------------------

export interface TrizGalleryPrefillPrompt {
  systemPrompt: string
  userPrompt: string
  jsonSchema: Record<string, unknown>
}

/** 模型路径的 JSON Schema（与 zod 校验同构；由服务端下发，模型不得自定字段）。 */
export function trizGalleryPrefillJsonSchema(
  artifactType: TrizGalleryPrefillArtifactType,
): Record<string, unknown> {
  if (artifactType === 'nine_windows') {
    return {
      type: 'object',
      properties: {
        cells: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', enum: [...TRIZ_NINE_WINDOWS_CELL_ORDER] },
              text: { type: 'string', maxLength: 400 },
              contextRefs: { type: 'array', items: { type: 'string' }, maxItems: 6 },
            },
            required: ['key', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['cells'],
      additionalProperties: false,
    }
  }

  return {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', enum: [...TRIZ_FUNCTION_NODE_KINDS] },
            label: { type: 'string', maxLength: 120 },
            contextRef: { type: ['string', 'null'] },
          },
          required: ['id', 'kind', 'label'],
          additionalProperties: false,
        },
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            edgeType: { type: 'string', enum: [...TRIZ_FUNCTION_EDGE_TYPES] },
            label: { type: 'string', maxLength: 120 },
          },
          required: ['from', 'to', 'edgeType'],
          additionalProperties: false,
        },
      },
    },
    required: ['nodes', 'edges'],
    additionalProperties: false,
  }
}

/** 上下文事实摘要（低敏：只有 `kind:id` + 有界标签 + 数值读数）。 */
export function summarizePackFacts(pack: TrizContextPack): string {
  const lines: string[] = []
  const push = (kind: TrizContextEntityKind, id: number): void => {
    lines.push(`${kind}:${id} ${labelOf(pack, kind, id)}`)
  }
  for (const task of pack.domains.tasks?.items ?? []) {
    push('task', task.id)
    lines.push(
      `  任务读数：状态=${task.status} 进度=${task.progressPercent}% 关键路径=${task.isCriticalPath} 逾期=${task.overdue}`,
    )
  }
  for (const risk of pack.domains.risks?.items ?? []) {
    push('risk', risk.id)
    lines.push(`  风险读数：等级=${risk.riskLevel} 评分=${risk.score}`)
  }
  for (const resource of pack.domains.resources?.items ?? []) {
    push('resource', resource.id)
    lines.push(`  资源读数：负载=${resource.utilizationPercent}% 超载=${resource.overallocated}`)
  }
  for (const milestone of pack.domains.milestones?.items ?? []) {
    push('milestone', milestone.id)
    lines.push(`  里程碑读数：状态=${milestone.displayStatus}`)
  }
  for (const changeRequest of pack.domains.changeRequests?.items ?? []) {
    push('change_request', changeRequest.id)
    lines.push(`  变更读数：类型=${changeRequest.changeType} 状态=${changeRequest.status}`)
  }
  return lines.join('\n')
}

/** 构造模型提示词：只给实体 ID 与读数，要求模型引用已有 ID（不得编造）。 */
export function buildTrizGalleryPrefillPrompt(
  artifactType: TrizGalleryPrefillArtifactType,
  pack: TrizContextPack,
  limits: TrizGalleryPrefillLimits,
): TrizGalleryPrefillPrompt {
  const systemPrompt = [
    '你是项目管理助手的预填脚手架生成器。',
    '只依据给定的项目事实生成草案；引用的实体只能使用给定的 kind:id，禁止编造。',
    '所有文案为简体中文，使用现代管理语汇，不使用古典机械物理术语。',
    '每个格位 / 节点文案不超过 40 字，不要出现 prompt、模型输出或长篇推理过程。',
    artifactType === 'nine_windows'
      ? `九屏幕格位键固定为：${TRIZ_NINE_WINDOWS_CELL_ORDER.join('/')}（中心格 ${TRIZ_NINE_WINDOWS_CENTER_KEY} 为当前痛点）。`
      : `功能分析的边类型固定为：${TRIZ_FUNCTION_EDGE_TYPES.join('/')}；节点 kind 固定为 ${TRIZ_FUNCTION_NODE_KINDS.join('/')}。`,
    `输出上限：正文不超过 ${limits.maxOutputTokens} tokens，只输出 JSON。`,
  ].join('\n')

  const userPrompt = [
    `产物类型：${artifactType}`,
    `允许引用的实体（kind:id 标签）：`,
    summarizePackFacts(pack),
    artifactType === 'nine_windows'
      ? '请为九个格位各给一句预填建议，并在引用实体时填入 contextRefs。'
      : '请给出初始组件节点与功能边，引用实体时填入 contextRef。',
  ].join('\n')

  return { systemPrompt, userPrompt, jsonSchema: trizGalleryPrefillJsonSchema(artifactType) }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface TrizGalleryPrefillOptions {
  permissionChecker?: TrizContextPermissionChecker
  /** 模型通道：注入即以注入者为准；未注入时经 `resolveAdapter` 解析 */
  model?: TrizGalleryPrefillModelPort | null
  /** 真实模型开关；缺省读 `AIPROJ_TRIZ_ENABLE_REAL_AI`（默认关闭，RL-13） */
  realAiEnabled?: boolean
}

interface TrizPrefillModelAttempt {
  kind: 'ok' | 'fallback'
  providerCalls: 0 | 1
  reason?: TrizGalleryPrefillFallbackReason
  response?: TrizGalleryPrefillGenerationResponse
}

export default class TrizGalleryPrefillService {
  readonly #options: TrizGalleryPrefillOptions

  constructor(options: TrizGalleryPrefillOptions = {}) {
    this.#options = options
  }

  /**
   * 生成预填草案。调用顺序即红线顺序：上下文归属断言 → 模型三道门 → 强 Schema →
   * 白名单校验 → **只产草案**（任何一步不通过都落到确定性模板，绝不写库）。
   */
  async prefetch(request: TrizGalleryPrefillRequest): Promise<TrizGalleryPrefillDraft> {
    const limits = resolveTrizGalleryPrefillLimits(request.limits)
    assertPackBelongsToRequest(request)

    const fallbackReasons: TrizGalleryPrefillFallbackReason[] = []
    const qualityFlags: TrizGalleryPrefillQualityFlag[] = []
    const modelUsage: TrizGalleryPrefillModelUsage = {
      providerCalls: 0,
      provider: null,
      model: null,
      totalTokens: 0,
    }

    if (request.contextPack.trimmedDomains.length > 0) qualityFlags.push('CONTEXT_TRIMMED')
    if (isContextPackEmpty(request.contextPack)) qualityFlags.push('CONTEXT_EMPTY')

    const realAiEnabled = this.#options.realAiEnabled ?? isTrizGalleryRealAiEnabled()
    let rejectedRefs = 0

    if (request.forceTemplatePath === true || !realAiEnabled) {
      fallbackReasons.push('MODEL_DISABLED')
    } else if (!(await this.#hasTriggerPermission(request))) {
      fallbackReasons.push('NO_AI_TRIGGER')
    } else {
      const attempt = await this.#runModelPath(request, limits)
      modelUsage.providerCalls = attempt.providerCalls
      if (attempt.response) {
        modelUsage.provider = attempt.response.provider
        modelUsage.model = attempt.response.model
        modelUsage.totalTokens = attempt.response.totalTokens ?? null
      }

      if (attempt.kind === 'ok' && attempt.response) {
        const parsed = parseTrizGalleryPrefillModelOutput(
          request.artifactType,
          attempt.response.rawText,
        )
        if (parsed.ok) {
          if (request.artifactType === 'nine_windows') {
            const built = buildNineWindowsAiCells(
              request.contextPack,
              parsed.value as z.infer<typeof nineWindowsModelSchema>,
              limits,
            )
            rejectedRefs = built.rejectedRefs
            if (rejectedRefs > 0) qualityFlags.push('CONTEXT_REFS_REJECTED')
            return {
              artifactType: 'nine_windows',
              path: 'ai',
              cells: built.cells,
              centerKey: TRIZ_NINE_WINDOWS_CENTER_KEY,
              filledCells: built.cells.filter((cell) => cell.text.length > 0).length,
              persisted: false,
              requiresHumanConfirmation: true,
              contextRefs: uniqueRefs(built.cells.flatMap((cell) => cell.contextRefs)),
              fallbackReasons,
              qualityFlags,
              modelUsage,
            }
          }

          const built = buildFunctionAnalysisAiGraph(
            request.contextPack,
            parsed.value as z.infer<typeof functionAnalysisModelSchema>,
            limits,
          )
          rejectedRefs = built.rejectedRefs
          if (rejectedRefs > 0) qualityFlags.push('CONTEXT_REFS_REJECTED')
          return {
            artifactType: 'function_analysis',
            path: 'ai',
            nodes: built.nodes,
            edges: built.edges,
            problemCandidates: buildProblemCandidates(built.nodes, built.edges),
            persisted: false,
            requiresHumanConfirmation: true,
            contextRefs: uniqueRefs(
              built.nodes.flatMap((node) => (node.contextRef ? [node.contextRef] : [])),
            ),
            fallbackReasons,
            qualityFlags,
            modelUsage,
          }
        }
        fallbackReasons.push('MODEL_OUTPUT_INVALID')
      } else if (attempt.reason) {
        fallbackReasons.push(attempt.reason)
      }
    }

    // 确定性模板路径（零 Token、零网络；有上下文用项目事实，否则通用模板）。
    if (request.artifactType === 'nine_windows') {
      const cells = buildNineWindowsTemplateCells(request.contextPack, limits)
      return {
        artifactType: 'nine_windows',
        path: 'rule',
        cells,
        centerKey: TRIZ_NINE_WINDOWS_CENTER_KEY,
        filledCells: cells.filter((cell) => cell.text.length > 0).length,
        persisted: false,
        requiresHumanConfirmation: true,
        contextRefs: uniqueRefs(cells.flatMap((cell) => cell.contextRefs)),
        fallbackReasons,
        qualityFlags,
        modelUsage,
      }
    }

    const graph = buildFunctionAnalysisTemplateGraph(request.contextPack, limits)
    return {
      artifactType: 'function_analysis',
      path: 'rule',
      nodes: graph.nodes,
      edges: graph.edges,
      problemCandidates: graph.problemCandidates,
      persisted: false,
      requiresHumanConfirmation: true,
      contextRefs: graph.contextRefs,
      fallbackReasons,
      qualityFlags,
      modelUsage,
    }
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  async #hasTriggerPermission(request: TrizGalleryPrefillRequest): Promise<boolean> {
    const checker = this.#options.permissionChecker ?? (await app.container.make(RbacService))
    const result = await checker.check(
      request.actor,
      AI_TRIGGER,
      request.organizationId,
      request.projectId,
    )
    return result.allowed
  }

  async #runModelPath(
    request: TrizGalleryPrefillRequest,
    limits: TrizGalleryPrefillLimits,
  ): Promise<TrizPrefillModelAttempt> {
    const prompt = buildTrizGalleryPrefillPrompt(request.artifactType, request.contextPack, limits)
    const port =
      this.#options.model === undefined
        ? await this.#resolveDefaultModelPort(request)
        : this.#options.model
    if (!port) return { kind: 'fallback', providerCalls: 0, reason: 'MODEL_UNAVAILABLE' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), limits.requestTimeoutMs)
    try {
      const response = await port.generate({
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        jsonSchema: prompt.jsonSchema,
        maxOutputTokens: limits.maxOutputTokens,
        requestTimeoutMs: limits.requestTimeoutMs,
        signal: controller.signal,
      })
      return { kind: 'ok', providerCalls: 1, response }
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      return {
        kind: 'fallback',
        providerCalls: 1,
        reason: name === 'AbortError' || name === 'TimeoutError' ? 'MODEL_TIMEOUT' : 'MODEL_FAILED',
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async #resolveDefaultModelPort(
    request: TrizGalleryPrefillRequest,
  ): Promise<TrizGalleryPrefillModelPort | null> {
    try {
      return await createAIGatewayPrefillPort({
        organizationId: request.organizationId,
        projectId: request.projectId,
        userId: Number(request.actor.id) || 0,
        estimatedTokens: TRIZ_GALLERY_PREFILL_LIMITS.maxOutputTokens,
        idempotencyKey: `triz-gallery-prefill-${request.artifactType}-${request.projectId}`,
      })
    } catch {
      // 适配器解析失败（未配置 / 不可用）⇒ 诚实降级，不把异常抛给调用方。
      return null
    }
  }
}

/** 上下文包必须属于本次请求的组织与项目（跨组织 / 错配一律 fail-closed，RL-05）。 */
function assertPackBelongsToRequest(request: TrizGalleryPrefillRequest): void {
  const pack = request.contextPack
  if (pack.organizationId !== request.organizationId || pack.projectId !== request.projectId) {
    throw new ValidationException('上下文包与本次请求的组织 / 项目不一致')
  }
}

function uniqueRefs(refs: readonly string[]): string[] {
  return [...new Set(refs)]
}

/** 问题候选：孤立节点 / 有害边积累（确定性规则；确认与驳回由用户在前端逐条处理）。 */
export function buildProblemCandidates(
  nodes: readonly TrizFunctionNodeDraft[],
  edges: readonly TrizFunctionEdgeDraft[],
): TrizFunctionAnalysisPrefillDraft['problemCandidates'] {
  const candidates: TrizFunctionAnalysisPrefillDraft['problemCandidates'] = []
  const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]))
  for (const node of nodes) {
    if (node.kind === 'system' || connected.has(node.id)) continue
    candidates.push({
      id: `candidate-isolated-${node.id}`,
      kind: 'isolated_node',
      message: `${node.label} 未与其他组件建立功能关系`,
      contextRefs: node.contextRef ? [node.contextRef] : [],
    })
  }
  const harmful = edges.filter((edge) => edge.edgeType === 'harmful')
  if (harmful.length >= 2) {
    candidates.push({
      id: 'candidate-harmful-accumulation',
      kind: 'harmful_accumulation',
      message: `有害功能边积累 ${harmful.length} 条，建议确认优先级与应对`,
      contextRefs: [],
    })
  }
  return candidates
}

/** 上下文实体类别闭集（供调用方校验引用形态）。 */
export const TRIZ_GALLERY_PREFILL_ENTITY_KINDS = TRIZ_CONTEXT_ENTITY_KINDS
