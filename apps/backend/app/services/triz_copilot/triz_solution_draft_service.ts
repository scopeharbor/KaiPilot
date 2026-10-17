// v3-triz-contradiction-copilot W1 —— Top 3 破局方案草案服务（tasks 1.5）。
//
// 职责（spec「Top 3 破局方案呈现与原则溯源」第 1–5 条 + design D2「知识库全量、呈现层精选」）：
// - 由映射草案（1.4 产出）+ 上下文包（1.3 产出）确定性组装**恰好 3 条**方案草案：
//   标题（中文大白话，只用知识包的现代语汇呈现名）/ 来源原则编号与名称（**一律回填知识包**，
//   不采信任何外部输入的名称字段）/ 绑定真实实体的动作要点 / 预期正负影响提示 / 依赖的前置条件；
// - 排序由确定性规则给出：原则命中强度 × 上下文匹配度 × 可执行性
//   （权重见 TRIZ_SOLUTION_RANKING_WEIGHTS，纯函数、同一输入两次调用结果完全一致）；
// - 反幻觉：方案引用的每个项目实体都过 1.3 的 `isContextRefWhitelisted` 白名单，
//   未通过即剔除并只记计数；上下文没有任何可用实体时降级为**无实体绑定的通用建议**并在草案上显式标注；
// - **人工确认关卡**：只产草案（`persisted: false` / `requiresHumanConfirmation: true`）；
// - 零 Token：纯确定性组装，无模型调用、无网络调用、无数据访问（模块内无任何写入端口）。
//
// 边界：不读业务表、不做权限判定、不接受作用域参数（组织隔离由上游的上下文包与映射服务保证）；
// 落库走 2.x 的「预览 → 人工确认 → 单事务」链路，本服务不参与。
// 一期上限为硬约束：呈现方案 MUST NOT 超过 3 条（`TRIZ_SOLUTION_TOP_COUNT` 为常量、不可配置上调）。

import type {
  TrizContradictionMappingDraft,
  TrizContradictionType,
  TrizMappingPath,
} from './triz_contradiction_mapping_service.js'
import {
  isContextRefWhitelisted,
  type TrizContextEntityKind,
  type TrizContextPack,
} from './triz_context_pack_service.js'
import {
  TRIZ_KNOWLEDGE_PACK_VERSION,
  TRIZ_PM_CLASSIC_SCENARIOS,
  TRIZ_PM_CONTRAIDCTION_PAIRS,
} from './knowledge/index.js'
import { searchByParameterPair, searchPrincipleByNumber } from './triz_knowledge_search_service.js'

// ---------------------------------------------------------------------------
// 一期上限与排序权重（命名常量，可断言）
// ---------------------------------------------------------------------------

/** 呈现方案上限：一期硬约束（spec 第 5 条），不随限额解析上调。 */
export const TRIZ_SOLUTION_TOP_COUNT = 3

/**
 * 排序权重：原则命中强度 × 上下文匹配度 × 可执行性。
 * 原则强度权重最高——知识包给出的推荐序不得被次要分量整体翻盘。
 */
export const TRIZ_SOLUTION_RANKING_WEIGHTS: Readonly<{
  principleStrength: number
  contextMatch: number
  executability: number
}> = {
  principleStrength: 0.6,
  contextMatch: 0.25,
  executability: 0.15,
}

/** 可执行性分量的加分项：由已产出的动作要点形态决定（无主观判断）。 */
export const TRIZ_SOLUTION_EXECUTABILITY_FACTORS: Readonly<{
  hasActionPoints: number
  entityBound: number
  multipleActionPoints: number
  groundedInSourceMapping: number
}> = {
  hasActionPoints: 0.4,
  entityBound: 0.3,
  multipleActionPoints: 0.2,
  groundedInSourceMapping: 0.1,
}

/** 知识包补足条目的原则命中强度（未出现在映射候选序中，故取固定低位）。 */
export const TRIZ_SOLUTION_TOPPED_UP_STRENGTH = 0.2

export interface TrizSolutionLimits {
  /** 每条方案的动作要点条数上限 */
  maxActionPoints: number
  /** 动作要点文本上限（有界摘要，RL-12） */
  maxActionChars: number
  /** 方案标题文本上限 */
  maxTitleChars: number
  /** 标题 / 动作要点里引用的实体标签上限 */
  maxAnchorLabelChars: number
  /** 每条方案的前置条件条数上限 */
  maxPreconditions: number
  /** 影响提示文本上限 */
  maxImpactChars: number
}

export const TRIZ_SOLUTION_LIMITS: Readonly<TrizSolutionLimits> = {
  maxActionPoints: 3,
  maxActionChars: 160,
  maxTitleChars: 60,
  maxAnchorLabelChars: 16,
  maxPreconditions: 3,
  maxImpactChars: 80,
}

/** 文本与条数的下限：即便调用方传入更小的值，也不会把方案压到无法呈现。 */
const MIN_ACTION_POINTS = 1
const MIN_TEXT_CHARS = 16

/** 解析生效限额：默认值只允许**收紧**（与 1.3 / 1.4 同口径）。 */
export function resolveTrizSolutionLimits(
  overrides?: Partial<TrizSolutionLimits>,
): TrizSolutionLimits {
  const resolved: TrizSolutionLimits = { ...TRIZ_SOLUTION_LIMITS }
  if (!overrides) return resolved
  for (const key of Object.keys(TRIZ_SOLUTION_LIMITS) as (keyof TrizSolutionLimits)[]) {
    const value = overrides[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const tightened = Math.floor(value)
    if (tightened < 1) continue
    if (tightened < resolved[key]) resolved[key] = tightened
  }
  resolved.maxActionPoints = Math.max(MIN_ACTION_POINTS, resolved.maxActionPoints)
  resolved.maxTitleChars = Math.max(MIN_TEXT_CHARS, resolved.maxTitleChars)
  resolved.maxActionChars = Math.max(MIN_TEXT_CHARS, resolved.maxActionChars)
  resolved.maxImpactChars = Math.max(MIN_TEXT_CHARS, resolved.maxImpactChars)
  resolved.maxAnchorLabelChars = Math.max(4, resolved.maxAnchorLabelChars)
  resolved.maxPreconditions = Math.max(1, resolved.maxPreconditions)
  return resolved
}

/** 质量标记：不推翻方案，但必须在草案上如实标注（供前端徽标与 2.x 观测计数）。 */
export const TRIZ_SOLUTION_QUALITY_FLAGS = [
  /** 候选原则多于 3 条，超出部分未进入 Top 3（仅可在映射依据与分馆中查看） */
  'CANDIDATES_TRUNCATED',
  /** 候选原则不足 3 条，已按知识包（参数对 / 来源映射）确定性补足 */
  'CANDIDATES_TOPPED_UP',
  /** 知识包无法确定性补足到 3 条（如实少于 3 条，不编造无关原则） */
  'SOLUTION_COUNT_UNDER_LIMIT',
  /** 映射草案没有可用候选原则（信息不足）⇒ 不产出方案 */
  'INSUFFICIENT_MAPPING',
  /** 存在未通过上下文白名单的实体引用（已剔除，只记计数） */
  'CONTEXT_REFS_REJECTED',
  /** 上下文没有可用实体 ⇒ 全部方案降级为无实体绑定的通用建议 */
  'GENERIC_ADVICE_NO_ENTITY',
  /** 标题或动作要点超出上限被截断（有界摘要） */
  'CONTENT_TRUNCATED',
] as const
export type TrizSolutionQualityFlag = (typeof TRIZ_SOLUTION_QUALITY_FLAGS)[number]

// ---------------------------------------------------------------------------
// 方案草案结构
// ---------------------------------------------------------------------------

/** 实体绑定状态：bound = 已绑定白名单实体；none = 无实体绑定的通用建议。 */
export const TRIZ_SOLUTION_ENTITY_BINDINGS = ['bound', 'none'] as const
export type TrizSolutionEntityBinding = (typeof TRIZ_SOLUTION_ENTITY_BINDINGS)[number]

/** 整组绑定状态：partial = 部分方案绑定（如实披露，不冒充全量绑定）。 */
export const TRIZ_SOLUTION_SET_BINDINGS = ['bound', 'partial', 'none'] as const
export type TrizSolutionSetBinding = (typeof TRIZ_SOLUTION_SET_BINDINGS)[number]

/** 来源原则：全部字段回填自知识包（含展开解释所需的实例与 PM 释义，spec 第 2 条）。 */
export interface TrizSolutionPrincipleRef {
  number: number
  nameZh: string
  nameEn: string
  displayName: string
  definition: string
  softwareExamples: string
  pmInterpretation: string
  source: string
}

/** 动作要点：文本 + 该动作落地的项目实体引用（白名单校验通过）。 */
export interface TrizSolutionActionPoint {
  text: string
  entityRefs: string[]
}

/** 影响提示：正向收益与负向代价（均为有界摘要）。 */
export interface TrizSolutionImpact {
  positive: string
  negative: string
}

/** 排序分量：确定性规则的三项分量与加权总分（可复算、可断言）。 */
export interface TrizSolutionRanking {
  principleStrength: number
  contextMatch: number
  executability: number
  score: number
}

export interface TrizSolutionDraft {
  /** Top 3 内序号（1 起；供落库来源标注「所选方案序号」使用） */
  index: number
  title: string
  principle: TrizSolutionPrincipleRef
  actionPoints: TrizSolutionActionPoint[]
  impact: TrizSolutionImpact
  preconditions: string[]
  /** 方案级绑定实体（动作要点引用集合，按出现顺序去重） */
  entityRefs: string[]
  entityBinding: TrizSolutionEntityBinding
  ranking: TrizSolutionRanking
  /** 是否由知识包补足条目（未出现在映射候选序中） */
  toppedUp: boolean
  requiresHumanConfirmation: true
  persisted: false
}

/** 上下文引用的白名单校验结论：只记**计数**（RL-12）。 */
export interface TrizSolutionRefValidation {
  accepted: number
  rejected: number
}

export interface TrizSolutionDraftSet {
  /** 方案草案（不超过 TRIZ_SOLUTION_TOP_COUNT 条；信息不足时为空数组） */
  solutions: TrizSolutionDraft[]
  /** 整组实体绑定状态 */
  entityBinding: TrizSolutionSetBinding
  /** 输入映射的候选原则编号（含未进入 Top 3 的编号，供「查看更多原则」跳转分馆） */
  candidatePrincipleNumbers: number[]
  /** 未进入 Top 3 的候选原则编号 */
  excludedPrincipleNumbers: number[]
  /** 结果路径与来源映射：随输入映射透传（前端徽标与溯源） */
  path: TrizMappingPath
  contradictionType: TrizContradictionType
  sourceMappingIds: string[]
  contextRefValidation: TrizSolutionRefValidation
  qualityFlags: TrizSolutionQualityFlag[]
  /** 映射草案是否信息不足（无候选原则）⇒ 本次不产出方案 */
  insufficientMapping: boolean
  knowledgePackVersion: string
  /** 人工确认关卡：本服务只产草案，落库必须经 2.x 的两阶段确认 */
  requiresHumanConfirmation: true
  persisted: false
}

/** 落库投影：2.1 表 `top_solutions` 字段的低敏子集（只有序号 / 编号 / 有界标题 / 引用 / 分数）。 */
export interface TrizSolutionLowSensitivityRecord {
  path: TrizMappingPath
  entityBinding: TrizSolutionSetBinding
  solutions: Array<{
    index: number
    principleNumber: number
    title: string
    score: number
    entityRefs: string[]
  }>
  excludedPrincipleNumbers: number[]
  contextRefValidation: TrizSolutionRefValidation
  qualityFlags: TrizSolutionQualityFlag[]
  knowledgePackVersion: string
}

// ---------------------------------------------------------------------------
// 锚点（绑定实体）：由上下文包的项目事实强度排序，纯确定性
// ---------------------------------------------------------------------------

/** 实体事实强度：越高越紧迫（排序与上下文匹配度都用它，无主观判断）。 */
const ANCHOR_STRENGTH = {
  overdueTask: 1,
  highRisk: 0.9,
  missedMilestone: 0.85,
  overallocatedResource: 0.8,
  atRiskMilestone: 0.75,
  criticalPathTask: 0.7,
  mediumRisk: 0.6,
  pendingChangeRequest: 0.5,
  unknownEntity: 0.4,
  lowRisk: 0.3,
  neutralMilestone: 0.3,
  neutralChangeRequest: 0.3,
  neutralTask: 0.25,
  neutralResource: 0.25,
} as const

const ENTITY_KIND_ORDER: readonly TrizContextEntityKind[] = [
  'task',
  'risk',
  'resource',
  'milestone',
  'change_request',
]

const ENTITY_KIND_LABELS: Readonly<Record<TrizContextEntityKind, string>> = {
  task: '任务',
  risk: '风险',
  resource: '资源',
  milestone: '里程碑',
  change_request: '变更请求',
}

const PENDING_CHANGE_REQUEST_STATUSES = new Set(['submitted', 'under_review'])
const MISSED_MILESTONE_STATUSES = new Set(['missed', 'at_risk'])

interface TrizSolutionAnchor {
  ref: string
  kind: TrizContextEntityKind
  label: string
  strength: number
}

/** 拆分规范引用 `<kind>:<id>`；形态非法返回 null（与白名单校验同口径）。 */
function splitContextRef(ref: string): { kind: TrizContextEntityKind; id: number } | null {
  if (typeof ref !== 'string') return null
  const separatorIndex = ref.indexOf(':')
  if (separatorIndex <= 0) return null
  const kind = ref.slice(0, separatorIndex) as TrizContextEntityKind
  const idText = ref.slice(separatorIndex + 1)
  if (!/^\d+$/.test(idText)) return null
  if (!ENTITY_KIND_ORDER.includes(kind)) return null
  return { kind, id: Number(idText) }
}

function refOf(kind: TrizContextEntityKind, id: number): string {
  return `${kind}:${id}`
}

function statusStrength(
  value: string,
  table: Readonly<Record<string, number>>,
  fallback: number,
): number {
  return table[value] ?? fallback
}

/**
 * 项目事实锚点：只由上下文包（1.3 的有界只读投影）逐域展开，强度取自事实本身
 * （逾期 / 高风险 / 过载 / 滑移），因此「上下文匹配度」可复算、不依赖任何主观打分。
 */
function collectPackAnchors(pack: TrizContextPack): TrizSolutionAnchor[] {
  const anchors: TrizSolutionAnchor[] = []

  for (const item of pack.domains.tasks?.items ?? []) {
    anchors.push({
      ref: refOf('task', item.id),
      kind: 'task',
      label: item.label,
      strength: item.overdue
        ? ANCHOR_STRENGTH.overdueTask
        : item.isCriticalPath
          ? ANCHOR_STRENGTH.criticalPathTask
          : ANCHOR_STRENGTH.neutralTask,
    })
  }
  for (const id of pack.domains.tasks?.criticalPathTaskIds ?? []) {
    anchors.push({
      ref: refOf('task', id),
      kind: 'task',
      label: `${ENTITY_KIND_LABELS.task} #${id}`,
      strength: ANCHOR_STRENGTH.criticalPathTask,
    })
  }

  for (const item of pack.domains.risks?.items ?? []) {
    anchors.push({
      ref: refOf('risk', item.id),
      kind: 'risk',
      label: item.label,
      strength: statusStrength(
        item.riskLevel,
        {
          high: ANCHOR_STRENGTH.highRisk,
          medium: ANCHOR_STRENGTH.mediumRisk,
          low: ANCHOR_STRENGTH.lowRisk,
        },
        ANCHOR_STRENGTH.mediumRisk,
      ),
    })
  }

  for (const item of pack.domains.resources?.items ?? []) {
    anchors.push({
      ref: refOf('resource', item.id),
      kind: 'resource',
      label: item.label,
      strength: item.overallocated
        ? ANCHOR_STRENGTH.overallocatedResource
        : ANCHOR_STRENGTH.neutralResource,
    })
  }

  for (const item of pack.domains.milestones?.items ?? []) {
    anchors.push({
      ref: refOf('milestone', item.id),
      kind: 'milestone',
      label: item.label,
      strength: MISSED_MILESTONE_STATUSES.has(item.displayStatus)
        ? statusStrength(
            item.displayStatus,
            {
              missed: ANCHOR_STRENGTH.missedMilestone,
              at_risk: ANCHOR_STRENGTH.atRiskMilestone,
            },
            ANCHOR_STRENGTH.neutralMilestone,
          )
        : ANCHOR_STRENGTH.neutralMilestone,
    })
  }

  for (const item of pack.domains.changeRequests?.items ?? []) {
    anchors.push({
      ref: refOf('change_request', item.id),
      kind: 'change_request',
      label: item.label,
      strength: PENDING_CHANGE_REQUEST_STATUSES.has(item.status)
        ? ANCHOR_STRENGTH.pendingChangeRequest
        : ANCHOR_STRENGTH.neutralChangeRequest,
    })
  }

  // 白名单外的一律不进锚点（反幻觉：锚点只能来自本次上下文实际读到的本项目实体）
  return anchors.filter((anchor) => isContextRefWhitelisted(pack, anchor.ref))
}

function anchorFromRef(pack: TrizContextPack, ref: string): TrizSolutionAnchor | null {
  const parsed = splitContextRef(ref)
  if (!parsed) return null
  const known = collectPackAnchors(pack).find((anchor) => anchor.ref === ref)
  if (known) return known
  return {
    ref,
    kind: parsed.kind,
    label: `${ENTITY_KIND_LABELS[parsed.kind]} #${parsed.id}`,
    strength: ANCHOR_STRENGTH.unknownEntity,
  }
}

/**
 * 锚点排序：映射层证据优先纳入，随后按事实强度降序（同强度按域序、再按实体 ID 升序）。
 * 排序完全由上下文事实决定，因此同一分析记录重算得到同一锚点序。
 */
function buildAnchors(pack: TrizContextPack, mappingRefs: readonly string[]): TrizSolutionAnchor[] {
  const anchors = collectPackAnchors(pack)
  const seen = new Set(anchors.map((anchor) => anchor.ref))
  for (const ref of mappingRefs) {
    if (seen.has(ref)) continue
    const anchor = anchorFromRef(pack, ref)
    if (!anchor) continue
    seen.add(ref)
    anchors.push(anchor)
  }
  return anchors.sort(
    (a, b) =>
      b.strength - a.strength ||
      ENTITY_KIND_ORDER.indexOf(a.kind) - ENTITY_KIND_ORDER.indexOf(b.kind) ||
      Number(splitContextRef(a.ref)?.id ?? 0) - Number(splitContextRef(b.ref)?.id ?? 0),
  )
}

/** 按方案序轮转取锚点：每条方案优先落在不同实体上，实体不足时复用最近的强信号。 */
function pickAnchors(
  anchors: readonly TrizSolutionAnchor[],
  position: number,
  limit: number,
): TrizSolutionAnchor[] {
  if (anchors.length === 0) return []
  const picked: TrizSolutionAnchor[] = []
  for (let step = 0; step < Math.min(limit, anchors.length); step += 1) {
    const anchor = anchors[(position + step) % anchors.length]
    if (picked.some((entry) => entry.ref === anchor.ref)) continue
    picked.push(anchor)
  }
  return picked
}

// ---------------------------------------------------------------------------
// 文本工具（有界摘要，RL-12）
// ---------------------------------------------------------------------------

function collapseText(value: unknown): string {
  return (typeof value === 'string' ? value : String(value ?? '')).replace(/\s+/g, ' ').trim()
}

/** 有界文本：超出上限即截断加省略号（含省略号在内不超过上限），并回报截断事实（供 CONTENT_TRUNCATED 标记）。 */
export function clampTrizSolutionText(
  value: unknown,
  maxChars: number,
): { text: string; truncated: boolean } {
  const collapsed = collapseText(value)
  const characters = Array.from(collapsed)
  if (characters.length <= maxChars) return { text: collapsed, truncated: false }
  const budget = Math.max(1, maxChars - 1)
  return { text: `${characters.slice(0, budget).join('')}…`, truncated: true }
}

// ---------------------------------------------------------------------------
// 输入归一：候选原则与来源映射
// ---------------------------------------------------------------------------

/** 知识包里的来源映射（14 对 PM 矛盾 + 3 个经典推演）：方案动作要点的确定性素材。 */
interface TrizSourceMapping {
  id: string
  title: string
  solutions: readonly string[]
  principleNumbers: readonly number[]
  source: string
}

function findSourceMapping(id: string): TrizSourceMapping | null {
  for (const pair of TRIZ_PM_CONTRAIDCTION_PAIRS) {
    if (pair.id === id) {
      return {
        id: pair.id,
        title: pair.title,
        solutions: pair.solutions,
        principleNumbers: pair.principleNumbers,
        source: pair.source,
      }
    }
  }
  for (const scenario of TRIZ_PM_CLASSIC_SCENARIOS) {
    if (scenario.id === id) {
      return {
        id: scenario.id,
        title: scenario.title,
        solutions: scenario.solutions,
        principleNumbers: scenario.principleNumbers,
        source: scenario.source,
      }
    }
  }
  return null
}

/** 由知识包编号构造原则引用；编号不在包内返回 null（不编造名称）。 */
export function toTrizSolutionPrincipleRef(number: number): TrizSolutionPrincipleRef | null {
  const entry = searchPrincipleByNumber(number)
  if (!entry) return null
  return {
    number: entry.number,
    nameZh: entry.nameZh,
    nameEn: entry.nameEn,
    displayName: entry.displayName,
    definition: entry.definition,
    softwareExamples: entry.softwareExamples,
    pmInterpretation: entry.pmInterpretation,
    source: entry.source,
  }
}

interface SelectedPrinciple {
  number: number
  /** 映射层 rank（补足条目排在候选序之后） */
  rank: number
  strength: number
  toppedUp: boolean
}

/**
 * 候选原则选取（**统一策略：能补则补，补不动才降级**）：
 * 1. 逐条回填知识包（编号不在包内的一律丢弃，不编造）；
 * 2. 不足 3 条时按知识包确定性补足（参数对命中映射 → 单侧参数命中映射 → 来源映射自带原则），
 *    补足条目带 `toppedUp` 标记并取固定低位强度；映射层零候选但参数对可解析时同样按此补足；
 * 3. 仍不足 3 条时如实少于 3 条（`SOLUTION_COUNT_UNDER_LIMIT`）——不填充与矛盾无关的原则；
 * 4. 一条都凑不出时（既无候选也无知识包相关性，即规则路径的「信息不足」形态）零方案 +
 *    `INSUFFICIENT_MAPPING`，由调用方按「信息不足」结论呈现，不编造方案。
 */
function selectPrinciples(mapping: TrizContradictionMappingDraft): {
  selected: SelectedPrinciple[]
  candidateNumbers: number[]
} {
  const ranked = [...mapping.candidatePrinciples].sort(
    (a, b) => a.rank - b.rank || a.number - b.number,
  )
  const rankCount = Math.max(1, ranked.length)

  const selected: SelectedPrinciple[] = []
  const candidateNumbers: number[] = []
  const seen = new Set<number>()

  for (const candidate of ranked) {
    if (!searchPrincipleByNumber(candidate.number)) continue
    if (seen.has(candidate.number)) continue
    seen.add(candidate.number)
    candidateNumbers.push(candidate.number)
    selected.push({
      number: candidate.number,
      rank: candidate.rank,
      strength: round(1 - (candidate.rank - 1) / rankCount, 2),
      toppedUp: false,
    })
  }

  if (selected.length >= TRIZ_SOLUTION_TOP_COUNT) return { selected, candidateNumbers }

  for (const number of collectTopUpPrincipleNumbers(mapping)) {
    if (selected.length >= TRIZ_SOLUTION_TOP_COUNT) break
    if (seen.has(number)) continue
    if (!searchPrincipleByNumber(number)) continue
    seen.add(number)
    selected.push({
      number,
      rank: ranked.length + selected.length + 1,
      strength: TRIZ_SOLUTION_TOPPED_UP_STRENGTH,
      toppedUp: true,
    })
  }

  return { selected, candidateNumbers }
}

/** 补足池：只取知识包里与本次参数对 / 来源映射相关的原则，按固定顺序去重。 */
function collectTopUpPrincipleNumbers(mapping: TrizContradictionMappingDraft): number[] {
  const improving = mapping.improvingParameter?.number ?? null
  const worsening = mapping.worseningParameter?.number ?? null
  const numbers: number[] = []

  if (improving !== null && worsening !== null) {
    for (const entry of searchByParameterPair(improving, worsening).mappings) {
      numbers.push(...entry.principleNumbers)
    }
  }

  for (const pair of TRIZ_PM_CONTRAIDCTION_PAIRS) {
    const hits =
      (improving !== null && pair.improvingParameterNumbers.includes(improving)) ||
      (worsening !== null && pair.worseningParameterNumbers.includes(worsening))
    if (hits) numbers.push(...pair.principleNumbers)
  }
  for (const scenario of TRIZ_PM_CLASSIC_SCENARIOS) {
    const hits =
      (improving !== null && scenario.improvingParameterNumbers.includes(improving)) ||
      (worsening !== null && scenario.worseningParameterNumbers.includes(worsening))
    if (hits) numbers.push(...scenario.principleNumbers)
  }

  for (const id of mapping.sourceMappingIds) {
    numbers.push(...(findSourceMapping(id)?.principleNumbers ?? []))
  }

  const deduped: number[] = []
  for (const number of numbers) {
    if (deduped.includes(number)) continue
    if (!searchPrincipleByNumber(number)) continue
    deduped.push(number)
  }
  return deduped
}

// ---------------------------------------------------------------------------
// 方案草案组装（纯函数）
// ---------------------------------------------------------------------------

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

interface ComposeContext {
  mapping: TrizContradictionMappingDraft
  pack: TrizContextPack
  anchors: readonly TrizSolutionAnchor[]
  sourceMapping: TrizSourceMapping | null
  limits: TrizSolutionLimits
}

function composeMoves(
  principle: TrizSolutionPrincipleRef,
  sourceMapping: TrizSourceMapping | null,
  limits: TrizSolutionLimits,
): string[] {
  const moves: string[] = []
  const push = (value: string): void => {
    if (moves.length >= limits.maxActionPoints) return
    const text = collapseText(value)
    if (text.length === 0) return
    if (moves.includes(text)) return
    moves.push(text)
  }

  for (const solution of sourceMapping?.solutions ?? []) push(solution)
  push(principle.pmInterpretation)
  push(principle.definition)
  return moves
}

function composeTitle(
  principle: TrizSolutionPrincipleRef,
  context: ComposeContext,
  anchor: TrizSolutionAnchor | null,
): string {
  const { mapping } = context
  const improving = mapping.improvingParameter?.displayName ?? null
  const worsening = mapping.worseningParameter?.displayName ?? null

  const conflict =
    improving && worsening
      ? `缓解「${improving}」与「${worsening}」的拉扯`
      : `推进当前的${mapping.contradictionTypeLabel}`

  if (!anchor) return `以${principle.displayName}${conflict}（通用建议）`

  const label = clampTrizSolutionText(anchor.label, context.limits.maxAnchorLabelChars).text
  return `以${principle.displayName}${conflict}，先在「${label}」落地`
}

function composeImpact(
  principle: TrizSolutionPrincipleRef,
  context: ComposeContext,
): TrizSolutionImpact {
  const improving = context.mapping.improvingParameter?.displayName ?? null
  const worsening = context.mapping.worseningParameter?.displayName ?? null

  const positive = improving
    ? `预期改善「${improving}」${worsening ? `，把「${worsening}」的恶化控制在可接受范围` : ''}`
    : `先按${principle.displayName}聚焦已识别的项目事实，参数对留待人工确认`
  const negative = worsening
    ? `代价：需要额外协调与验证成本，短期可能继续占用「${worsening}」相关投入`
    : '代价：参数对尚未确定，影响面需人工复核后再落地'

  return {
    positive: clampTrizSolutionText(positive, context.limits.maxImpactChars).text,
    negative: clampTrizSolutionText(negative, context.limits.maxImpactChars).text,
  }
}

function composePreconditions(
  context: ComposeContext,
  anchor: TrizSolutionAnchor | null,
): string[] {
  const worsening = context.mapping.worseningParameter?.displayName ?? null
  const candidates: string[] = ['本方案为草案：落地前需人工确认目标实体与排期']
  if (anchor) {
    const label = clampTrizSolutionText(anchor.label, context.limits.maxAnchorLabelChars).text
    candidates.push(
      `需先确认「${label}」（${ENTITY_KIND_LABELS[anchor.kind]}）当前可动用的排期与资源`,
    )
  }
  if (worsening) candidates.push(`需记录「${worsening}」的当前读数，作为效果回看基线`)
  return candidates
    .slice(0, context.limits.maxPreconditions)
    .map((entry) => clampTrizSolutionText(entry, context.limits.maxActionChars).text)
}

function buildActionPoints(
  moves: readonly string[],
  anchors: readonly TrizSolutionAnchor[],
  limits: TrizSolutionLimits,
): { actionPoints: TrizSolutionActionPoint[]; truncated: boolean } {
  let truncated = false
  const actionPoints = moves.map((move, index) => {
    const anchor = anchors.length > 0 ? anchors[index % anchors.length] : null
    const suffix = anchor
      ? `（对象：${clampTrizSolutionText(anchor.label, limits.maxAnchorLabelChars).text}）`
      : ''
    const clamped = clampTrizSolutionText(`${move}${suffix}`, limits.maxActionChars)
    if (clamped.truncated) truncated = true
    return { text: clamped.text, entityRefs: anchor ? [anchor.ref] : [] }
  })
  return { actionPoints, truncated }
}

function buildOneSolution(
  entry: SelectedPrinciple,
  position: number,
  context: ComposeContext,
): { solution: TrizSolutionDraft; truncated: boolean } | null {
  const principle = toTrizSolutionPrincipleRef(entry.number)
  if (!principle) return null

  const picked = pickAnchors(context.anchors, position, context.limits.maxActionPoints)
  const moves = composeMoves(principle, context.sourceMapping, context.limits)
  const { actionPoints, truncated: actionsTruncated } = buildActionPoints(
    moves,
    picked,
    context.limits,
  )
  const entityRefs: string[] = []
  for (const point of actionPoints) {
    for (const ref of point.entityRefs) if (!entityRefs.includes(ref)) entityRefs.push(ref)
  }
  const entityBinding: TrizSolutionEntityBinding =
    entityRefs.length > 0 && actionPoints.length > 0 ? 'bound' : 'none'

  const title = clampTrizSolutionText(
    composeTitle(principle, context, entityRefs.length > 0 ? picked[0] : null),
    context.limits.maxTitleChars,
  )

  const factors = TRIZ_SOLUTION_EXECUTABILITY_FACTORS
  let executability = 0
  if (actionPoints.length > 0) executability += factors.hasActionPoints
  if (entityBinding === 'bound') executability += factors.entityBound
  if (actionPoints.length >= 2) executability += factors.multipleActionPoints
  if (context.sourceMapping) executability += factors.groundedInSourceMapping

  const contextMatch = picked.length > 0 ? picked[0].strength : 0
  const weights = TRIZ_SOLUTION_RANKING_WEIGHTS
  const score =
    weights.principleStrength * entry.strength +
    weights.contextMatch * contextMatch +
    weights.executability * clamp01(executability)

  return {
    solution: {
      index: 1,
      title: title.text,
      principle,
      actionPoints,
      impact: composeImpact(principle, context),
      preconditions: composePreconditions(context, picked[0] ?? null),
      entityRefs,
      entityBinding,
      ranking: {
        principleStrength: entry.strength,
        contextMatch: round(contextMatch, 3),
        executability: round(clamp01(executability), 3),
        score: round(score, 4),
      },
      toppedUp: entry.toppedUp,
      requiresHumanConfirmation: true,
      persisted: false,
    },
    truncated: title.truncated || actionsTruncated,
  }
}

export interface TrizSolutionDraftInput {
  /** 1.4 产出的映射草案（本服务不重新映射，也不读业务数据） */
  mapping: TrizContradictionMappingDraft
  /** 1.3 产出的上下文包（实体白名单的唯一依据） */
  contextPack: TrizContextPack
  /** 限额收紧（默认值只允许收紧） */
  limits?: Partial<TrizSolutionLimits>
}

/**
 * 组装 Top 3 方案草案（纯函数）：候选原则逐条回填知识包 → 实体绑定过白名单 →
 * 确定性排序取前 3 → 只产草案。
 */
export function buildTrizSolutionDrafts(input: TrizSolutionDraftInput): TrizSolutionDraftSet {
  const limits = resolveTrizSolutionLimits(input.limits)
  const { mapping, contextPack: pack } = input
  const qualityFlags: TrizSolutionQualityFlag[] = []

  // 反幻觉关卡：映射草案携带的实体引用逐个过白名单，未通过即剔除并只记计数（不记录正文）
  const accepted: string[] = []
  let rejected = 0
  for (const ref of mapping.contextRefs) {
    if (!isContextRefWhitelisted(pack, ref)) {
      rejected += 1
      continue
    }
    if (!accepted.includes(ref)) accepted.push(ref)
  }
  if (rejected > 0) qualityFlags.push('CONTEXT_REFS_REJECTED')

  const anchors = buildAnchors(pack, accepted)
  const { selected, candidateNumbers } = selectPrinciples(mapping)

  const base = {
    path: mapping.path,
    contradictionType: mapping.contradictionType,
    sourceMappingIds: [...mapping.sourceMappingIds],
    candidatePrincipleNumbers: candidateNumbers,
    contextRefValidation: { accepted: accepted.length, rejected },
    knowledgePackVersion: TRIZ_KNOWLEDGE_PACK_VERSION,
    requiresHumanConfirmation: true as const,
    persisted: false as const,
  }

  if (selected.length === 0) {
    qualityFlags.push('INSUFFICIENT_MAPPING')
    return {
      ...base,
      solutions: [],
      entityBinding: 'none',
      excludedPrincipleNumbers: [],
      qualityFlags,
      insufficientMapping: true,
    }
  }

  const sourceMapping =
    mapping.sourceMappingIds.map((id) => findSourceMapping(id)).find((entry) => entry !== null) ??
    null

  const context: ComposeContext = { mapping, pack, anchors, sourceMapping, limits }
  const drafts = selected
    .map((entry, position) => buildOneSolution(entry, position, context))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  // 保留知识包推荐序的稳定兜底：分数相同按（非补足 → 补足）、再按映射 rank 升序
  const ordered = [...drafts].sort(
    (a, b) =>
      b.solution.ranking.score - a.solution.ranking.score ||
      Number(a.solution.toppedUp) - Number(b.solution.toppedUp) ||
      a.solution.principle.number - b.solution.principle.number,
  )

  const top = ordered.slice(0, TRIZ_SOLUTION_TOP_COUNT).map((entry, index) => ({
    ...entry.solution,
    index: index + 1,
  }))

  if (ordered.some((entry) => entry.truncated)) qualityFlags.push('CONTENT_TRUNCATED')
  if (candidateNumbers.length > TRIZ_SOLUTION_TOP_COUNT) qualityFlags.push('CANDIDATES_TRUNCATED')
  if (selected.some((entry) => entry.toppedUp)) qualityFlags.push('CANDIDATES_TOPPED_UP')
  if (top.length < TRIZ_SOLUTION_TOP_COUNT) qualityFlags.push('SOLUTION_COUNT_UNDER_LIMIT')

  const boundCount = top.filter((solution) => solution.entityBinding === 'bound').length
  if (boundCount === 0) qualityFlags.push('GENERIC_ADVICE_NO_ENTITY')
  const entityBinding: TrizSolutionSetBinding =
    boundCount === top.length && top.length > 0 ? 'bound' : boundCount === 0 ? 'none' : 'partial'

  const selectedNumbers = new Set(top.map((solution) => solution.principle.number))

  return {
    ...base,
    solutions: top,
    entityBinding,
    excludedPrincipleNumbers: candidateNumbers.filter((number) => !selectedNumbers.has(number)),
    qualityFlags,
    insufficientMapping: false,
  }
}

/** 落库投影：只保留序号 / 原则编号 / 有界标题 / 实体引用 / 排序分（RL-12）。 */
export function toTrizSolutionLowSensitivityRecord(
  set: TrizSolutionDraftSet,
): TrizSolutionLowSensitivityRecord {
  return {
    path: set.path,
    entityBinding: set.entityBinding,
    solutions: set.solutions.map((solution) => ({
      index: solution.index,
      principleNumber: solution.principle.number,
      title: solution.title,
      score: solution.ranking.score,
      entityRefs: [...solution.entityRefs],
    })),
    excludedPrincipleNumbers: [...set.excludedPrincipleNumbers],
    contextRefValidation: { ...set.contextRefValidation },
    qualityFlags: [...set.qualityFlags],
    knowledgePackVersion: set.knowledgePackVersion,
  }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface TrizSolutionDraftRequest {
  mapping: TrizContradictionMappingDraft
  contextPack: TrizContextPack
  limits?: Partial<TrizSolutionLimits>
}

/**
 * Top 3 方案草案服务：纯确定性组装（无 IO、无模型调用、无写入端口），
 * 因此同步返回；构造函数传入的限额与请求级限额都只允许收紧。
 */
export default class TrizSolutionDraftService {
  readonly #limits: Partial<TrizSolutionLimits>

  constructor(limits: Partial<TrizSolutionLimits> = {}) {
    this.#limits = limits
  }

  build(request: TrizSolutionDraftRequest): TrizSolutionDraftSet {
    return buildTrizSolutionDrafts({
      mapping: request.mapping,
      contextPack: request.contextPack,
      limits: { ...this.#limits, ...request.limits },
    })
  }
}
