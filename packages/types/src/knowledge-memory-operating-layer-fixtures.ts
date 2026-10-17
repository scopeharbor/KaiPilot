/**
 * v3-knowledge-memory-operating-layer —— 共享契约 fixture builders。
 *
 * 2500 对象 + 跨租 / 隐藏 / 敏感诱饵 + bounded observation windows 的确定性 fixture。
 *
 * 纪律：
 * - 闭集状态词表与公开契约一致。
 * - 时间戳使用显式 nowMs 注入；保持纯函数确定性。
 * - 敏感诱饵（正文 / memory summary / prompt / token / 绝对路径）只作低敏扫描测试样本，
 *   永远不得进入生产 DTO。
 */

import {
  KNOWLEDGE_MEMORY_OPERATING_KINDS,
  type CopilotMemoryOperatingProjection,
  type KnowledgeItemOperatingProjection,
  type KnowledgeMemoryOperatingItem,
  type KnowledgeMemoryOperatingKind,
  type KnowledgeMemoryOperatingScope,
  type KnowledgeMemoryOperatingStatus,
  type KnowledgeMemoryOperatingSurface,
  type KnowledgeMemoryOperatingVisibility,
  type RetrievalSignalOperatingProjection,
  type SkillKnowledgeDraftOperatingProjection,
  defaultSurfaceForKind,
  deriveCopilotMemoryAttention,
  deriveKnowledgeItemAttention,
  deriveRetrievalSignalAttention,
  deriveSkillKnowledgeDraftAttention,
  makeScopedRef,
  priorityForStatus,
} from './knowledge-memory-operating-layer.js'

// ── 1. 时间 / 确定性常量 ──────────────────────────────────────────────

/** 固定 epoch（fixture 内所有 derived time 锚定此点）。 */
export const OPERATING_FIXTURE_EPOCH_MS = Date.UTC(2026, 7, 25, 0, 0, 0) // 2026-08-25T00:00:00Z

function isoAt(epochMs: number, offsetMs: number): string {
  return new Date(epochMs + offsetMs).toISOString()
}

const BASIS_NOTE_MAX = 200

function clampNote(s: string): string {
  return s.length > BASIS_NOTE_MAX ? s.slice(0, BASIS_NOTE_MAX) : s
}

// ── 2. 通用 builder helpers ───────────────────────────────────────────

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter.toString(36).padStart(6, '0')}`
}
function resetCounter(): void {
  counter = 0
}

const LAYERS: ReadonlyArray<'L1' | 'L2' | 'L3' | 'L4'> = ['L1', 'L2', 'L3', 'L4']
const LIFECYCLES: ReadonlyArray<'draft' | 'pending' | 'active' | 'deprecated' | 'outdated'> = [
  'draft',
  'pending',
  'active',
  'deprecated',
  'outdated',
]
const MEMORY_STATUSES: ReadonlyArray<
  'candidate' | 'confirmed' | 'edited' | 'possibly_outdated' | 'invalidated'
> = ['candidate', 'confirmed', 'edited', 'possibly_outdated', 'invalidated']
const MEMORY_SCOPES: ReadonlyArray<'user' | 'project' | 'organization'> = [
  'user',
  'project',
  'organization',
]
const DRAFT_STATUSES: ReadonlyArray<'pending' | 'committed' | 'discarded'> = [
  'pending',
  'committed',
  'discarded',
]
const OPERATING_STATUSES: readonly KnowledgeMemoryOperatingStatus[] = [
  'ready',
  'needs_review',
  'stale_or_unconfirmed',
  'conflict',
  'provenance_gap',
  'synthetic_eval_only',
  'retention_attention',
  'retrieval_gap',
  'degraded',
]
const OPERATING_SCOPES: readonly KnowledgeMemoryOperatingScope[] = [
  'organization',
  'project',
  'user',
  'session',
  'global',
]
const VISIBILITIES: readonly KnowledgeMemoryOperatingVisibility[] = [
  'visible',
  'hidden',
  'unavailable',
  'empty',
]

// ── 3. 知识 / memory / Skill / retrieval signal fixture builders ─────

export interface BuildKnowledgeItemInput {
  readonly orgId: number
  readonly index: number
  readonly layer?: 'L1' | 'L2' | 'L3' | 'L4'
  readonly lifecycle?: 'draft' | 'pending' | 'active' | 'deprecated' | 'outdated'
  readonly scope?: KnowledgeMemoryOperatingScope
  readonly visibility?: KnowledgeMemoryOperatingVisibility
  readonly hasProvenance?: boolean
  readonly ageMs?: number
}

export function buildKnowledgeItemFixture(
  input: BuildKnowledgeItemInput,
): KnowledgeItemOperatingProjection {
  const layer = input.layer ?? LAYERS[input.index % LAYERS.length]!
  const lifecycle = input.lifecycle ?? LIFECYCLES[input.index % LIFECYCLES.length]!
  const scope = input.scope ?? 'organization'
  const visibility = input.visibility ?? 'visible'
  const hasProvenance = input.hasProvenance ?? input.index % 7 !== 0
  const ageMs = input.ageMs ?? ((input.index * 7919) % 200) * 24 * 60 * 60 * 1000
  const isL3 = layer === 'L3'
  const status = deriveKnowledgeItemAttention({
    layer,
    lifecycle,
    hasProvenance,
    isL3EvalOnly: isL3,
  })
  const priority = priorityForStatus(status)
  const ref = nextId('k')
  const updatedAt = isoAt(OPERATING_FIXTURE_EPOCH_MS, -ageMs)
  const safeLabels = [
    `layer:${layer}`,
    `lifecycle:${lifecycle}`,
    isL3 ? 'SYNTHETIC' : 'real',
    isL3 ? 'eval-only' : 'production-eligible',
  ]
  return {
    kind: 'knowledge_item',
    scopedRef: makeScopedRef('knowledge_item', ref),
    scope,
    visibility,
    status,
    priority,
    freshnessState: lifecycle === 'outdated' ? 'stale' : 'fresh',
    title: `知识条目 ${input.index + 1}`,
    layer,
    lifecycle,
    provenance: hasProvenance
      ? [
          {
            ref: nextId('src'),
            sourceKind: layer === 'L1' ? 'standard' : layer === 'L2' ? 'project' : 'synthesized',
            status: 'available',
            fingerprint: `fp-${(input.index * 31).toString(16)}`,
            observedAt: updatedAt,
          },
        ]
      : [],
    reviewCount: input.index % 5,
    lastReviewedAt: hasProvenance ? updatedAt : undefined,
    attentionBasis: {
      reasonCode: status === 'ready' ? 'no_action_needed' : `${lifecycle}_attention`,
      basisRefs: [ref],
      note: clampNote(`lifecycle=${lifecycle}, layer=${layer}`),
    },
    safeLabels,
    updatedAt,
  }
}

export interface BuildCopilotMemoryInput {
  readonly orgId: number
  readonly index: number
  readonly statusDetail?: 'candidate' | 'confirmed' | 'edited' | 'possibly_outdated' | 'invalidated'
  readonly memoryScope?: 'user' | 'project' | 'organization'
  readonly hasLiveFactConflict?: boolean
  readonly longUnconfirmed?: boolean
  readonly scope?: KnowledgeMemoryOperatingScope
  readonly visibility?: KnowledgeMemoryOperatingVisibility
  readonly ageMs?: number
}

export function buildCopilotMemoryFixture(
  input: BuildCopilotMemoryInput,
): CopilotMemoryOperatingProjection {
  const statusDetail = input.statusDetail ?? MEMORY_STATUSES[input.index % MEMORY_STATUSES.length]!
  const memoryScope = input.memoryScope ?? MEMORY_SCOPES[input.index % MEMORY_SCOPES.length]!
  // live fact conflict 与 long_unconfirmed 默认与 statusDetail 互斥：candidate / edited
  // → 无冲突；confirmed → 默认无冲突以保持 fixture 可预期；任何显式 override 仍生效。
  const hasLiveFactConflict =
    input.hasLiveFactConflict ??
    (input.statusDetail === undefined
      ? input.index % 17 === 0 && statusDetail !== 'candidate'
      : false)
  const longUnconfirmed =
    input.longUnconfirmed ??
    (input.statusDetail === undefined
      ? input.index % 23 === 0 && statusDetail !== 'candidate' && !hasLiveFactConflict
      : false)
  const scope =
    input.scope ??
    (memoryScope === 'organization'
      ? 'organization'
      : memoryScope === 'project'
        ? 'project'
        : 'user')
  const visibility = input.visibility ?? 'visible'
  const ageMs = input.ageMs ?? ((input.index * 9973) % 180) * 24 * 60 * 60 * 1000
  const status = deriveCopilotMemoryAttention({
    statusDetail,
    hasLiveFactConflict,
    longUnconfirmed,
  })
  const priority = priorityForStatus(status)
  const ref = nextId('m')
  const updatedAt = isoAt(OPERATING_FIXTURE_EPOCH_MS, -ageMs)
  return {
    kind: 'copilot_memory',
    scopedRef: makeScopedRef('copilot_memory', ref),
    scope,
    memoryScope,
    owningEntryRef: `entry-${input.orgId}-${input.index}`,
    visibility,
    status,
    priority,
    freshnessState:
      statusDetail === 'possibly_outdated' || longUnconfirmed
        ? 'aging'
        : statusDetail === 'invalidated'
          ? 'stale'
          : 'fresh',
    summaryByteSize: 32 + (input.index % 8) * 16,
    basisCount: 1 + (input.index % 3),
    confidenceSource: [
      'explicit_user_statement',
      'repeated_observation',
      'single_observation',
      'inferred_from_context',
    ][input.index % 4]!,
    statusDetail,
    hasLiveFactConflict,
    attentionBasis: {
      reasonCode: hasLiveFactConflict
        ? 'live_fact_conflict'
        : longUnconfirmed
          ? 'long_unconfirmed'
          : statusDetail === 'candidate'
            ? 'awaiting_review'
            : 'inference_anchor',
      basisRefs: [ref],
      note: clampNote(`scope=${memoryScope}, status=${statusDetail}`),
    },
    safeLabels: ['inference', `memory_scope:${memoryScope}`],
    updatedAt,
  }
}

export interface BuildSkillKnowledgeDraftInput {
  readonly orgId: number
  readonly index: number
  readonly draftStatus?: 'pending' | 'committed' | 'discarded'
  readonly baseStale?: boolean
  readonly pluginDisabled?: boolean
  readonly scope?: KnowledgeMemoryOperatingScope
  readonly visibility?: KnowledgeMemoryOperatingVisibility
  readonly ageMs?: number
}

export function buildSkillKnowledgeDraftFixture(
  input: BuildSkillKnowledgeDraftInput,
): SkillKnowledgeDraftOperatingProjection {
  const draftStatus = input.draftStatus ?? DRAFT_STATUSES[input.index % DRAFT_STATUSES.length]!
  const baseStale = input.baseStale ?? input.index % 11 === 0
  const pluginDisabled = input.pluginDisabled ?? input.index % 19 === 0
  const scope = input.scope ?? 'organization'
  const visibility = input.visibility ?? 'visible'
  const ageMs = input.ageMs ?? ((input.index * 6151) % 90) * 24 * 60 * 60 * 1000
  const status = deriveSkillKnowledgeDraftAttention({
    draftStatus,
    baseStale,
    pluginDisabled,
  })
  const priority = priorityForStatus(status)
  const ref = nextId('s')
  const updatedAt = isoAt(OPERATING_FIXTURE_EPOCH_MS, -ageMs)
  const baseVersion = `v1.${input.index % 12}.0`
  const currentVersion = baseStale ? `v1.${(input.index % 12) + 1}.0` : baseVersion
  return {
    kind: 'skill_knowledge_draft',
    scopedRef: makeScopedRef('skill_knowledge_draft', ref),
    scope,
    visibility,
    status,
    priority,
    freshnessState: baseStale ? 'stale' : 'fresh',
    skillId: 1000 + input.index,
    skillName: `技能 #${input.index + 1}`,
    draftStatus,
    baseVersion,
    currentVersion,
    baseStale,
    sectionCount: 1 + (input.index % 6),
    pluginProvenance:
      input.index % 5 === 0
        ? {
            kind: 'plugin',
            pluginId: `com.example.plugin.${input.index % 7}`,
            skillIdentity: `com.example.skill.${input.index % 11}`,
            disabled: pluginDisabled,
            uninstalled: false,
          }
        : { kind: 'core' },
    attentionBasis: {
      reasonCode: baseStale
        ? 'base_version_stale'
        : pluginDisabled
          ? 'plugin_disabled'
          : draftStatus === 'pending'
            ? 'pending_review'
            : 'no_action_needed',
      basisRefs: [ref],
      note: clampNote(
        `draft=${draftStatus}, base_stale=${baseStale}, plugin_disabled=${pluginDisabled}`,
      ),
    },
    safeLabels: ['methodology_candidate', `draft_status:${draftStatus}`],
    updatedAt,
  }
}

export interface BuildRetrievalSignalInput {
  readonly orgId: number
  readonly index: number
  readonly retrievalKind?: string
  readonly queryCategory?: string
  readonly degraded?: boolean
  readonly noObservation?: boolean
  readonly zeroResultRate?: number
  readonly truncated?: boolean
  readonly uncertaintyHigh?: boolean
  readonly permissionExcludedCount?: number
  readonly scope?: KnowledgeMemoryOperatingScope
  readonly visibility?: KnowledgeMemoryOperatingVisibility
  readonly ageMs?: number
}

export function buildRetrievalSignalFixture(
  input: BuildRetrievalSignalInput,
): RetrievalSignalOperatingProjection {
  const retrievalKind =
    input.retrievalKind ??
    ['knowledge', 'document', 'copilot_memory', 'project_facts', 'plugin_contribution'][
      input.index % 5
    ]!
  const queryCategory =
    input.queryCategory ??
    ['definition', 'howto', 'status', 'reference', 'navigational'][input.index % 5]!
  // 默认值与显式 override 互斥：noObservation 显式为 true 时强制 sampleCount=0
  // 并把 degraded/truncated/uncertainty/permissionExcluded 全部置 0/false 以保持
  // 推导稳定。degraded 显式时同样屏蔽其它默认副作用。
  const noObservation = input.noObservation ?? input.index % 13 === 0
  const degraded = input.degraded ?? (noObservation ? false : input.index % 29 === 0)
  const zeroResultRate = input.zeroResultRate ?? (noObservation ? 0 : (input.index % 7) / 10)
  const truncated = input.truncated ?? (noObservation ? false : input.index % 17 === 0)
  const uncertaintyHigh = input.uncertaintyHigh ?? (noObservation ? false : input.index % 31 === 0)
  const permissionExcludedCount =
    input.permissionExcludedCount ?? (noObservation ? 0 : (input.index % 5) * 2)
  const sampleCount = noObservation ? 0 : 1 + (input.index % 50)
  const scope = input.scope ?? 'organization'
  const visibility = input.visibility ?? 'visible'
  const ageMs = input.ageMs ?? ((input.index * 2293) % 30) * 24 * 60 * 60 * 1000
  const status = deriveRetrievalSignalAttention({
    degraded,
    noObservation,
    zeroResultRate,
    truncated,
    uncertaintyHigh,
    permissionExcludedCount,
  })
  const priority = priorityForStatus(status)
  const ref = nextId('r')
  const windowStart = isoAt(OPERATING_FIXTURE_EPOCH_MS, -ageMs - 24 * 60 * 60 * 1000)
  const windowEnd = isoAt(OPERATING_FIXTURE_EPOCH_MS, -ageMs)
  return {
    kind: 'retrieval_signal',
    scopedRef: makeScopedRef('retrieval_signal', ref),
    scope,
    visibility,
    status,
    priority,
    freshnessState: 'aging',
    retrievalKind,
    queryCategory,
    windowStart,
    windowEnd,
    sampleCount,
    zeroResultRate,
    degraded,
    truncated,
    permissionExcludedCount,
    attentionBasis: {
      reasonCode: degraded
        ? 'adapter_degraded'
        : noObservation
          ? 'no_observation'
          : zeroResultRate >= 0.5
            ? 'high_zero_result_rate'
            : 'normal',
      basisRefs: [ref],
      note: clampNote(`kind=${retrievalKind}, category=${queryCategory}`),
    },
    safeLabels: [`retrieval_kind:${retrievalKind}`, `query_category:${queryCategory}`],
    updatedAt: windowEnd,
  }
}

// ── 4. 2500 对象 fixture（1000+1000+500） ─────────────────────────────

export interface BuildOperatingFixtureSuiteOptions {
  readonly orgId?: number
  /** 跨租 fixture：把第二条 lane 的所有对象 visibility 改为 hidden。 */
  readonly crossTenantBait?: boolean
  /** 隐藏对象诱饵：把少量对象 visibility 改为 hidden。 */
  readonly hiddenBait?: boolean
  /** 敏感诱饵：把极少数对象的 attentionBasis.note 注入禁存子串。 */
  readonly sensitiveBait?: boolean
  /** 注入 retrieval_gap / degraded 等多状态。 */
}

export interface OperatingFixtureSuite {
  readonly knowledge: readonly KnowledgeItemOperatingProjection[]
  readonly memory: readonly CopilotMemoryOperatingProjection[]
  readonly skillDrafts: readonly SkillKnowledgeDraftOperatingProjection[]
  readonly retrievalSignals: readonly RetrievalSignalOperatingProjection[]
  readonly all: readonly KnowledgeMemoryOperatingItem[]
}

export function buildOperatingFixtureSuite(
  options: BuildOperatingFixtureSuiteOptions = {},
): OperatingFixtureSuite {
  resetCounter()
  const orgId = options.orgId ?? 1
  const knowledge: KnowledgeItemOperatingProjection[] = []
  for (let i = 0; i < 1000; i++) {
    knowledge.push(
      buildKnowledgeItemFixture({
        orgId,
        index: i,
        visibility: options.hiddenBait && i % 137 === 0 ? 'hidden' : 'visible',
      }),
    )
  }
  if (options.crossTenantBait) {
    for (let i = 0; i < 1000; i++) {
      knowledge.push(
        buildKnowledgeItemFixture({
          orgId: orgId + 1,
          index: 1000 + i,
          visibility: 'hidden',
        }),
      )
    }
  }
  const memory: CopilotMemoryOperatingProjection[] = []
  for (let i = 0; i < 1000; i++) {
    memory.push(
      buildCopilotMemoryFixture({
        orgId,
        index: i,
        visibility: options.hiddenBait && i % 113 === 0 ? 'hidden' : 'visible',
      }),
    )
  }
  const skillDrafts: SkillKnowledgeDraftOperatingProjection[] = []
  for (let i = 0; i < 500; i++) {
    skillDrafts.push(
      buildSkillKnowledgeDraftFixture({
        orgId,
        index: i,
        visibility: options.hiddenBait && i % 97 === 0 ? 'hidden' : 'visible',
      }),
    )
  }
  const retrievalSignals: RetrievalSignalOperatingProjection[] = []
  for (let i = 0; i < 100; i++) {
    retrievalSignals.push(
      buildRetrievalSignalFixture({
        orgId,
        index: i,
        visibility: options.hiddenBait && i % 41 === 0 ? 'hidden' : 'visible',
      }),
    )
  }
  let all: KnowledgeMemoryOperatingItem[] = [
    ...knowledge,
    ...memory,
    ...skillDrafts,
    ...retrievalSignals,
  ]
  if (options.sensitiveBait) {
    // 极少量对象注入禁存子串（仅供低敏扫描测试）
    all = all.map((it, i) => {
      if (i % 251 !== 0) return it
      const note = `SAMPLE_SECRET_BODY-${i}`
      return {
        ...it,
        attentionBasis: { ...it.attentionBasis, note: clampNote(note) },
      } as KnowledgeMemoryOperatingItem
    })
  }
  return {
    knowledge,
    memory,
    skillDrafts,
    retrievalSignals,
    all,
  }
}

// ── 5. 诱饵 builder：跨租 / 隐藏 / 不可用 ─────────────────────────────

export interface OperatingBaitSuite {
  readonly hidden: KnowledgeMemoryOperatingItem[]
  readonly empty: KnowledgeMemoryOperatingItem[]
  readonly unavailable: KnowledgeMemoryOperatingItem[]
  readonly crossTenantHidden: KnowledgeMemoryOperatingItem[]
  readonly total: number
}

export function buildOperatingBaitSuite(orgId = 1): OperatingBaitSuite {
  resetCounter()
  const hidden: KnowledgeMemoryOperatingItem[] = []
  for (let i = 0; i < 5; i++) {
    hidden.push(
      buildKnowledgeItemFixture({
        orgId,
        index: 900 + i,
        visibility: 'hidden',
      }),
    )
  }
  const empty: KnowledgeMemoryOperatingItem[] = []
  for (let i = 0; i < 3; i++) {
    empty.push(
      buildRetrievalSignalFixture({
        orgId,
        index: 200 + i,
        noObservation: true,
        visibility: 'empty',
      }),
    )
  }
  const unavailable: KnowledgeMemoryOperatingItem[] = []
  for (let i = 0; i < 3; i++) {
    unavailable.push(
      buildRetrievalSignalFixture({
        orgId,
        index: 300 + i,
        degraded: true,
        visibility: 'unavailable',
      }),
    )
  }
  const crossTenantHidden: KnowledgeMemoryOperatingItem[] = []
  for (let i = 0; i < 5; i++) {
    crossTenantHidden.push(
      buildKnowledgeItemFixture({
        orgId: orgId + 1,
        index: 500 + i,
        visibility: 'hidden',
      }),
    )
  }
  return {
    hidden,
    empty,
    unavailable,
    crossTenantHidden,
    total: hidden.length + empty.length + unavailable.length + crossTenantHidden.length,
  }
}

// ── 6. Owning surface fixture（D5） ──────────────────────────────────

export function buildOwningSurfaceFixtures(): readonly {
  surface: KnowledgeMemoryOperatingSurface
  routeKey: string
  safeReturnContext: string
}[] {
  return [
    {
      surface: 'knowledge_review',
      routeKey: '/knowledge?layer=all&status=pending',
      safeReturnContext: '知识审查',
    },
    {
      surface: 'copilot_memory_governance',
      routeKey: '/copilot/memory?tab=governance',
      safeReturnContext: 'Copilot 记忆治理',
    },
    {
      surface: 'skill_knowledge_authoring',
      routeKey: '/compiler/skills/knowledge',
      safeReturnContext: 'Skill 知识草稿',
    },
    {
      surface: 'retrieval_observation_detail',
      routeKey: '/copilot/observations',
      safeReturnContext: '检索观测详情',
    },
  ]
}

// ── 7. 公共 exports（test 常用） ──────────────────────────────────────

export const ALL_OPERATING_KINDS = KNOWLEDGE_MEMORY_OPERATING_KINDS
export const ALL_OPERATING_STATUSES = OPERATING_STATUSES
export const ALL_OPERATING_SCOPES = OPERATING_SCOPES
export const ALL_VISIBILITIES = VISIBILITIES
export const ALL_LAYERS = LAYERS
export const ALL_LIFECYCLES = LIFECYCLES
export const ALL_MEMORY_STATUSES = MEMORY_STATUSES
export const ALL_MEMORY_SCOPES = MEMORY_SCOPES
export const ALL_DRAFT_STATUSES = DRAFT_STATUSES

export function kindLabel(kind: KnowledgeMemoryOperatingKind): string {
  switch (kind) {
    case 'knowledge_item':
      return '知识条目'
    case 'copilot_memory':
      return '推断记忆'
    case 'skill_knowledge_draft':
      return 'Skill 知识草稿'
    case 'retrieval_signal':
      return '检索质量信号'
  }
}

export function defaultSurfaceOfKind(
  kind: KnowledgeMemoryOperatingKind,
): KnowledgeMemoryOperatingSurface {
  return defaultSurfaceForKind(kind)
}
