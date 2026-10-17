// @aiproj/types — V2 TRIZ 矛盾模型基础层共享契约（前后端共享）
// v2-triz-contradiction-model-foundation / D1–D8
//
// 设计要点：
// - 矛盾分两类：技术矛盾（improving ↔ worsening 参数对）与物理矛盾（同参数对立要求）。
// - 项目域工程参数目录与 PM 适配发明原理目录均为可扩展 registry，新增不改表结构。
// - 确定性优先：签名/hash/dedupeKey 工具保证可复现、可幂等刷新、可追溯。
// - 全部「只建议、不自动执行」；AI 解释草稿仅为待审核文本。

// ---------------------------------------------------------------------------
// 核心枚举与常量
// ---------------------------------------------------------------------------

/** 矛盾类型 */
export const CONTRADICTION_TYPES = ['technical', 'physical'] as const
export type ContradictionType = (typeof CONTRADICTION_TYPES)[number]

/** 矛盾状态机：draft → confirmed / dismissed / superseded */
export const CONTRADICTION_STATUSES = ['draft', 'confirmed', 'dismissed', 'superseded'] as const
export type ContradictionStatus = (typeof CONTRADICTION_STATUSES)[number]

/** 严重度等级（无 none：矛盾一旦派生即至少 low） */
export const CONTRADICTION_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type ContradictionSeverity = (typeof CONTRADICTION_SEVERITIES)[number]

/** 参数方向（改善 / 恶化） */
export const PARAMETER_DIRECTIONS = ['improving', 'worsening'] as const
export type ParameterDirection = (typeof PARAMETER_DIRECTIONS)[number]

/** 矛盾检测规则 ID 白名单（V2 首版） */
export const CONTRADICTION_RULE_IDS = [
  'CD-001', // 工期压缩 ↔ 成本/风险/质量
  'CD-002', // 资源利用率↑ ↔ 负载/稳定性
  'CD-003', // 范围↑ ↔ 工期/质量
  'CD-004', // 风险降低 ↔ 成本/工期
  'CD-005', // 关键路径密度↑ ↔ 灵活性
  'CD-006', // 物理矛盾：范围既要全又要快
] as const
export type ContradictionRuleId = (typeof CONTRADICTION_RULE_IDS)[number]

/** 规则集版本（随规则演进而递增；签名一致判定未变化时比对） */
export const CONTRADICTION_RULESET_VERSION = '1.0.0'

/** 列表排序字段 */
export const CONTRADICTION_SORT_FIELDS = ['severity', 'createdAt', 'confidence', 'type'] as const
export type ContradictionSortField = (typeof CONTRADICTION_SORT_FIELDS)[number]

// ---------------------------------------------------------------------------
// 项目域工程参数目录（D2：精选 12 项，非 TRIZ 完整 39 项）
// ---------------------------------------------------------------------------

export const PROJECT_PARAMETER_KEYS = [
  'duration',
  'cost',
  'resource_load',
  'quality',
  'scope',
  'risk_level',
  'flexibility',
  'stability',
  'information_completeness',
  'maintainability',
  'uncertainty',
  'throughput',
] as const
export type ProjectParameterKey = (typeof PROJECT_PARAMETER_KEYS)[number]

export interface ProjectParameterCatalogEntry {
  key: ProjectParameterKey
  /** 中文权威名（展示与报告用；key 仅作稳定引用） */
  name: string
  /** 说明 */
  description: string
  /** improving 方向语义（数值越大越好 / 越小越好） */
  improving: string
  /** worsening 方向语义 */
  worsening: string
}

/**
 * 项目域工程参数目录。registry 化：新增参数只追加本数组，不改表结构。
 */
export const PROJECT_PARAMETERS: readonly ProjectParameterCatalogEntry[] = [
  {
    key: 'duration',
    name: '工期/进度',
    description: '完成项目或任务所需的时间长度',
    improving: '工期缩短 / 提前进度',
    worsening: '工期延长 / 进度滞后',
  },
  {
    key: 'cost',
    name: '成本',
    description: '完成项目所消耗的资源费用',
    improving: '成本降低 / 预算节约',
    worsening: '成本上升 / 超预算',
  },
  {
    key: 'resource_load',
    name: '资源负载',
    description: '资源（人/设备）被占用的程度',
    improving: '利用率提高 / 负载饱满',
    worsening: '负载过载 / 过度占用',
  },
  {
    key: 'quality',
    name: '质量/验收符合度',
    description: '交付物满足验收标准的程度',
    improving: '质量提升 / 符合度提高',
    worsening: '质量下降 / 缺陷增多',
  },
  {
    key: 'scope',
    name: '范围',
    description: '项目需交付的工作与功能范围',
    improving: '范围扩大 / 覆盖更全',
    worsening: '范围缩减 / 交付不足',
  },
  {
    key: 'risk_level',
    name: '风险水平',
    description: '项目整体风险敞口的高低',
    improving: '风险降低 / 敞口收窄',
    worsening: '风险升高 / 敞口扩大',
  },
  {
    key: 'flexibility',
    name: '灵活性/柔性',
    description: '应对变更与调整的能力',
    improving: '灵活性提高 / 调整空间大',
    worsening: '灵活性降低 / 刚性增强',
  },
  {
    key: 'stability',
    name: '稳定性',
    description: '计划与资源安排的稳定程度',
    improving: '稳定性提高 / 波动小',
    worsening: '稳定性降低 / 波动大',
  },
  {
    key: 'information_completeness',
    name: '信息完整度',
    description: '项目信息与需求描述的完整程度',
    improving: '信息更完整 / 不确定性降低',
    worsening: '信息缺失 / 假设增多',
  },
  {
    key: 'maintainability',
    name: '可维护/可修复性',
    description: '交付物后续维护与修复的难易',
    improving: '更易维护与修复',
    worsening: '维护与修复困难',
  },
  {
    key: 'uncertainty',
    name: '不确定性',
    description: '项目目标与路径的不确定程度',
    improving: '不确定性降低 / 路径清晰',
    worsening: '不确定性升高 / 路径模糊',
  },
  {
    key: 'throughput',
    name: '交付吞吐',
    description: '单位时间内交付工作量的速率',
    improving: '吞吐提高 / 交付提速',
    worsening: '吞吐下降 / 交付减速',
  },
]

const PROJECT_PARAMETER_MAP: Record<string, ProjectParameterCatalogEntry> = Object.fromEntries(
  PROJECT_PARAMETERS.map((p) => [p.key, p]),
)

/** 查找参数目录项；目录外参数返回 undefined（调用方据此降级）。 */
export function getParameter(key: string): ProjectParameterCatalogEntry | undefined {
  return PROJECT_PARAMETER_MAP[key]
}

/** 参数 key 是否在目录内。 */
export function isProjectParameterKey(key: string): key is ProjectParameterKey {
  return key in PROJECT_PARAMETER_MAP
}

// ---------------------------------------------------------------------------
// PM 适配发明原理目录（D3：精选 10 项 + 中文落地建议模板）
// ---------------------------------------------------------------------------

export const INVENTIVE_PRINCIPLE_IDS = [
  'segmentation',
  'preliminary_action',
  'dynamics',
  'periodic_action',
  'mechanics_substitution',
  'parameter_change',
  'inversion',
  'intermediary',
  'self_service',
  'before_in_conclusion',
] as const
export type InventivePrincipleId = (typeof INVENTIVE_PRINCIPLE_IDS)[number]

export interface InventivePrincipleCatalogEntry {
  principleId: InventivePrincipleId
  /** 中文权威名 */
  name: string
  /** 说明 */
  description: string
  /** 项目落地建议模板（待人审，非自动应用） */
  projectAdvice: string
}

/**
 * PM 适配发明原理目录。registry 化：新增原理只追加本数组，不改表结构。
 */
export const INVENTIVE_PRINCIPLES: readonly InventivePrincipleCatalogEntry[] = [
  {
    principleId: 'segmentation',
    name: '分割/分解',
    description: '把整体拆分为相互独立的部分',
    projectAdvice: '将大任务拆分为更小阶段或子任务，分段管理关键路径，降低单点风险',
  },
  {
    principleId: 'preliminary_action',
    name: '预先作用',
    description: '提前完成部分准备或前置动作',
    projectAdvice: '为关键依赖预留前置缓冲，提前准备资源与验收材料，缩短关键路径等待',
  },
  {
    principleId: 'dynamics',
    name: '动态化',
    description: '使固定的特性或结构变为可调整',
    projectAdvice: '采用弹性范围与滚动规划，设置缓冲带与可调整里程碑，提升灵活性',
  },
  {
    principleId: 'periodic_action',
    name: '周期性作用',
    description: '用周期/迭代替代连续动作',
    projectAdvice: '推行迭代与阶段化交付，按周期复盘与重排，平衡范围与工期',
  },
  {
    principleId: 'mechanics_substitution',
    name: '机械替代',
    description: '用自动化/智能手段替代纯人工流程',
    projectAdvice: '用 AI 辅助或自动化工具替代重复人工环节（如报告、状态汇总），提升吞吐',
  },
  {
    principleId: 'parameter_change',
    name: '参数变化',
    description: '改变状态、优先级或口径',
    projectAdvice: '调整任务优先级、状态口径或资源配比，重新分配负载以缓解过载',
  },
  {
    principleId: 'inversion',
    name: '反向',
    description: '颠倒原有顺序或视角',
    projectAdvice: '从最终里程碑倒排计划，或从约束端反推资源，发现工期与质量的平衡点',
  },
  {
    principleId: 'intermediary',
    name: '中介物',
    description: '引入中间过渡对象',
    projectAdvice: '引入中间里程碑、缓冲资源或第三方校验环节，隔离对立要求',
  },
  {
    principleId: 'self_service',
    name: '自服务',
    description: '让对象自行完成部分功能',
    projectAdvice: '让成员自助更新进度与证据，减少管理协调开销，提升信息完整度',
  },
  {
    principleId: 'before_in_conclusion',
    name: '预先防范',
    description: '事先准备应对措施',
    projectAdvice: '为高风险项预置降级预案与应急资源，降低风险水平对工期的冲击',
  },
]

const INVENTIVE_PRINCIPLE_MAP: Record<string, InventivePrincipleCatalogEntry> = Object.fromEntries(
  INVENTIVE_PRINCIPLES.map((p) => [p.principleId, p]),
)

/** 查找原理目录项；目录外原理返回 undefined。 */
export function getInventivePrinciple(
  principleId: string,
): InventivePrincipleCatalogEntry | undefined {
  return INVENTIVE_PRINCIPLE_MAP[principleId]
}

/** 原理 ID 是否在目录内。 */
export function isInventivePrincipleId(id: string): id is InventivePrincipleId {
  return id in INVENTIVE_PRINCIPLE_MAP
}

// ---------------------------------------------------------------------------
// 证据与建议
// ---------------------------------------------------------------------------

/**
 * 低敏证据引用：只引用既有实体的类型/ID/标题与短摘要 + 可选 hash。
 * 禁止包含完整正文、敏感文件路径或无权限目标详情。
 */
export interface ContradictionEvidence {
  entityType: string
  entityId: number
  title: string
  /** 低敏短摘要（≤ 120 字） */
  detail: string
  isVisible: boolean
}

/** 候选发明原理建议（待人审文本）。 */
export interface SuggestedPrinciple {
  principleId: InventivePrincipleId
  /** 中文名（冗余自目录，便于前端低敏展示） */
  name: string
  /** 相关度打分（0–1，确定性映射得出） */
  relevance: number
  /** 中文落地建议（来自目录模板或映射） */
  advice: string
}

// ---------------------------------------------------------------------------
// 候选矛盾（规则派生产物，未持久化时 id/dedupeKey 由工具计算）
// ---------------------------------------------------------------------------

/**
 * 候选矛盾：规则集派生的结构化对立。
 * technical 用 improvingParameterKey/worseningParameterKey；
 * physical 用 parameterKey + requirementA/requirementB。
 */
export interface CandidateContradiction {
  type: ContradictionType
  ruleId: ContradictionRuleId
  severity: ContradictionSeverity
  /** 置信度（0–1） */
  confidence: number
  /** technical：改善参数 */
  improvingParameterKey: ProjectParameterKey | null
  /** technical：恶化参数 */
  worseningParameterKey: ProjectParameterKey | null
  /** technical：改善方向描述 */
  improvingDirection: string | null
  /** technical：恶化方向描述 */
  worseningDirection: string | null
  /** physical：对立参数 */
  parameterKey: ProjectParameterKey | null
  /** physical：要求 A */
  requirementA: string | null
  /** physical：要求 B */
  requirementB: string | null
  /** 低敏中文标题 */
  title: string
  evidence: ContradictionEvidence[]
  /** 影响范围（参与严重度与去重） */
  affectedScope: string[]
}

// ---------------------------------------------------------------------------
// 输入快照（只读收集产物）
// ---------------------------------------------------------------------------

export interface ContradictionInputSnapshot {
  organizationId: number
  projectId: number
  /** 任务总数 */
  taskTotal: number
  /** 逾期任务数 */
  overdueTaskCount: number
  /** 关键路径任务数 */
  criticalPathTaskCount: number
  /** 关键路径任务占比（0–1） */
  criticalPathDensity: number
  /** 资源利用率（0–1，平均） */
  resourceUtilization: number | null
  /** 资源过载数（负载 > 容量） */
  resourceOverloadCount: number
  /** 活跃风险数 */
  activeRiskCount: number
  /** 高风险数 */
  highRiskCount: number
  /** 里程碑数 */
  milestoneTotal: number
  /** 已登记变更请求数 */
  changeRequestCount: number
  /** 计划总工期（天，来自项目结束-开始） */
  plannedDurationDays: number | null
  /** 范围条目数（任务+WBS 叶，近似范围广度） */
  scopeItemCount: number
  /** 数据源可用性 warning（模块缺失时填充） */
  warnings: ContradictionInputWarning[]
  ruleVersion: string
}

export interface ContradictionInputWarning {
  code: string
  message: string
  source?: string
}

// ---------------------------------------------------------------------------
// 持久化矛盾记录（API DTO 视角）
// ---------------------------------------------------------------------------

export interface ContradictionDTO {
  id: number
  organizationId: number
  projectId: number
  key: string
  dedupeKey: string
  type: ContradictionType
  status: ContradictionStatus
  ruleId: ContradictionRuleId
  ruleVersion: string
  severity: ContradictionSeverity
  confidence: number
  // technical
  improvingParameterKey: ProjectParameterKey | null
  worseningParameterKey: ProjectParameterKey | null
  improvingDirection: string | null
  worseningDirection: string | null
  // physical
  parameterKey: ProjectParameterKey | null
  requirementA: string | null
  requirementB: string | null
  title: string
  evidence: ContradictionEvidence[]
  suggestedPrinciples: SuggestedPrinciple[]
  inputSignature: string
  outputHash: string | null
  stale: boolean
  staleReason: string | null
  relatedChangeRequestId: number | null
  confirmedBy: number | null
  confirmedAt: string | null
  dismissedBy: number | null
  dismissedAt: string | null
  dismissReason: string | null
  aiExplanation: ContradictionAiExplanation | null
  createdAt: string
  updatedAt: string | null
}

/**
 * 矛盾 AI 解释草稿（待审核）。
 * 仅存低敏摘要、可追溯的原理/参数引用、成本元数据；禁止存完整 prompt 或模型输出。
 */
export interface ContradictionAiExplanation {
  /** 中文叙述草稿（矛盾叙述 + 为何适用候选原理） */
  narrative: string
  /** 是否降级为规则摘要 fallback */
  isFallback: boolean
  /** 是否通过反幻觉与结构化输出基线 */
  hallucinationChecked: boolean
  /** 反幻觉未通过原因（降级时填充） */
  degradedReason: string | null
  /** 引用的候选原理 ID（须可追溯到 suggestedPrinciples） */
  referencedPrincipleIds: InventivePrincipleId[]
  /** 引用的参数 key（须可追溯到矛盾参数） */
  referencedParameterKeys: ProjectParameterKey[]
  confidence: number
  provider: string | null
  model: string | null
  needsConfirmation: boolean
  /** 成本摘要（不存正文） */
  cost?: ContradictionAiCost
}

/** AI 调用成本摘要（compiler-observability-cost-controls 契约的低敏子集）。 */
export interface ContradictionAiCost {
  promptTokens: number | null
  completionTokens: number | null
  estimatedCost: number | null
  latencyMs: number | null
  finishReason: string | null
  errorCategory: string | null
  inputHash: string | null
  outputRef: string | null
}

// ---------------------------------------------------------------------------
// API 请求/响应类型
// ---------------------------------------------------------------------------

export interface ListContradictionsResponse {
  data: ContradictionDTO[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ContradictionDetailResponse {
  data: ContradictionDTO
}

export interface ContradictionSummaryResponse {
  data: ContradictionDashboardSummary
}

/** Dashboard 只读、权限脱敏的矛盾摘要。无 view 权限时调用方应不展示。 */
export interface ContradictionDashboardSummary {
  unresolvedCount: number
  staleCount: number
  /** Top 矛盾低敏摘要（标题 + 参数对，无证据细节） */
  topContradictions: Array<{
    id: number
    type: ContradictionType
    title: string
    severity: ContradictionSeverity
    improvingParameterKey: ProjectParameterKey | null
    worseningParameterKey: ProjectParameterKey | null
    parameterKey: ProjectParameterKey | null
  }>
  warnings: string[]
}

export interface RefreshContradictionsResponse {
  data: {
    created: number
    unchanged: number
    superseded: number
    total: number
    ruleVersion: string
    inputSignature: string
    outputHash: string | null
  }
}

// ---------------------------------------------------------------------------
// 严重度排序与工具函数
// ---------------------------------------------------------------------------

export const CONTRADICTION_SEVERITY_ORDER: ContradictionSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
]

export function severityRank(severity: ContradictionSeverity): number {
  const idx = CONTRADICTION_SEVERITY_ORDER.indexOf(severity)
  return idx >= 0 ? CONTRADICTION_SEVERITY_ORDER.length - idx : 0
}

export function maxContradictionSeverity(
  a: ContradictionSeverity,
  b: ContradictionSeverity,
): ContradictionSeverity {
  return severityRank(a) >= severityRank(b) ? a : b
}

/**
 * 候选矛盾稳定排序比较器：严重度 → 置信度 → ruleId → 标题。
 * 同输入必产出同序，保证 outputHash 稳定。
 */
export function compareCandidateContradiction(
  a: CandidateContradiction,
  b: CandidateContradiction,
): number {
  const bySeverity = severityRank(b.severity) - severityRank(a.severity)
  if (bySeverity !== 0) return bySeverity
  const byConf = (b.confidence ?? 0) - (a.confidence ?? 0)
  if (Math.abs(byConf) > 1e-9) return byConf
  if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId)
  return a.title.localeCompare(b.title)
}

// ---------------------------------------------------------------------------
// 稳定签名 / hash / dedupeKey 工具
// ---------------------------------------------------------------------------

/** 简单确定性 32 位 hash（仅用于身份/幂等判定，非加密）。 */
export function deterministicHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

/**
 * 计算输入签名：对结构化输入做确定性序列化 + hash。
 * 字段顺序固定，保证同输入同签名（幂等刷新判定）。
 */
export function computeInputSignature(snapshot: ContradictionInputSnapshot): string {
  const sorted = {
    org: snapshot.organizationId,
    project: snapshot.projectId,
    taskTotal: snapshot.taskTotal,
    overdueTaskCount: snapshot.overdueTaskCount,
    criticalPathTaskCount: snapshot.criticalPathTaskCount,
    criticalPathDensity: Number(snapshot.criticalPathDensity?.toFixed(4) ?? 0),
    resourceUtilization:
      snapshot.resourceUtilization === null
        ? null
        : Number(snapshot.resourceUtilization.toFixed(4)),
    resourceOverloadCount: snapshot.resourceOverloadCount,
    activeRiskCount: snapshot.activeRiskCount,
    highRiskCount: snapshot.highRiskCount,
    milestoneTotal: snapshot.milestoneTotal,
    changeRequestCount: snapshot.changeRequestCount,
    plannedDurationDays: snapshot.plannedDurationDays,
    scopeItemCount: snapshot.scopeItemCount,
    warnings: [...snapshot.warnings].map((w) => `${w.source ?? ''}:${w.code}:${w.message}`).sort(),
    ruleVersion: snapshot.ruleVersion,
  }
  return `tcd-${deterministicHash(JSON.stringify(sorted))}`
}

/**
 * 计算 dedupeKey：同项目、同规则、同参数对（technical）/ 同参数+对立要求（physical）。
 * 用于按 dedupeKey 幂等合并，避免重复创建。
 */
export function computeDedupeKey(
  projectId: number,
  candidate: Pick<
    CandidateContradiction,
    | 'type'
    | 'ruleId'
    | 'improvingParameterKey'
    | 'worseningParameterKey'
    | 'parameterKey'
    | 'requirementA'
    | 'requirementB'
  >,
): string {
  const parts: string[] = [String(projectId), candidate.type, candidate.ruleId]
  if (candidate.type === 'technical') {
    const pair = [candidate.improvingParameterKey ?? '', candidate.worseningParameterKey ?? '']
      .sort()
      .join('<>')
    parts.push(pair)
  } else {
    parts.push(candidate.parameterKey ?? '')
    parts.push([candidate.requirementA ?? '', candidate.requirementB ?? ''].sort().join('<>'))
  }
  return `d-${deterministicHash(parts.join('|'))}`
}

/**
 * 计算候选矛盾集合的 output hash：对排序后的 dedupeKey 列表 hash。
 * 同输入产出同候选集 → 同 output hash，用于幂等刷新判定。
 */
export function computeOutputHash(candidates: CandidateContradiction[]): string {
  const keys = candidates
    .map((c) =>
      computeDedupeKey(0, c) // dedupeKey 不含 projectId 部分（外部注入），这里用 0 占位取稳定 hash
        .replace(/^d-/, ''),
    )
    .sort()
  return `out-${deterministicHash(keys.join('|'))}`
}
