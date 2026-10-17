// @aiproj/types —— 资源容量预测闭环纯函数（前后端共享，零运行时依赖）。
// v3-resource-capacity-closed-loop §2.3/2.5/2.7/2.9/2.11：
//   状态迁移、expectedRevision、canonical packet 规范化与 digest、overlay 校验与
//   side-effect-free 模拟、suggestion 投影、fingerprint / idempotency / comparability。
//
// 红线：
//   - 全部为确定性纯函数：同输入必同输出；采集时间不参与语义 digest。
//   - 不重算来源业务结论，只做单位/窗口/key 对齐与有界算术。
//   - 隐藏 ref / 任意公式 / HR·财务·工时字段一律拒绝。

import type {
  ResourceCapacityLoopCanonicalPacket,
  ResourceCapacityLoopEvidenceRef,
  ResourceCapacityLoopFactState,
  ResourceCapacityLoopGranularity,
  ResourceCapacityLoopHandoffTarget,
  ResourceCapacityLoopOverlay,
  ResourceCapacityLoopPacketFact,
  ResourceCapacityLoopPacketSkillEntry,
  ResourceCapacityLoopReasonCode,
  ResourceCapacityLoopScope,
  ResourceCapacityLoopSimulationRow,
  ResourceCapacityLoopSourceSummary,
  ResourceCapacityLoopSuggestionCandidateProjection,
  ResourceCapacityLoopState,
  ResourceCapacityLoopWarningCode,
} from './resource-capacity-closed-loop.js'
import {
  RESOURCE_CAPACITY_LOOP_ALLOWED_TRANSITIONS,
  RESOURCE_CAPACITY_LOOP_BUDGETS,
  RESOURCE_CAPACITY_LOOP_DECIMAL_PRECISION,
  RESOURCE_CAPACITY_LOOP_GRANULARITIES,
  RESOURCE_CAPACITY_LOOP_OVERLAY_KINDS,
  RESOURCE_CAPACITY_LOOP_REJECTED_ACTOR_TYPES,
  RESOURCE_CAPACITY_LOOP_REASON_CODES,
  RESOURCE_CAPACITY_LOOP_STATE_VALUES,
  RESOURCE_CAPACITY_LOOP_TERMINAL_STATES,
  RESOURCE_CAPACITY_LOOP_WARNING_CODES,
} from './resource-capacity-closed-loop.js'

// ─── 稳定序列化与哈希 ────────────────────────────────────────────────────────

/** 确定性 JSON 序列化：对象键递归排序，数组保持原序（调用方负责预排序）。 */
export function stableStringifyLoop(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((v) => stableStringifyLoop(v)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringifyLoop(v)}`).join(',')}}`
}

/** FNV-1a 32 位哈希（闭环专用，低敏指纹口径）。 */
export function fnv1a32Loop(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/** 四舍五入到闭环固定精度，规范 -0 为 0。 */
export function roundLoopHours(value: number): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** RESOURCE_CAPACITY_LOOP_DECIMAL_PRECISION
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded
}

// ─── 稳定错误结果 ────────────────────────────────────────────────────────────

export interface LoopFailure {
  ok: false
  reasonCode: ResourceCapacityLoopReasonCode
  detail?: string
}

export interface LoopSuccess<T> {
  ok: true
  value: T
}

export type LoopResult<T> = LoopSuccess<T> | LoopFailure

function fail<T>(reasonCode: ResourceCapacityLoopReasonCode, detail?: string): LoopResult<T> {
  return { ok: false, reasonCode, detail }
}

function succeed<T>(value: T): LoopResult<T> {
  return { ok: true, value }
}

// ─── §2.3 状态迁移 / revision / actor ──────────────────────────────────────

export interface LoopTransitionInput {
  from: ResourceCapacityLoopState
  to: ResourceCapacityLoopState
}

/** 判定生命周期迁移是否合法；closed/cancelled 无出边，closed 重开必拒。 */
export function evaluateLoopTransition(
  input: LoopTransitionInput,
): LoopResult<ResourceCapacityLoopState> {
  if (!RESOURCE_CAPACITY_LOOP_STATE_VALUES.includes(input.from))
    return fail('RCCL_BUDGET_EXCEEDED', `未知状态 ${input.from}`)
  if (!RESOURCE_CAPACITY_LOOP_STATE_VALUES.includes(input.to))
    return fail('RCCL_BUDGET_EXCEEDED', `未知状态 ${input.to}`)
  const allowed = RESOURCE_CAPACITY_LOOP_ALLOWED_TRANSITIONS[input.from]
  if (!allowed.includes(input.to)) {
    return fail('RCCL_REVISION_CONFLICT', `非法迁移 ${input.from} → ${input.to}`)
  }
  return succeed(input.to)
}

/** 乐观锁：expected 与 current 不一致即冲突。 */
export function checkExpectedRevision(expected: number, current: number): LoopResult<number> {
  if (!Number.isInteger(expected) || expected < 1)
    return fail('RCCL_BUDGET_EXCEEDED', 'expectedRevision 必须为正整数')
  if (expected !== current) return fail('RCCL_REVISION_CONFLICT', `revision 已推进到 ${current}`)
  return succeed(current)
}

/** 终态判定。 */
export function isTerminalLoopState(state: ResourceCapacityLoopState): boolean {
  return RESOURCE_CAPACITY_LOOP_TERMINAL_STATES.includes(state)
}

/**
 * selection 只接受人类 actor。
 * rule/plugin/ai/scheduled_job/confidence_threshold 一律拒绝。
 */
export function rejectNonHumanActor(actorType: string): LoopResult<'human_user'> {
  if ((RESOURCE_CAPACITY_LOOP_REJECTED_ACTOR_TYPES as readonly string[]).includes(actorType)) {
    return fail('RCCL_NON_HUMAN_ACTOR_REJECTED', `非人类 actor 被拒绝：${actorType}`)
  }
  if (actorType !== 'human_user') {
    return fail('RCCL_NON_HUMAN_ACTOR_REJECTED', '未知 actor 类型被拒绝')
  }
  return succeed('human_user')
}

// ─── §2.5 canonical packet 规范化与 digest ─────────────────────────────────

/** 把任意日期对齐到粒度起点（day=当日；week=周一；month=1 日），返回 YYYY-MM-DD。 */
export function alignBucketDate(
  dateIso: string,
  granularity: ResourceCapacityLoopGranularity,
): string {
  const ms = Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(ms)) return '1970-01-01'
  const d = new Date(ms)
  if (granularity === RESOURCE_CAPACITY_LOOP_GRANULARITIES.MONTH) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
  }
  if (granularity === RESOURCE_CAPACITY_LOOP_GRANULARITIES.WEEK) {
    const day = d.getUTCDay()
    const diff = day === 0 ? 6 : day - 1
    d.setUTCDate(d.getUTCDate() - diff)
  }
  return d.toISOString().slice(0, 10)
}

const DIMENSION_ORDER: Record<ResourceCapacityLoopPacketFact['dimension'], number> = {
  role: 0,
  skill: 1,
  project: 2,
}

function compareFacts(
  a: ResourceCapacityLoopPacketFact,
  b: ResourceCapacityLoopPacketFact,
): number {
  return (
    DIMENSION_ORDER[a.dimension] - DIMENSION_ORDER[b.dimension] ||
    (a.dimensionKey < b.dimensionKey ? -1 : a.dimensionKey > b.dimensionKey ? 1 : 0) ||
    (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0)
  )
}

/** 规范化单条 fact：bucket 对齐粒度、数值限精、demand/allocation 恒分离。 */
export function canonicalizeFact(
  raw: Omit<ResourceCapacityLoopPacketFact, 'gapHours'> & { gapHours?: number },
  granularity: ResourceCapacityLoopGranularity,
): ResourceCapacityLoopPacketFact {
  const allocated = roundLoopHours(raw.allocatedHours)
  const demand = roundLoopHours(raw.demandHours)
  const available = roundLoopHours(raw.availableCapacityHours)
  const remaining = roundLoopHours(raw.remainingCapacityHours)
  const gap =
    raw.gapHours !== undefined
      ? roundLoopHours(raw.gapHours)
      : roundLoopHours(Math.max(0, demand - allocated))
  return {
    dimension: raw.dimension,
    dimensionKey: raw.dimensionKey.trim().toLowerCase(),
    bucket: alignBucketDate(raw.bucket, granularity),
    demandHours: demand,
    allocatedHours: allocated,
    availableCapacityHours: available,
    remainingCapacityHours: remaining,
    gapHours: gap,
    factState: raw.factState,
  }
}

/** 技能 key 规范化：trim + 小写 + 压缩内部空白；原标签由调用方另行保留。 */
export function normalizedSkillKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

export interface CanonicalizePacketInput {
  scope: ResourceCapacityLoopScope
  facts: Array<Omit<ResourceCapacityLoopPacketFact, 'gapHours'> & { gapHours?: number }>
  skillEntries: ResourceCapacityLoopPacketSkillEntry[]
  sources: ResourceCapacityLoopSourceSummary[]
  evidenceRefs: ResourceCapacityLoopEvidenceRef[]
}

/**
 * canonical 化五类来源投影：
 * 排序、去重、精度归一、required 来源失败 → readyForSimulation=false。
 */
export function canonicalizePacket(
  input: CanonicalizePacketInput,
): LoopResult<ResourceCapacityLoopCanonicalPacket> {
  if (input.facts.length > RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_FACTS_PER_BASELINE) {
    return fail('RCCL_PAYLOAD_TOO_LARGE', `facts=${input.facts.length} 超预算`)
  }
  if (input.evidenceRefs.length > RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_REFS_PER_SNAPSHOT) {
    return fail('RCCL_PAYLOAD_TOO_LARGE', `evidenceRefs=${input.evidenceRefs.length} 超预算`)
  }

  const seen = new Set<string>()
  const facts: ResourceCapacityLoopPacketFact[] = []
  for (const raw of input.facts) {
    const fact = canonicalizeFact(raw, input.scope.granularity)
    const key = `${fact.dimension}:${fact.dimensionKey}:${fact.bucket}`
    if (seen.has(key)) continue
    seen.add(key)
    facts.push(fact)
  }
  facts.sort(compareFacts)

  const skillEntries = [...input.skillEntries]
    .map((e) => ({
      ...e,
      normalizedSkillKey: normalizedSkillKey(e.normalizedSkillKey),
      originalLabels: [...e.originalLabels].sort(),
    }))
    .sort((a, b) =>
      a.normalizedSkillKey < b.normalizedSkillKey
        ? -1
        : a.normalizedSkillKey > b.normalizedSkillKey
          ? 1
          : 0,
    )

  const sources = [...input.sources]
    .map((s) => ({ ...s, warnings: [...s.warnings] }))
    .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0))

  const evidenceRefs = [...input.evidenceRefs]
    .map((e) => ({ ...e }))
    .sort((a, b) => (a.evidenceKey < b.evidenceKey ? -1 : a.evidenceKey > b.evidenceKey ? 1 : 0))

  const warnings = collectPacketWarnings(sources, facts)

  // required 来源失败/受限/过期 → 不可模拟（fail closed）。
  const requiredBroken = sources.some(
    (s) => s.required && (s.factState !== 'visible' || s.freshness.stale),
  )
  const readyForSimulation = !requiredBroken

  const packet: ResourceCapacityLoopCanonicalPacket = {
    schemaVersion: 'resource-capacity-loop@1',
    scope: {
      granularity: input.scope.granularity,
      windowStart: alignBucketDate(input.scope.windowStart, input.scope.granularity),
      windowEnd: alignBucketDate(input.scope.windowEnd, input.scope.granularity),
      projectIds: [...input.scope.projectIds].sort((a, b) => a - b),
    },
    unit: 'hours',
    facts,
    skillEntries,
    sources,
    evidenceRefs,
    warnings,
    readyForSimulation,
  }
  return succeed(packet)
}

function collectPacketWarnings(
  sources: readonly ResourceCapacityLoopSourceSummary[],
  facts: readonly ResourceCapacityLoopPacketFact[],
): ResourceCapacityLoopWarningCode[] {
  const out = new Set<ResourceCapacityLoopWarningCode>()
  for (const s of sources) {
    if (s.freshness.stale) out.add(RESOURCE_CAPACITY_LOOP_WARNING_CODES.SOURCE_STALE)
    if (s.factState === 'redacted') out.add(RESOURCE_CAPACITY_LOOP_WARNING_CODES.PARTIAL_VISIBILITY)
    if (s.truncated) out.add(RESOURCE_CAPACITY_LOOP_WARNING_CODES.SOURCE_TRUNCATED)
    if (s.factState === 'missing' && !s.required) {
      out.add(RESOURCE_CAPACITY_LOOP_WARNING_CODES.SOURCE_DEGRADED)
    }
    for (const w of s.warnings) out.add(w)
  }
  // fact 级受限/过期/缺失同样显式可见，绝不静默补零。
  for (const f of facts) {
    if (f.factState === 'redacted') out.add(RESOURCE_CAPACITY_LOOP_WARNING_CODES.PARTIAL_VISIBILITY)
    if (f.factState === 'stale') out.add(RESOURCE_CAPACITY_LOOP_WARNING_CODES.SOURCE_STALE)
    if (f.factState === 'missing') out.add(RESOURCE_CAPACITY_LOOP_WARNING_CODES.PARTIAL_VISIBILITY)
  }
  return [...out].sort()
}

/** 内容 digest：排除任何非语义字段——调用方不得把 collectedAt 混入 packet 再求 digest。 */
export function computePacketDigest(packet: ResourceCapacityLoopCanonicalPacket): string {
  return fnv1a32Loop(stableStringifyLoop(packet))
}

// ─── fingerprint 家族（§2.11 一并实现）─────────────────────────────────────

export interface BaselineFingerprintInput {
  packetDigest: string
  sourceSignaturesHash: string
  permissionFingerprint: string
  scope: ResourceCapacityLoopScope
}

/** baselineDigest = packet digest ⊕ 来源签名 ⊕ 权限指纹 ⊕ scope/window/granularity。 */
export function computeBaselineDigest(input: BaselineFingerprintInput): string {
  return fnv1a32Loop(
    stableStringifyLoop({
      kind: 'baseline',
      packetDigest: input.packetDigest,
      sourceSignaturesHash: input.sourceSignaturesHash,
      permissionFingerprint: input.permissionFingerprint,
      granularity: input.scope.granularity,
      windowStart: input.scope.windowStart,
      windowEnd: input.scope.windowEnd,
      projectIds: [...input.scope.projectIds].sort((a, b) => a - b),
    }),
  )
}

export interface SimulationFingerprintInput {
  baselineDigest: string
  scenarioRevision: number
  overlayDigest: string
  engineVersion: string
}

/** simulationDigest 在 baseline 之上再绑情景修订、overlay digest 与引擎版本。 */
export function computeSimulationDigest(input: SimulationFingerprintInput): string {
  return fnv1a32Loop(stableStringifyLoop({ kind: 'simulation', ...input }))
}

export interface SelectionFingerprintInput {
  simulationDigest: string
  actorUserId: number
  acknowledgedWarnings: ResourceCapacityLoopWarningCode[]
  expiresAt: string
  loopRevision: number
}

/** selectionFingerprint 绑定模拟结果、选择人、warning 承诺、过期与 loop 修订。 */
export function computeSelectionFingerprint(input: SelectionFingerprintInput): string {
  return fnv1a32Loop(
    stableStringifyLoop({
      kind: 'selection',
      simulationDigest: input.simulationDigest,
      actorUserId: input.actorUserId,
      acknowledgedWarnings: [...input.acknowledgedWarnings].sort(),
      expiresAt: input.expiresAt,
      loopRevision: input.loopRevision,
    }),
  )
}

/** handoff 幂等键哈希：org + selectionFingerprint + target + idempotency key。 */
export function computeHandoffIdempotencyHash(input: {
  organizationId: number
  selectionFingerprint: string
  target: ResourceCapacityLoopHandoffTarget
  idempotencyKey: string
}): string {
  return fnv1a32Loop(stableStringifyLoop({ kind: 'handoff', ...input }))
}

// ─── §2.7 overlay 规范化、校验与模拟 ───────────────────────────────────────

export interface OverlayValidationContext {
  visibleProjectIds: readonly number[]
  authorizedPreviewRefIds: readonly string[]
  knownRequirementRefIds: readonly string[]
  knownRoleKeys: readonly string[]
  knownSkillKeys: readonly string[]
}

function isPlainObjectWithKeys(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const allowed = new Set(keys)
  return Object.keys(value).every((k) => allowed.has(k))
}

/**
 * 封闭 overlay 校验：
 * - 未知 kind / 未知字段 → 拒绝；
 * - 隐藏项目、未授权 preview ref、未知 requirement/role/skill ref → 拒绝；
 * - capacity-delta 的 role 与 normalizedSkillKey 至少给一个且不得同时为空；
 * - deltaHours 必须有限且绝对值 ≤ 10000。
 */
export function validateOverlay(
  raw: unknown,
  ctx: OverlayValidationContext,
): LoopResult<ResourceCapacityLoopOverlay> {
  if (typeof raw !== 'object' || raw === null)
    return fail('RCCL_BUDGET_EXCEEDED', 'overlay 必须是对象')
  const kind = (raw as { kind?: unknown }).kind
  if (
    typeof kind !== 'string' ||
    !(RESOURCE_CAPACITY_LOOP_OVERLAY_KINDS as readonly string[]).includes(kind)
  ) {
    return fail('RCCL_BUDGET_EXCEEDED', `未知 overlay kind：${String(kind)}`)
  }

  if (kind === 'project-scope') {
    if (!isPlainObjectWithKeys(raw, ['kind', 'includeProjectIds', 'excludeProjectIds'])) {
      return fail('RCCL_BUDGET_EXCEEDED', 'project-scope 含未知字段')
    }
    const o = raw as unknown as { includeProjectIds: unknown; excludeProjectIds: unknown }
    if (
      !isArrayWithin(o.includeProjectIds, RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_PROJECT_SCOPE) ||
      !isArrayWithin(o.excludeProjectIds, RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_PROJECT_SCOPE)
    ) {
      return fail('RCCL_PAYLOAD_TOO_LARGE', 'project-scope 数组超界')
    }
    const visible = new Set(ctx.visibleProjectIds)
    for (const id of [...castNumbers(o.includeProjectIds), ...castNumbers(o.excludeProjectIds)]) {
      if (!visible.has(id)) return fail('RCCL_PERMISSION_CHANGED', `项目不可见或不存在：${id}`)
    }
    return succeed({
      kind,
      includeProjectIds: castNumbers(o.includeProjectIds),
      excludeProjectIds: castNumbers(o.excludeProjectIds),
    })
  }

  if (kind === 'demand-shift') {
    if (
      !isPlainObjectWithKeys(raw, [
        'kind',
        'projectId',
        'requirementRefId',
        'fromBucket',
        'toBucket',
      ])
    ) {
      return fail('RCCL_BUDGET_EXCEEDED', 'demand-shift 含未知字段')
    }
    const o = raw as unknown as {
      projectId: number
      requirementRefId: string
      fromBucket: string
      toBucket: string
    }
    if (!ctx.visibleProjectIds.includes(o.projectId))
      return fail('RCCL_PERMISSION_CHANGED', '项目不可见')
    if (!ctx.knownRequirementRefIds.includes(o.requirementRefId)) {
      return fail('RCCL_BUDGET_EXCEEDED', 'requirement 引用不存在')
    }
    if (!isValidDateString(o.fromBucket) || !isValidDateString(o.toBucket)) {
      return fail('RCCL_BUDGET_EXCEEDED', 'bucket 日期非法')
    }
    return succeed({
      kind,
      projectId: o.projectId,
      requirementRefId: o.requirementRefId,
      fromBucket: o.fromBucket.slice(0, 10),
      toBucket: o.toBucket.slice(0, 10),
    })
  }

  if (kind === 'capacity-delta') {
    if (
      !isPlainObjectWithKeys(raw, ['kind', 'role', 'normalizedSkillKey', 'bucket', 'deltaHours'])
    ) {
      return fail('RCCL_BUDGET_EXCEEDED', 'capacity-delta 含未知字段')
    }
    const o = raw as unknown as {
      role: string | null
      normalizedSkillKey: string | null
      bucket: string
      deltaHours: number
    }
    const hasRole = typeof o.role === 'string' && o.role.length > 0
    const hasSkill = typeof o.normalizedSkillKey === 'string' && o.normalizedSkillKey.length > 0
    if (hasRole === hasSkill)
      return fail('RCCL_BUDGET_EXCEEDED', 'capacity-delta 须恰好指定 role 或 skill 之一')
    if (hasRole && !ctx.knownRoleKeys.includes(normalizedSkillKey(o.role as string))) {
      return fail('RCCL_BUDGET_EXCEEDED', 'role 键不在当前可见集内')
    }
    if (
      hasSkill &&
      !ctx.knownSkillKeys.includes(normalizedSkillKey(o.normalizedSkillKey as string))
    ) {
      return fail('RCCL_PERMISSION_CHANGED', 'skill 键不可见')
    }
    if (!isValidDateString(o.bucket)) return fail('RCCL_BUDGET_EXCEEDED', 'bucket 日期非法')
    if (
      typeof o.deltaHours !== 'number' ||
      !Number.isFinite(o.deltaHours) ||
      Math.abs(o.deltaHours) > 10000
    ) {
      return fail('RCCL_BUDGET_EXCEEDED', 'deltaHours 越界')
    }
    return succeed({
      kind,
      role: hasRole ? normalizedSkillKey(o.role as string) : null,
      normalizedSkillKey: hasSkill ? normalizedSkillKey(o.normalizedSkillKey as string) : null,
      bucket: o.bucket.slice(0, 10),
      deltaHours: roundLoopHours(o.deltaHours),
    })
  }

  // allocation-preview-ref
  if (!isPlainObjectWithKeys(raw, ['kind', 'previewRefId'])) {
    return fail('RCCL_BUDGET_EXCEEDED', 'allocation-preview-ref 含未知字段')
  }
  const o = raw as unknown as { previewRefId: string }
  if (typeof o.previewRefId !== 'string' || !ctx.authorizedPreviewRefIds.includes(o.previewRefId)) {
    return fail('RCCL_PERMISSION_CHANGED', 'preview 引用不可见或已失效')
  }
  return succeed({ kind: 'allocation-preview-ref', previewRefId: o.previewRefId })
}

function isArrayWithin(v: unknown, max: number): v is unknown[] {
  return Array.isArray(v) && v.length <= max
}

function castNumbers(v: unknown): number[] {
  return (v as unknown[]).filter((x): x is number => typeof x === 'number' && Number.isInteger(x))
}

function isValidDateString(v: unknown): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v))
}

/** 批量校验并规范化 overlay 列表（含数量上限）。 */
export function validateOverlays(
  raws: readonly unknown[],
  ctx: OverlayValidationContext,
): LoopResult<ResourceCapacityLoopOverlay[]> {
  if (raws.length > RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_OVERLAYS_PER_SCENARIO) {
    return fail('RCCL_PAYLOAD_TOO_LARGE', `overlay 数量 ${raws.length} 超上限`)
  }
  const out: ResourceCapacityLoopOverlay[] = []
  for (const raw of raws) {
    const r = validateOverlay(raw, ctx)
    if (!r.ok) return r
    out.push(r.value)
  }
  return succeed(out)
}

/** overlay digest：先按稳定序列化排序再哈希，保证顺序无关的等价语义可复现。 */
export function computeOverlayDigest(overlays: readonly ResourceCapacityLoopOverlay[]): string {
  const sorted = [...overlays].sort((a, b) =>
    stableStringifyLoop(a) < stableStringifyLoop(b) ? -1 : 1,
  )
  return fnv1a32Loop(stableStringifyLoop(sorted))
}

export interface SimulateScenarioOutput {
  rows: ResourceCapacityLoopSimulationRow[]
  gapDeltaHours: number
  contentionDeltaCount: number
  warnings: ResourceCapacityLoopWarningCode[]
}

/**
 * side-effect-free 情景计算：以 baseline packet 为底稿，
 * 应用封闭 overlay 后输出同单位/粒度的行与缺口差值。绝不触碰数据库事实。
 * contentionDeltaCount 由调用方按冲突来源权威结果传入基线计数后相减得到（此处恒 0 占位）。
 */
export function simulateScenario(
  packet: ResourceCapacityLoopCanonicalPacket,
  overlays: readonly ResourceCapacityLoopOverlay[],
): LoopResult<SimulateScenarioOutput> {
  if (!packet.readyForSimulation) return fail('RCCL_SOURCE_REQUIRED_FAILED', 'baseline 未就绪')

  const warnings = new Set<ResourceCapacityLoopWarningCode>()
  let rows: ResourceCapacityLoopSimulationRow[] = packet.facts.map((f) => ({
    ...f,
    hypothetical: false,
  }))

  // project-scope：过滤可见范围（include 白名单优先，再应用 exclude）。
  for (const o of overlays) {
    if (o.kind === 'project-scope') {
      const include =
        o.includeProjectIds.length > 0 ? new Set(o.includeProjectIds.map(String)) : null
      const exclude = new Set(o.excludeProjectIds.map(String))
      rows = rows.filter((r) => {
        if (r.dimension !== 'project') return true
        if (exclude.has(r.dimensionKey)) return false
        if (include && !include.has(r.dimensionKey)) return false
        return true
      })
    }
  }

  // demand-shift：在行间搬移需求引用（不改任务/需求事实）。
  for (const o of overlays) {
    if (o.kind !== 'demand-shift') continue
    const fromIdx = rows.findIndex(
      (r) =>
        r.dimension === 'project' &&
        r.dimensionKey === String(o.projectId) &&
        r.bucket === o.fromBucket,
    )
    if (fromIdx >= 0) {
      const fromRow = rows[fromIdx]!
      // 源桶需求清零（假设态），目标桶叠加该需求引用；任务/需求事实不受影响。
      const movedDemand = fromRow.demandHours
      rows[fromIdx] = recomputeGap({ ...fromRow, demandHours: 0, hypothetical: true })
      const toIdx = rows.findIndex(
        (r) =>
          r.dimension === 'project' &&
          r.dimensionKey === String(o.projectId) &&
          r.bucket === o.toBucket,
      )
      if (toIdx >= 0) {
        const toRow = rows[toIdx]!
        rows[toIdx] = recomputeGap({
          ...toRow,
          demandHours: roundLoopHours(toRow.demandHours + movedDemand),
          hypothetical: true,
        })
      } else {
        rows.push(
          recomputeGap({
            ...rows[fromIdx],
            bucket: o.toBucket,
            demandHours: movedDemand,
            hypothetical: true,
          }),
        )
      }
      warnings.add(RESOURCE_CAPACITY_LOOP_WARNING_CODES.OVERLAY_HYPOTHETICAL)
    }
  }

  // capacity-delta：按 role/skill + bucket 增减假设容量。
  for (const o of overlays) {
    if (o.kind !== 'capacity-delta') continue
    const idx = rows.findIndex(
      (r) =>
        r.dimension === (o.role !== null ? 'role' : 'skill') &&
        r.dimensionKey === (o.role ?? o.normalizedSkillKey ?? '') &&
        r.bucket === o.bucket,
    )
    if (idx >= 0) {
      const row = rows[idx]!
      rows[idx] = recomputeGap({
        ...row,
        availableCapacityHours: roundLoopHours(row.availableCapacityHours + o.deltaHours),
        remainingCapacityHours: roundLoopHours(row.remainingCapacityHours + o.deltaHours),
        hypothetical: true,
      })
    } else {
      rows.push(
        recomputeGap({
          dimension: o.role !== null ? 'role' : 'skill',
          dimensionKey: (o.role ?? o.normalizedSkillKey ?? '').toLowerCase(),
          bucket: o.bucket,
          demandHours: 0,
          allocatedHours: 0,
          availableCapacityHours: roundLoopHours(o.deltaHours),
          remainingCapacityHours: roundLoopHours(o.deltaHours),
          gapHours: 0,
          factState: 'visible',
          hypothetical: true,
        }),
      )
    }
    warnings.add(RESOURCE_CAPACITY_LOOP_WARNING_CODES.OVERLAY_HYPOTHETICAL)
  }

  // allocation-preview-ref：引用既有预览的预期影响（此处仅标记 hypothetical，具体投影由服务层注入）。
  for (const o of overlays) {
    void o
    if (o.kind === 'allocation-preview-ref') {
      warnings.add(RESOURCE_CAPACITY_LOOP_WARNING_CODES.OVERLAY_HYPOTHETICAL)
    }
  }

  rows.sort(compareFacts)

  const baselineGap = packet.facts.reduce((acc, f) => acc + f.gapHours, 0)
  const simulatedGap = rows.reduce((acc, f) => acc + f.gapHours, 0)

  return succeed({
    rows,
    gapDeltaHours: roundLoopHours(simulatedGap - baselineGap),
    contentionDeltaCount: 0,
    warnings: [...warnings].sort(),
  })
}

function recomputeGap(row: ResourceCapacityLoopSimulationRow): ResourceCapacityLoopSimulationRow {
  return { ...row, gapHours: roundLoopHours(Math.max(0, row.demandHours - row.allocatedHours)) }
}

// ─── §2.9 allocation suggestion 投影 ───────────────────────────────────────

export interface CandidateInput {
  candidateRefId: string
  resourceId: number
  resourceName: string
  matcherProvenance: string
  existingScore: number | null
  matchedSkillKeys: string[]
  missingSkillKeys: string[]
  /** 每桶可用小时（来自既有剩余容量/可用性权威结果）。 */
  availableHoursPerBucket: Array<{ bucket: string; hours: number }>
  availabilityConflictBuckets: string[]
  contentionSeverity: 'critical' | 'high' | 'medium' | 'low' | 'none'
  freshnessStale: boolean
  hidden: boolean
  evidenceRefs: ResourceCapacityLoopEvidenceRef[]
}

export interface SuggestionProjectionOutput {
  unmetDimension: 'role' | 'skill'
  unmetDimensionKey: string
  unmetBuckets: Array<{ bucket: string; unmetHours: number }>
  candidates: Array<{
    projection: ResourceCapacityLoopSuggestionCandidateProjection
  }>
  degraded: boolean
  advisoryOnly: true
  applied: false
  confirmationRequired: true
}

/**
 * 把既有候选结果对齐到 unmet gap bucket：
 * - 只消费权威候选输入，不重排、不出新总分、不选 winner；
 * - hidden=true 的候选整体剔除且不泄露存在性；
 * - covered/uncovered 按 bucket 有界计算。
 */
export function projectAllocationSuggestion(
  packet: ResourceCapacityLoopCanonicalPacket,
  dimension: 'role' | 'skill',
  dimensionKey: string,
  candidates: readonly CandidateInput[],
): LoopResult<SuggestionProjectionOutput> {
  const key = normalizedSkillKey(dimensionKey)
  const unmetRows = packet.facts.filter(
    (f) => f.dimension === dimension && f.dimensionKey === key && f.gapHours > 0,
  )
  if (unmetRows.length === 0) return fail('RCCL_BUDGET_EXCEEDED', '该维度无未满足缺口')

  const unmetBuckets = unmetRows.map((r) => ({ bucket: r.bucket, unmetHours: r.gapHours }))
  const degraded =
    candidates.some((c) => c.freshnessStale) || packet.warnings.includes('CANDIDATE_DEGRADED')

  const projected = candidates
    .filter((c) => !c.hidden)
    .map((c) => {
      const covered: Array<{ bucket: string; coveredHours: number }> = []
      const uncovered: Array<{ bucket: string; uncoveredHours: number }> = []
      for (const ub of unmetBuckets) {
        const conflict = c.availabilityConflictBuckets.includes(ub.bucket)
        const avail = c.availableHoursPerBucket.find((h) => h.bucket === ub.bucket)
        const coverable =
          conflict || avail === undefined ? 0 : roundLoopHours(Math.min(avail.hours, ub.unmetHours))
        covered.push({ bucket: ub.bucket, coveredHours: coverable })
        uncovered.push({
          bucket: ub.bucket,
          uncoveredHours: roundLoopHours(ub.unmetHours - coverable),
        })
      }
      return {
        projection: {
          candidateRefId: c.candidateRefId,
          resourceId: c.resourceId,
          resourceName: c.resourceName,
          matcherProvenance: c.matcherProvenance,
          existingScore: c.existingScore,
          matchedSkillKeys: [...c.matchedSkillKeys].map(normalizedSkillKey).sort(),
          missingSkillKeys: [...c.missingSkillKeys].map(normalizedSkillKey).sort(),
          coveredHoursPerBucket: covered,
          uncoveredHoursPerBucket: uncovered,
          availabilityConflictBuckets: [...c.availabilityConflictBuckets].sort(),
          contentionSeverity: c.contentionSeverity,
          freshnessStale: c.freshnessStale,
          evidenceRefs: [...c.evidenceRefs].sort((a, b) =>
            a.evidenceKey < b.evidenceKey ? -1 : 1,
          ),
        },
      }
    })

  return succeed({
    unmetDimension: dimension,
    unmetDimensionKey: key,
    unmetBuckets,
    candidates: projected,
    degraded,
    advisoryOnly: true,
    applied: false,
    confirmationRequired: true,
  })
}

// ─── §2.11 comparability / observed delta / forecast error ────────────────

export interface ObservationCompareInput {
  baselineScope: ResourceCapacityLoopScope
  observationScope: ResourceCapacityLoopScope
  baselineMetricVersion: string
  observationMetricVersion: string
  expectedRows: ReadonlyArray<{
    dimension: ResourceCapacityLoopPacketFact['dimension']
    dimensionKey: string
    bucket: string
    gapHours: number
  }>
  observedRows: ReadonlyArray<{
    dimension: ResourceCapacityLoopPacketFact['dimension']
    dimensionKey: string
    bucket: string
    observedGapHours: number
    observedAllocatedHours: number
    factState: ResourceCapacityLoopFactState
  }>
}

export interface ObservationCompareOutput {
  comparability: { comparable: boolean; reasonCodes: ResourceCapacityLoopReasonCode[] }
  comparisons: Array<{
    dimension: ResourceCapacityLoopPacketFact['dimension']
    dimensionKey: string
    bucket: string
    baselineGapHours: number | null
    expectedGapHours: number | null
    observedGapHours: number | null
    forecastErrorHours: number | null
    unresolved: boolean
  }>
  totalForecastErrorHours: number
}

/**
 * 同口径复测比较：
 * - metricVersion/window/granularity/scope 任一失配 → not-comparable（fail closed）；
 * - 输出只表述「观察到的差值」，不产生因果结论。
 */
export function compareObservation(input: ObservationCompareInput): ObservationCompareOutput {
  const reasons: ResourceCapacityLoopReasonCode[] = []
  if (input.baselineMetricVersion !== input.observationMetricVersion) {
    reasons.push(RESOURCE_CAPACITY_LOOP_REASON_CODES.NOT_COMPARABLE_METRIC_VERSION)
  }
  const bs = input.baselineScope
  const os = input.observationScope
  if (bs.windowStart !== os.windowStart || bs.windowEnd !== os.windowEnd) {
    reasons.push(RESOURCE_CAPACITY_LOOP_REASON_CODES.NOT_COMPARABLE_WINDOW)
  }
  if (bs.granularity !== os.granularity) {
    reasons.push(RESOURCE_CAPACITY_LOOP_REASON_CODES.NOT_COMPARABLE_GRANULARITY)
  }
  const bp = [...bs.projectIds].sort((a, b) => a - b)
  const op = [...os.projectIds].sort((a, b) => a - b)
  if (stableStringifyLoop(bp) !== stableStringifyLoop(op)) {
    reasons.push(RESOURCE_CAPACITY_LOOP_REASON_CODES.NOT_COMPARABLE_SCOPE)
  }

  const comparable = reasons.length === 0
  const expectedMap = new Map(
    input.expectedRows.map((r) => [`${r.dimension}:${r.dimensionKey}:${r.bucket}`, r.gapHours]),
  )
  const observedMap = new Map(
    input.observedRows.map((r) => [
      `${r.dimension}:${r.dimensionKey}:${r.bucket}`,
      { gap: r.observedGapHours, state: r.factState },
    ]),
  )

  const keys = new Set<string>([...expectedMap.keys(), ...observedMap.keys()])
  const comparisons: ObservationCompareOutput['comparisons'] = []
  let totalError = 0
  for (const key of keys) {
    const [dimension, dimensionKey, bucket] = key.split(':') as [
      ResourceCapacityLoopPacketFact['dimension'],
      string,
      string,
    ]
    const baselineGap = expectedMap.get(key) ?? null
    const observed = comparable ? (observedMap.get(key) ?? null) : null
    const observedGap =
      observed && observed.state !== 'missing' ? roundLoopHours(observed.gap) : null
    const expectedGap = baselineGap !== null ? roundLoopHours(baselineGap) : null
    const forecastError =
      comparable && observedGap !== null && expectedGap !== null
        ? roundLoopHours(observedGap - expectedGap)
        : null
    if (forecastError !== null) totalError += forecastError
    comparisons.push({
      dimension,
      dimensionKey,
      bucket,
      baselineGapHours: expectedGap,
      expectedGapHours: expectedGap,
      observedGapHours: observedGap,
      forecastErrorHours: forecastError,
      unresolved: observedGap === null || observed?.state === 'stale',
    })
  }
  comparisons.sort(
    (a, b) =>
      DIMENSION_ORDER[a.dimension] - DIMENSION_ORDER[b.dimension] ||
      (a.dimensionKey < b.dimensionKey ? -1 : a.dimensionKey > b.dimensionKey ? 1 : 0) ||
      (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0),
  )

  return {
    comparability: { comparable, reasonCodes: reasons },
    comparisons,
    totalForecastErrorHours: roundLoopHours(totalError),
  }
}
