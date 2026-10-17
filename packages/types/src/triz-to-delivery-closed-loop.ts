/**
 * v3-triz-to-delivery-closed-loop —— TRIZ 到交付闭环共享契约（前后端共享）。
 *
 * 把已确认 TRIZ 决策经 reviewed-import receipt 或 existing-entity link 追溯到
 * task/milestone 权威交付状态，再以 human-only append-only verification 与
 * reopen request 闭合效果复盘。
 *
 * 红线：
 * - 闭环状态是权威事实的确定性 read model 投影，不是可写 authority；
 *   任务/里程碑/风险/变更请求的领域状态机不被复制或替代。
 * - 所有 DTO 仅含低敏摘要：不返回完整 prompt、模型输出、原始 evidence body、
 *   secret/token/Authorization；隐藏实体不进入计数/排序/hash/搜索语料。
 * - AI/插件输出只进 advisory draft 区，不得推进 posture 或写 link/event。
 * - 默认 providerCalls=0 / networkCalls=0；真实模型与外部动作保持 conditional。
 */

// ---------------------------------------------------------------------------
// 上限常量（design D10 / Observation Packet A9 冻结值）
// ---------------------------------------------------------------------------

export const TRIZ_DL_MAX_PER_PAGE = 100
export const TRIZ_DL_MIN_PER_PAGE = 1
export const TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS = 50
export const TRIZ_DL_MAX_CONTEXT_REFS = 20
export const TRIZ_DL_MAX_EVIDENCE_REFS = 20
export const TRIZ_DL_MAX_TEXT_LENGTH = 2000
export const TRIZ_DL_MAX_SHORT_TEXT_LENGTH = 500
export const TRIZ_DL_MAX_SEARCH_LENGTH = 100
/** 性能门 fixture 规模（机器相关阈值注册在 performance-gate-catalog，不入 spec） */
export const TRIZ_DL_PERF_FIXTURE_LINKS = 1000

// ---------------------------------------------------------------------------
// 枚举闭集（task 2.1）
// ---------------------------------------------------------------------------

/** 闭环姿态（D4 固定优先级投影的唯一合法输出） */
export const TRIZ_DL_POSTURES = [
  'superseded',
  'source_stale',
  'verified_effective',
  'verified_ineffective',
  'blocked',
  'in_progress',
  'awaiting_verification',
  'delivery_linked',
  'awaiting_apply',
] as const
export type TrizDlPosture = (typeof TRIZ_DL_POSTURES)[number]

/** 实体种类闭集（task/milestone 为 required delivery；risk/change_request 为 context/evidence） */
export const TRIZ_DL_ENTITY_KINDS = ['task', 'milestone', 'risk', 'change_request'] as const
export type TrizDlEntityKind = (typeof TRIZ_DL_ENTITY_KINDS)[number]

/** required delivery kinds */
export const TRIZ_DL_REQUIRED_DELIVERY_KINDS = ['task', 'milestone'] as const
export type TrizDlRequiredDeliveryKind = (typeof TRIZ_DL_REQUIRED_DELIVERY_KINDS)[number]

/** context/evidence kinds */
export const TRIZ_DL_CONTEXT_KINDS = ['risk', 'change_request'] as const
export type TrizDlContextKind = (typeof TRIZ_DL_CONTEXT_KINDS)[number]

/** 关联实体标准化 posture（adapter 输出闭集，禁止猜测合成其他值） */
export const TRIZ_DL_ENTITY_POSTURES = [
  'not_started',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
  'unavailable',
] as const
export type TrizDlEntityPosture = (typeof TRIZ_DL_ENTITY_POSTURES)[number]

/** link 来源模式 */
export const TRIZ_DL_LINK_MODES = ['apply_receipt', 'existing_entity'] as const
export type TrizDlLinkMode = (typeof TRIZ_DL_LINK_MODES)[number]

/** append-only event 种类 */
export const TRIZ_DL_EVENT_KINDS = [
  'verification_recorded',
  'verification_superseded',
  'reopen_requested',
  'link_superseded',
] as const
export type TrizDlEventKind = (typeof TRIZ_DL_EVENT_KINDS)[number]

/** 人工效果验证结论闭集 */
export const TRIZ_DL_VERIFICATION_CONCLUSIONS = [
  'effective',
  'ineffective',
  'inconclusive',
] as const
export type TrizDlVerificationConclusion = (typeof TRIZ_DL_VERIFICATION_CONCLUSIONS)[number]

/** warning codes（封闭词表，前后端共享文案映射） */
export const TRIZ_DL_WARNING_CODES = [
  'TRIZ_DL_LEGACY_UNLINKED',
  'TRIZ_DL_SOURCE_STALE',
  'TRIZ_DL_REFS_TRUNCATED',
  'TRIZ_DL_CONTEXT_TRUNCATED',
  'TRIZ_DL_EVIDENCE_TRUNCATED',
  'TRIZ_DL_HIDDEN_ENTITY',
  'TRIZ_DL_PARTIAL_UNAVAILABLE',
  'TRIZ_DL_PLUGIN_DEGRADED',
  'TRIZ_DL_INCONCLUSIVE_EVIDENCE',
  'TRIZ_DL_PERMISSION_LIMITED',
] as const
export type TrizDlWarningCode = (typeof TRIZ_DL_WARNING_CODES)[number]

/** 插件/AI 局部降级原因闭集 */
export const TRIZ_DL_DEGRADED_REASONS = [
  'plugin_disabled',
  'plugin_uninstalled',
  'plugin_timeout',
  'payload_oversize',
  'invalid_output',
  'forbidden_content',
  'partial_failure',
  'ai_unavailable',
] as const
export type TrizDlDegradedReason = (typeof TRIZ_DL_DEGRADED_REASONS)[number]

/** D4 投影的权威事实输入缺失标记 */
export const TRIZ_DL_INPUT_STATES = ['ok', 'unavailable', 'missing'] as const
export type TrizDlInputState = (typeof TRIZ_DL_INPUT_STATES)[number]

// ---------------------------------------------------------------------------
// 有界 DTO（task 2.2）
// ---------------------------------------------------------------------------

/** 规范化 delivery/context ref（link 与 preview 共用；ref 一律稳定字符串 id） */
export interface TrizDlEntityRef {
  kind: TrizDlEntityKind
  /** 正式实体稳定 id（数字表主键以十进制字符串表示） */
  entityId: string
  /** 创建 link 时记录的软 revision（updatedAt ISO 或内容 hash 前缀），可空表示未快照 */
  revisionHint?: string
}

/** typed apply entity receipt —— DraftLayerApplyService 确认提交在同事务内产出 */
export interface TrizDlApplyEntityReceipt {
  entityType: 'project' | 'wbs_node' | 'task' | 'dependency' | 'milestone'
  entityId: string
  sourceChangeId: number
  tempId: string
}

/** review session/result 归因（来自既有 reviewed-import 链路的低敏 ref 对） */
export interface TrizDlSourceAttributionRef {
  decisionLogId: string
  schemeId?: string
  optionIds?: string[]
  sourceHashes: {
    schemeHash?: string
    contradictionSignatures?: string[]
    analysisContentHashes?: string[]
  }
}

/** 附录：link 的创建归因摘要（审计低敏面） */
export interface TrizDlActorStamp {
  userId: number
  at: string
}

/**
 * 闭环项 summary/list 行。数组与文本均有显式上限：
 * deliveryRefs ≤50、contextRefs ≤20、warningCodes 全词表、title ≤500 chars。
 */
export interface TrizDlClosedLoopItem {
  itemId: string
  projectId: number
  organizationId: number
  decisionLogId: string
  linkMode: TrizDlLinkMode | null
  posture: TrizDlPosture
  warningCodes: TrizDlWarningCode[]
  degradedReasons: TrizDlDegradedReason[]
  deliveryRefs: TrizDlEntityRef[]
  contextRefs: TrizDlEntityRef[]
  latestConclusion: TrizDlVerificationConclusion | null
  updatedAt: string
}

/** 摘要聚合（仅可见集合口径） */
export interface TrizDlClosedLoopSummary {
  projectId: number
  totals: Record<TrizDlPosture, number>
  visibleItemCount: number
  hasHiddenItems: boolean
  degradedReasons: TrizDlDegradedReason[]
  generatedAt: string
}

/** 授权实体摘要 —— adapter 经领域 Policy 二次授权后输出的最小低敏面 */
export interface TrizDlAuthorizedEntitySummary {
  kind: TrizDlEntityKind
  entityId: string
  posture: TrizDlEntityPosture
  revisionHint: string | null
  /** 无权限/不可用时必须为 null，并以 warning 说明 */
  title: string | null
  unavailableReason: 'forbidden' | 'deleted' | 'cross_project' | 'error' | null
}

/** 验证事件（append-only；历史事件经 supersededBy 显式标记后仍可读） */
export interface TrizDlVerificationEventDto {
  eventId: string
  itemId: string
  kind: Extract<
    TrizDlEventKind,
    'verification_recorded' | 'verification_superseded' | 'reopen_requested'
  >
  conclusion: TrizDlVerificationConclusion | null
  observationWindow: { from: string; to: string } | null
  baselineSummary: string | null
  targetSummary: string | null
  actualResult: string | null
  reason: string | null
  evidenceRefs: string[]
  fingerprint: string
  actorUserId: number
  createdAt: string
  supersedesEventId: string | null
  supersededByEventId: string | null
}

/** link preview 请求（existing-entity 只写关联路径） */
export interface TrizDlLinkPreviewRequest {
  projectId: number
  decisionLogId: string
  deliveryRefs: TrizDlEntityRef[]
  contextRefs?: TrizDlEntityRef[]
}

/** link preview 响应 —— 零写入，含 fingerprint 与显式「只写关联」声明 */
export interface TrizDlLinkPreviewResponse {
  preview: {
    decisionLogId: string
    deliveryRefs: TrizDlEntityRef[]
    contextRefs: TrizDlEntityRef[]
    sourceFreshness: 'fresh' | 'stale' | 'unknown'
    entitySummaries: TrizDlAuthorizedEntitySummary[]
    warningCodes: TrizDlWarningCode[]
  }
  previewFingerprint: string
  confirmationOwnedBy: 'user'
  notice: string
}

/** link confirm 请求 */
export interface TrizDlLinkConfirmRequest {
  projectId: number
  previewFingerprint: string
  confirmation: {
    acknowledgedOnlyLinkWrite: boolean
    requestedAt: string
  }
  idempotencyKey?: string
}

/** verify/reopen 请求体边界 */
export interface TrizDlVerificationRequest {
  itemId: string
  conclusion: TrizDlVerificationConclusion
  observationWindow: { from: string; to: string }
  baselineSummary?: string
  targetSummary?: string
  actualResult?: string
  reason?: string
  evidenceRefs: string[]
  /** 并发控制：readiness 返回的最新 fingerprint */
  verificationFingerprint: string
  idempotencyKey?: string
}

export interface TrizDlReopenRequest {
  itemId: string
  reason: string
  /** 必须引用当前 verification/source fingerprint */
  currentFingerprint: string
  idempotencyKey?: string
}

// ---------------------------------------------------------------------------
// 输入投影结构（task 2.4）
// ---------------------------------------------------------------------------

/** posture projector 的单 ref 输入 */
export interface TrizDlEntityFact {
  ref: TrizDlEntityRef
  state: TrizDlInputState
  posture: TrizDlEntityPosture | null
}

/** D4 固定优先级 posture projector 的完整输入 */
export interface TrizDlProjectionInput {
  linkSuperseded: boolean
  decisionSuperseded: boolean
  sourceFreshness: 'fresh' | 'stale' | 'unknown'
  hasValidLink: boolean
  latestVerification: {
    conclusion: TrizDlVerificationConclusion
    /** 该验证所依据的 fingerprint 是否仍然新鲜 */
    fresh: boolean
    superseded: boolean
  } | null
  requiredDeliveryFacts: TrizDlEntityFact[]
}

export interface TrizDlProjectionOutput {
  posture: TrizDlPosture
  warningCodes: TrizDlWarningCode[]
}

// ---------------------------------------------------------------------------
// 稳定序列化 / digest / fingerprint 纯函数（task 2.3）
// ---------------------------------------------------------------------------

/** 确定性序列化：递归按 key 排序后 JSON.stringify；undefined 字段删除。 */
export function trizDlStableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(trizDlStableSerialize).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  const parts = keys.map((k) => `${JSON.stringify(k)}:${trizDlStableSerialize(obj[k])}`)
  return `{${parts.join(',')}}`
}

/** 简单非加密哈希（确定性；digest 冲突由 DB 唯一约束兜底 fail closed）。 */
export function trizDlHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    const char = input.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

function digestOf(label: string, payload: unknown): string {
  return `${label}_${trizDlHash(`${label}|${trizDlStableSerialize(payload)}`)}`
}

/** 规范化 refs：按 kind 去重（同 kind 取首个）、按 kind+entityId 稳定排序。 */
export function trizDlCanonicalizeRefs(refs: readonly TrizDlEntityRef[]): {
  visible: TrizDlEntityRef[]
  duplicatesRemoved: number
} {
  const seen = new Set<string>()
  const visible: TrizDlEntityRef[] = []
  let duplicatesRemoved = 0
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.entityId}`
    if (seen.has(key)) {
      duplicatesRemoved += 1
      continue
    }
    seen.add(key)
    visible.push({
      kind: ref.kind,
      entityId: ref.entityId,
      ...(ref.revisionHint ? { revisionHint: ref.revisionHint } : {}),
    })
  }
  visible.sort((a, b) =>
    a.kind === b.kind ? a.entityId.localeCompare(b.entityId) : a.kind.localeCompare(b.kind),
  )
  return { visible, duplicatesRemoved }
}

/** link digest —— decision + mode + canonical refs 的幂等键；同输入恒同输出。 */
export function trizDlComputeLinkDigest(input: {
  organizationId: number
  projectId: number
  decisionLogId: string
  linkMode: TrizDlLinkMode
  deliveryRefs: readonly TrizDlEntityRef[]
  contextRefs?: readonly TrizDlEntityRef[]
}): string {
  const d = trizDlCanonicalizeRefs(input.deliveryRefs).visible
  const c = trizDlCanonicalizeRefs(input.contextRefs ?? []).visible
  return digestOf('tdllink', {
    o: input.organizationId,
    p: input.projectId,
    dec: input.decisionLogId,
    m: input.linkMode,
    d,
    c,
  })
}

/** preview fingerprint —— preview 后任何来源/revision/权限相关变化都应改变它。 */
export function trizDlComputePreviewFingerprint(input: {
  projectId: number
  decisionLogId: string
  decisionSchemeHash: string | null
  sourceContentHashes: string[]
  deliveryRefs: readonly TrizDlEntityRef[]
  contextRefs?: readonly TrizDlEntityRef[]
}): string {
  return digestOf('tdlprev', {
    p: input.projectId,
    dec: input.decisionLogId,
    sch: input.decisionSchemeHash,
    src: [...input.sourceContentHashes].sort(),
    d: trizDlCanonicalizeRefs(input.deliveryRefs).visible,
    c: trizDlCanonicalizeRefs(input.contextRefs ?? []).visible,
  })
}

/** verification fingerprint —— link 来源 hashes + required revisions + 最新 event id 绑定。 */
export function trizDlComputeVerificationFingerprint(input: {
  linkDigest: string
  sourceContentHashes: string[]
  requiredRevisions: string[]
  latestEventId: string | null
}): string {
  return digestOf('tdlver', {
    ld: input.linkDigest,
    src: [...input.sourceContentHashes].sort(),
    rev: [...input.requiredRevisions].sort(),
    ev: input.latestEventId,
  })
}

/** event digest 幂等键（verification/reopen/supersede 重复请求防重） */
export function trizDlComputeEventDigest(input: {
  itemId: string
  kind: TrizDlEventKind
  conclusion: TrizDlVerificationConclusion | null
  evidenceRefs: readonly string[]
  supersedesEventId: string | null
  actorUserId: number
  fingerprint: string
}): string {
  return digestOf('tdlev', {
    i: input.itemId,
    k: input.kind,
    cc: input.conclusion,
    ev: [...input.evidenceRefs].sort(),
    se: input.supersedesEventId,
    a: input.actorUserId,
    fp: input.fingerprint,
  })
}

// ---------------------------------------------------------------------------
// D4 固定优先级 posture projector（task 2.4）
// ---------------------------------------------------------------------------

/**
 * 优先级（design D4，从高到低）：
 * 1. superseded（link 或 decision 被有效 supersede）
 * 2. source_stale（required decision/source hash 或 linked revision 失配）
 * 3. verified_effective / verified_ineffective（最新有效 human verification；
 *    inconclusive 不产生 verified 姿态）
 * 4. awaiting_verification（全部 required 完成，或最新验证 inconclusive）
 * 5. blocked（任一 required blocking）
 * 6. in_progress（任一 required 进行中）
 * 7. delivery_linked（有有效 link 但未进入上述状态）
 * 8. awaiting_apply（合格 decision 尚无成功 apply/link）
 */
export function projectTrizDlPosture(input: TrizDlProjectionInput): TrizDlProjectionOutput {
  const warnings: TrizDlWarningCode[] = []

  // 1. superseded
  if (input.linkSuperseded || input.decisionSuperseded) {
    return { posture: 'superseded', warningCodes: [] }
  }

  // 2. source_stale —— unknown freshness 同样 fail closed
  if (input.sourceFreshness !== 'fresh') {
    if (input.sourceFreshness === 'stale') warnings.push('TRIZ_DL_SOURCE_STALE')
    return { posture: 'source_stale', warningCodes: warnings }
  }

  // 无有效 link：awaiting_apply（decision 尚无成功 apply/link）
  if (!input.hasValidLink) {
    return { posture: 'awaiting_apply', warningCodes: [] }
  }

  // required refs 缺失或不可用均 fail closed（不出现在此处则视为投影输入不完整）
  const facts = input.requiredDeliveryFacts
  const missingOrUnavailable = facts.filter(
    (f) => f.state !== 'ok' || f.posture === 'unavailable' || f.posture === null,
  )
  if (facts.length === 0 || missingOrUnavailable.length > 0) {
    warnings.push('TRIZ_DL_PARTIAL_UNAVAILABLE')
    return { posture: 'blocked', warningCodes: warnings }
  }

  // 3. 最新有效 human verification
  const v = input.latestVerification
  if (v && !v.superseded) {
    if (!v.fresh) {
      // stale-after-verification：旧验证保留为历史但不再作为当前结论
      warnings.push('TRIZ_DL_SOURCE_STALE')
      return { posture: 'source_stale', warningCodes: warnings }
    }
    if (v.conclusion === 'effective') return { posture: 'verified_effective', warningCodes: [] }
    if (v.conclusion === 'ineffective') return { posture: 'verified_ineffective', warningCodes: [] }
    // inconclusive：不产生 verified 姿态，不宣称成功；附加证据不足 warning，
    // 姿态回落到下方交付事实投影（全部完成时仍为 awaiting_verification 的
    // 「持续待验证」，部分完成则 in_progress —— 确定性且不含自动判定语义）。
    warnings.push('TRIZ_DL_INCONCLUSIVE_EVIDENCE')
  }

  // 4–6. delivery facts 聚合（条件互斥，顺序对结果无影响）
  const facts2 = facts as ReadonlyArray<{ posture: TrizDlEntityPosture }>
  const completed = facts2.filter((f) => f.posture === 'completed').length
  const blockedCount = facts2.filter((f) => f.posture === 'blocked').length
  const cancelled = facts2.filter((f) => f.posture === 'cancelled').length
  const progressed = facts2.filter(
    (f) => f.posture === 'in_progress' || f.posture === 'completed',
  ).length

  if (blockedCount > 0) return { posture: 'blocked', warningCodes: [...warnings] }
  // 全部完成（没有任何取消/未完成项）→ awaiting_verification（若带 inconclusive
  // warning 则表示「待人工再次验证」）
  if (completed === facts.length && completed > 0 && cancelled === 0) {
    return { posture: 'awaiting_verification', warningCodes: [...warnings] }
  }
  // mixed completion / 部分-取消等边界统一确定性地落 in_progress 或 delivery_linked
  if (progressed > 0 || cancelled > 0) {
    return { posture: 'in_progress', warningCodes: warnings }
  }

  // 7. 默认：有 link 未开始
  return { posture: 'delivery_linked', warningCodes: warnings }
}

// ---------------------------------------------------------------------------
// 低敏 sanitizer 与 forbidden 扫描（task 2.5）
// ---------------------------------------------------------------------------

/** 一律拒绝的键（大小写不敏感匹配；URL/body 类任意载荷同样拒绝） */
const TRIZ_DL_FORBIDDEN_KEYS = [
  'prompt',
  'completion',
  'rawevidence',
  'raw_body',
  'rawbody',
  'secret',
  'token',
  'accesstoken',
  'refresh_token',
  'authorization',
  'apikey',
  'api_key',
  'password',
  'cookie',
  'set-cookie',
  'url',
  'body',
  'payload',
] as const

/**
 * 深度扫描对象中出现的禁止键；返回违规路径列表（供服务层 fail closed）。
 * 数组照常下钻；value 不做语义判断，仅按键名拒绝（minimize attack surface）。
 */
export function scanTrizDlForbiddenKeys(
  value: unknown,
  path = '$',
  violations: string[] = [],
): string[] {
  if (value === null || typeof value !== 'object') return violations
  if (Array.isArray(value)) {
    value.forEach((item, idx) => scanTrizDlForbiddenKeys(item, `${path}[${idx}]`, violations))
    return violations
  }
  const obj = value as Record<string, unknown>
  for (const [key, child] of Object.entries(obj)) {
    const normalized = key.toLowerCase().replace(/-/g, '_')
    if ((TRIZ_DL_FORBIDDEN_KEYS as readonly string[]).includes(normalized)) {
      violations.push(`${path}.${key}`)
      continue
    }
    scanTrizDlForbiddenKeys(child, `${path}.${key}`, violations)
  }
  return violations
}

/**
 * 文本清洗：截断到上限并拒绝控制字符注入。
 * 超限返回截断后的安全文本（调用方负责附加 truncation warning）。
 */
export function sanitizeTrizDlText(
  input: string | null | undefined,
  maxLength: number,
): string | null {
  if (input === null || input === undefined) return null
  const stripped = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  if (stripped.length <= maxLength) return stripped
  return stripped.slice(0, maxLength)
}

/** 统一文本上限便捷常量导出 */
export const TRIZ_DL_TEXT_LIMITS = {
  short: TRIZ_DL_MAX_SHORT_TEXT_LENGTH,
  long: TRIZ_DL_MAX_TEXT_LENGTH,
} as const

// ---------------------------------------------------------------------------
// 可见计数与截断规则（task 2.6）
// ---------------------------------------------------------------------------

export interface TrizDlTruncationResult<T> {
  visible: T[]
  truncatedCount: number
  warningCode: TrizDlWarningCode | null
}

/**
 * 有界截断：超过 max 时保留前 max 个（输入必须已规范化排序），
 * 超出部分计入 truncation 且不得进入任何计数/hash/标题/排序键/搜索语料。
 */
export function truncateTrizDlRefs<T>(
  refs: readonly T[],
  max: number,
  code: TrizDlWarningCode,
): TrizDlTruncationResult<T> {
  if (refs.length <= max) return { visible: [...refs], truncatedCount: 0, warningCode: null }
  return {
    visible: refs.slice(0, max),
    truncatedCount: refs.length - max,
    warningCode: code,
  }
}

/**
 * 隐藏实体过滤：hidden ids 既不出现在结果里，也不返回“hiddenTotal”类可推断计数；
 * 调用方只能拿到 visible 数量与一个通用能力限制 warning 标志。
 */
export function filterHiddenTrizDlEntities<T extends { entityId: string }>(
  items: readonly T[],
  hiddenIds: ReadonlySet<string>,
): { visible: T[]; hasHidden: boolean } {
  const visible = items.filter((i) => !hiddenIds.has(i.entityId))
  return { visible, hasHidden: visible.length !== items.length }
}

// ---------------------------------------------------------------------------
// 稳定排序（列表页 tie-breaker，方向无关）
// ---------------------------------------------------------------------------

const TRIZ_DL_POSTURE_ORDER: Record<TrizDlPosture, number> = {
  blocked: 0,
  in_progress: 1,
  awaiting_verification: 2,
  awaiting_apply: 3,
  delivery_linked: 4,
  verified_ineffective: 5,
  verified_effective: 6,
  source_stale: 7,
  superseded: 8,
}

/** 列表稳定排序：posture 优先级 → updatedAt 降序 → itemId 升序（tie-breaker）。 */
export function sortTrizDlItems<
  T extends Pick<TrizDlClosedLoopItem, 'posture' | 'updatedAt' | 'itemId'>,
>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const pa = TRIZ_DL_POSTURE_ORDER[a.posture]
    const pb = TRIZ_DL_POSTURE_ORDER[b.posture]
    if (pa !== pb) return pa - pb
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1
    return a.itemId.localeCompare(b.itemId)
  })
}

// ---------------------------------------------------------------------------
// API 响应信封与 tab 分组（task 10.1/10.2）
// ---------------------------------------------------------------------------

export interface TrizDlSummaryResponse {
  data: TrizDlClosedLoopSummary
}

export interface TrizDlListResponse {
  data: TrizDlClosedLoopItem[]
  meta: { page: number; perPage: number; total: number }
}

export interface TrizDlDetailResponse {
  data: TrizDlClosedLoopItem & {
    entitySummaries: TrizDlAuthorizedEntitySummary[]
    contextSummaries: TrizDlAuthorizedEntitySummary[]
    linkMode: TrizDlLinkMode
    legacyUnlinked: boolean
  }
}

/** 决策中心交付闭环视图的四个分组 tab。 */
export const TRIZ_DL_TABS = [
  'delivery_in_progress',
  'awaiting_verification',
  'verified',
  'needs_review',
] as const
export type TrizDlTab = (typeof TRIZ_DL_TABS)[number]

/** tab → postures 映射（投影分组唯一口径；未知值安全回退到 needs_review 由 UI 处理）。 */
export const TRIZ_DL_TAB_POSTURES: Record<TrizDlTab, readonly TrizDlPosture[]> = {
  delivery_in_progress: ['blocked', 'in_progress', 'delivery_linked'],
  awaiting_verification: ['awaiting_verification'],
  verified: ['verified_effective', 'verified_ineffective'],
  needs_review: ['source_stale', 'superseded', 'awaiting_apply'],
}

/** posture → 所属 tab；未知姿态安全回退 null（UI 不渲染，不猜测）。 */
export function trizDlPostureToTab(posture: TrizDlPosture): TrizDlTab | null {
  for (const tab of TRIZ_DL_TABS) {
    if ((TRIZ_DL_TAB_POSTURES[tab] as readonly string[]).includes(posture)) return tab
  }
  return null
}

// ---------------------------------------------------------------------------
// 运行时边界校验（task 2.2 的显式上限在运行时的执行点）
// ---------------------------------------------------------------------------

/** 校验闭环项是否满足冻结上限；返回违规描述列表（空数组=通过）。 */
export function validateTrizDlClosedLoopItemBounds(item: TrizDlClosedLoopItem): string[] {
  const errors: string[] = []
  if (item.deliveryRefs.length > TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS) {
    errors.push(`deliveryRefs 超过上限 ${TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS}`)
  }
  if (item.contextRefs.length > TRIZ_DL_MAX_CONTEXT_REFS) {
    errors.push(`contextRefs 超过上限 ${TRIZ_DL_MAX_CONTEXT_REFS}`)
  }
  for (const bad of [
    ...item.deliveryRefs.filter((r) => !TRIZ_DL_ENTITY_KINDS.includes(r.kind)),
    ...item.contextRefs.filter((r) => !TRIZ_DL_ENTITY_KINDS.includes(r.kind)),
  ]) {
    errors.push(`实体 kind 越界: ${String((bad as { kind?: unknown }).kind)}`)
  }
  for (const w of item.warningCodes) {
    if (!TRIZ_DL_WARNING_CODES.includes(w)) errors.push(`未知 warning code: ${w}`)
  }
  for (const d of item.degradedReasons) {
    if (!TRIZ_DL_DEGRADED_REASONS.includes(d)) errors.push(`未知 degraded reason: ${d}`)
  }
  const longTexts: Array<[string, string]> = [
    ['itemId', item.itemId],
    ['decisionLogId', item.decisionLogId],
  ]
  for (const [name, value] of longTexts) {
    if (value.length > TRIZ_DL_MAX_SHORT_TEXT_LENGTH) {
      errors.push(`${name} 超过文本上限 ${TRIZ_DL_MAX_SHORT_TEXT_LENGTH}`)
    }
  }
  for (const r of [...item.deliveryRefs, ...item.contextRefs]) {
    if ((r.revisionHint ?? '').length > TRIZ_DL_MAX_SHORT_TEXT_LENGTH) {
      errors.push('revisionHint 超过文本上限')
    }
  }
  return errors
}
