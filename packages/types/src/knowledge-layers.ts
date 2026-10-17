/**
 * knowledge-layers —— 四层知识底座共享契约与确定性纯函数引擎（V3 四层知识体系）。
 *
 * 定义 L1–L4 四层知识模型、分层元数据契约、来源溯源（Provenance/SourceRef）、
 * 审核记录（ReviewRecord）、知识生命周期状态机与相关守卫/校验函数。
 *
 * 零运行时依赖原则：不导入 zod / adonisjs / compiler-spec / Date.now()。
 * 参考时间由调用方显式传入，保持纯函数确定性。
 *
 * @aiproj/types 零依赖约束
 */

// ── 知识层枚举 ──────────────────────────────────────────────────────

/** 四层知识层（L1 规范 / L2 观察 / L3 合成 / L4 现实）。 */
export const KNOWLEDGE_LAYERS = ['L1', 'L2', 'L3', 'L4'] as const

export type KnowledgeLayer = (typeof KNOWLEDGE_LAYERS)[number]

export function isKnowledgeLayer(value: string): value is KnowledgeLayer {
  return (KNOWLEDGE_LAYERS as readonly string[]).includes(value)
}

// ── 分层元数据 ──────────────────────────────────────────────────────

/** 每层规定的可信度级别。 */
export type KnowledgeTrustLevel = '高（规范）' | '高（一手）' | '低到中' | '仅测试'

/** 每层规定的来源类型描述。 */
export type KnowledgeSourceType = '权威标准' | '真实经验' | '合成案例' | '产品数据'

/** 每层规定的使用方式描述。 */
export type KnowledgeUsageMode = '直接引用' | '参考' | '仅测试' | '匿名聚合'

/** 每层规定的更新频率描述。 */
export type KnowledgeUpdateFrequency = '定期评审' | '持续采集' | '按需合成' | '自动采集'

/** 分层元数据——每条知识记录的 layer-specific 上下文。 */
export interface LayerMetadata {
  /** 所属知识层。 */
  layer: KnowledgeLayer
  /** 该层规定的可信度。 */
  trust: KnowledgeTrustLevel
  /** 该层规定的来源类型。 */
  source: KnowledgeSourceType
  /** 该层规定的使用方式。 */
  usage: KnowledgeUsageMode
  /** 该层规定的更新频率。 */
  frequency: KnowledgeUpdateFrequency
  /** 标注要求（如 L3 强制 SYNTHETIC 水印、L4 强制去标识化）。 */
  annotation: string[]
}

/** 每层预设的元数据契约。 */
export const LAYER_METADATA: Record<KnowledgeLayer, LayerMetadata> = {
  L1: {
    layer: 'L1',
    trust: '高（规范）',
    source: '权威标准',
    usage: '直接引用',
    frequency: '定期评审',
    annotation: ['必须标注标准名称与版本', '引用需注明章节号'],
  },
  L2: {
    layer: 'L2',
    trust: '低到中',
    source: '真实经验',
    usage: '参考',
    frequency: '持续采集',
    annotation: ['必须标注来源项目/团队', '需记录观察时间'],
  },
  L3: {
    layer: 'L3',
    trust: '仅测试',
    source: '合成案例',
    usage: '仅测试',
    frequency: '按需合成',
    annotation: ['强制 SYNTHETIC 水印', '必须标注 baseKnowledge 与生成参数', '禁止进入生产检索'],
  },
  L4: {
    layer: 'L4',
    trust: '高（一手）',
    source: '产品数据',
    usage: '匿名聚合',
    frequency: '自动采集',
    annotation: ['必须去标识化', '原始数据限 90 天', '聚合优先返回'],
  },
}

// ── 来源溯源 ────────────────────────────────────────────────────────

/**
 * 知识来源引用（复用 v2-traceability-source-attribution 的溯源模式）。
 * 每条知识记录至少需要一个 SourceRef。
 */
export interface SourceRef {
  /** 所属知识层。 */
  layer: KnowledgeLayer
  /** 来源唯一标识符。 */
  sourceId: string
  /** 来源标题/名称。 */
  title: string
  /** 章节/条款号（L1 规范特有）。 */
  section?: string
  /** 来源 URL（L2 观察/经验）。 */
  url?: string
  /** 检索时间（ISO 8601）。 */
  retrievedAt?: string
  /** 是否为合成知识。L3 强制 true。 */
  isSynthetic?: boolean
  /** 合成方法描述（L3 必填）。 */
  syntheticMethod?: string
}

/**
 * 审核记录——只追加不可删除。
 * 每次知识记录的状态/内容变更均追加一条 ReviewRecord。
 */
export interface ReviewRecord {
  /** 审核者用户 ID。 */
  reviewer: number
  /** 审核动作（如 reviewed / deprecated / outdated / confirmed / rejected）。 */
  action: string
  /** 操作时间（ISO 8601）。 */
  timestamp: string
  /** 审核备注/理由。 */
  note?: string
}

/** 来源溯源汇总——每条知识记录必须携带。 */
export interface Provenance {
  /** 来源引用列表（至少一项）。 */
  sources: SourceRef[]
  /** 审核历史（只追加不可删除）。 */
  reviewHistory: ReviewRecord[]
}

// ── 生命周期状态机 ──────────────────────────────────────────────────

export const KNOWLEDGE_LIFECYCLE_STATUSES = [
  'draft',
  'pending',
  'active',
  'deprecated',
  'outdated',
] as const

export type KnowledgeLifecycleStatus = (typeof KNOWLEDGE_LIFECYCLE_STATUSES)[number]

export function isKnowledgeLifecycleStatus(value: string): value is KnowledgeLifecycleStatus {
  return (KNOWLEDGE_LIFECYCLE_STATUSES as readonly string[]).includes(value)
}

/**
 * 知识生命周期合法转移表。
 * - `draft → pending`（AI 结构化提交候选）
 * - `pending → active`（人工确认转正）
 * - `pending → draft`（退回重新编辑）
 * - `active → deprecated`（主动废弃）
 * - `active → outdated`（定期评审标记过时）
 * - `deprecated → active`（重新激活）
 * - `outdated → active`（复核后恢复）
 * - `outdated → deprecated`（过时确认废弃）
 * - `deprecated` / `outdated` 为半终态，可从它们转移回 active。
 */
export const KNOWLEDGE_LIFECYCLE_TRANSITIONS: Record<string, true> = {
  'draft→pending': true,
  'pending→active': true,
  'pending→draft': true,
  'active→deprecated': true,
  'active→outdated': true,
  'deprecated→active': true,
  'outdated→active': true,
  'outdated→deprecated': true,
}

/** 转移原因码（稳定，供前后端共用）。 */
export const KNOWLEDGE_TRANSITION_REASON_CODES = [
  'KNOWLEDGE_TRANSITION_INVALID',
  'KNOWLEDGE_TERMINAL_STATE',
  'KNOWLEDGE_CONFIRMATION_REQUIRED',
  'KNOWLEDGE_ALREADY_ACTIVE',
  'KNOWLEDGE_NOT_DRAFT',
] as const

export type KnowledgeTransitionReasonCode = (typeof KNOWLEDGE_TRANSITION_REASON_CODES)[number]

export interface KnowledgeTransitionResult {
  valid: boolean
  reasonCode: KnowledgeTransitionReasonCode
  resultingStatus?: KnowledgeLifecycleStatus
}

/**
 * 确定性生命周期转移校验（纯函数）。
 * - 不合法转移返回 `valid: false` 与对应 reason code。
 * - 合法转移返回 `valid: true` 与 resultingStatus。
 */
export function validateKnowledgeLifecycleTransition(
  from: KnowledgeLifecycleStatus,
  to: KnowledgeLifecycleStatus,
): KnowledgeTransitionResult {
  const key = `${from}→${to}`

  if (!KNOWLEDGE_LIFECYCLE_TRANSITIONS[key]) {
    return {
      valid: false,
      reasonCode: 'KNOWLEDGE_TRANSITION_INVALID',
    }
  }

  // pending → active 需人工确认——状态机允许（由 Service 层 enforce）
  // active 不可直接转 pending（必须经 draft/pending 周期）
  // draft 不可直接转 active（必须经 pending）

  return {
    valid: true,
    reasonCode: 'KNOWLEDGE_CONFIRMATION_REQUIRED',
    resultingStatus: to,
  }
}

// ── 知识记录全量实体 ────────────────────────────────────────────────

/** 知识记录——四层知识底座的核心数据实体。 */
export interface KnowledgeItem {
  id: number
  organizationId: number
  /** 知识层（L1/L2/L3/L4），不可为空，不可多属。 */
  layer: KnowledgeLayer
  /** 分层元数据快照（写入时由 Service 从 LAYER_METADATA 填充）。 */
  layerMeta: LayerMetadata
  /** 知识记录标题。 */
  title: string
  /** 知识记录内容（结构化 JSON 或纯文本）。 */
  content: Record<string, unknown> | string
  /** 生命周期状态。 */
  status: KnowledgeLifecycleStatus
  /** 领域标签（如 "项目管理"、"风险管理"、"进度管理"）。 */
  domain: string
  /** 用途分类（如 "规划"、"执行"、"监控"）。 */
  purpose: string
  /** 复杂度标签（如 "初级"、"中级"、"高级"）。 */
  complexity?: string
  /** 来源溯源（sources 非空，reviewHistory 只追加）。 */
  provenance: Provenance
  /** 是否为合成知识（L3 强制 true）。 */
  isSynthetic: boolean
  /** 合成方法描述（L3 必填，含 baseKnowledge 引用与生成参数）。 */
  syntheticMethod?: string
  /** 知识创建者用户 ID。 */
  createdBy: number
  /** 知识更新者用户 ID。 */
  updatedBy?: number
  /** 最后引用时间（ISO 8601，用于 L2 降级判定）。 */
  lastReferencedAt?: string
  /** 保留期天数（L4 默认 90 天）。 */
  retentionDays?: number
  /** 创建时间（ISO 8601）。 */
  createdAt: string
  /** 更新时间（ISO 8601）。 */
  updatedAt: string
}

/** 低敏投影——面向公开 API 返回的知识记录摘要（不含完整 content 与敏感字段）。 */
export interface KnowledgeItemLowSensitiveProjection {
  id: number
  layer: KnowledgeLayer
  title: string
  status: KnowledgeLifecycleStatus
  domain: string
  purpose: string
  complexity?: string
  provenance: Omit<Provenance, 'reviewHistory'>
  isSynthetic: boolean
  createdAt: string
  updatedAt: string
}

// ── 检索查询 DTO ────────────────────────────────────────────────────

/** 知识检索查询参数（统一检索接口）。 */
export interface KnowledgeQuery {
  /** 按层过滤（缺省 = 所有层，生产路径默认排除 L3）。 */
  layer?: KnowledgeLayer
  /** 按领域过滤。 */
  domain?: string
  /** 按用途过滤。 */
  purpose?: string
  /** 按复杂度过滤。 */
  complexity?: string
  /** 按生命周期状态过滤（缺省 = active；显式传值可查看待审/草稿等治理视图）。 */
  status?: KnowledgeLifecycleStatus
  /** 是否为 Eval 上下文（true 才放行 L3）。 */
  evalContext?: boolean
  /** 搜索关键词（用于向量/关键词检索）。 */
  keyword?: string
  /** 分页页码。 */
  page?: number
  /** 每页条数。 */
  perPage?: number
}

/** 知识检索结果 DTO。 */
export interface KnowledgeQueryResult {
  data: KnowledgeItemLowSensitiveProjection[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

// ── 知识录入 DTO ────────────────────────────────────────────────────

/** 知识录入请求（L1/L2 录入）。 */
export interface CreateKnowledgeRequest {
  layer: KnowledgeLayer
  title: string
  content: Record<string, unknown> | string
  domain: string
  purpose: string
  complexity?: string
  provenance: Omit<Provenance, 'reviewHistory'>
}

/** AI 结构化请求——对原文产出结构化候选知识记录。 */
export interface AiStructureKnowledgeRequest {
  /** 原始文本内容。 */
  rawText: string
  /** 目标知识层（L1/L2）。 */
  targetLayer: 'L1' | 'L2'
  /** 领域提示（可选）。 */
  domain?: string
  /** 用途提示（可选）。 */
  purpose?: string
}

/** AI 结构化结果——仅返回待审草案。 */
export interface AiStructureKnowledgeResult {
  /** 结构化后的知识记录候选（status 固定为 draft/pending）。 */
  candidates: Omit<KnowledgeItem, 'id' | 'createdAt' | 'updatedAt'>[]
  /** AI 置信度（0-1，仅供展示，不豁免人工确认）。 */
  confidence: number
  /** 结构化建议说明（advisory only）。 */
  advisoryNotes: string
}

// ── 合成治理 DTO ────────────────────────────────────────────────────

/** L3 合成请求——由 L1+L2 交叉验证生成合成案例。 */
export interface SynthesizeL3Request {
  /** 引用的 L1/L2 源记录 ID 列表。 */
  baseKnowledgeIds: number[]
  /** 生成模型名称。 */
  model: string
  /** 生成温度。 */
  temperature: number
  /** 生成种子（可复现）。 */
  seed: number
  /** 合成目标领域。 */
  domain: string
  /** 合成用途。 */
  purpose: string
  /** 审核者用户 ID。 */
  reviewedBy?: number
}

// ── 导出 LAYER_METADATA 的便捷查询函数 ──────────────────────────────

/**
 * 返回指定层的预设元数据（纯函数）。
 * 非法层返回 null。
 */
export function getLayerMetadata(layer: KnowledgeLayer): LayerMetadata {
  return LAYER_METADATA[layer]
}

/**
 * 校验 KnowledgeItem 的层相关约束（纯函数，不依赖外部状态）。
 * 返回校验错误列表——空列表 = 通过。
 */
export function validateKnowledgeItemConstraints(item: {
  layer: KnowledgeLayer
  isSynthetic: boolean
  syntheticMethod?: string
  provenance: { sources: SourceRef[] }
}): string[] {
  const errors: string[] = []

  // L3 强制 isSynthetic = true
  if (item.layer === 'L3' && !item.isSynthetic) {
    errors.push('L3 知识必须 isSynthetic = true')
  }

  // L3 强制 syntheticMethod 非空
  if (item.layer === 'L3' && (!item.syntheticMethod || item.syntheticMethod.trim() === '')) {
    errors.push('L3 知识必须提供 syntheticMethod')
  }

  // provenance.sources 非空
  if (!item.provenance.sources || item.provenance.sources.length === 0) {
    errors.push('provenance.sources 不能为空，至少需要一个 SourceRef')
  }

  // 非 L3 的 isSynthetic 应为 false
  if (item.layer !== 'L3' && item.isSynthetic) {
    errors.push('非 L3 知识 isSynthetic 必须为 false')
  }

  return errors
}
