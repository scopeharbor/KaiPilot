/**
 * v3-copilot-project-health-answer — 三类答案的共享契约类型。
 *
 * 三类答案（健康答案、页面用法答案、术语解释答案）共用同一套合成纪律：
 * - 确定性（同素材同答案）
 * - 有界（不超出摘要上限）
 * - 可追溯（每条结论指向来源）
 * - 权限过滤（缺席而非标注）
 *
 * @aiproj/types
 */

// ===========================================================================
// 答案类型枚举
// ===========================================================================

/** 答案类型。 */
export type CopilotAnswerKind = 'health' | 'page-usage' | 'term-explanation'

// ===========================================================================
// 答案条目形状
// ===========================================================================

/** 答案条目：一条可追溯的结论。 */
export interface CopilotAnswerEntry {
  /** 结论 ID（确定性生成）。 */
  readonly entryId: string
  /** 结论文本（低敏、简短、中文）。 */
  readonly statement: string
  /** 支撑该结论的来源引用集合。 */
  readonly sourceRefs: readonly CopilotSourceRef[]
  /** 置信度档。 */
  readonly confidence: CopilotConfidenceBand
  /** 分组（如维度、路由、术语域）。 */
  readonly group: string
}

import type {
  CopilotConfidenceBand,
  CopilotSourceKind as SharedCopilotSourceKind,
} from './copilot-shared-contracts.js'

/** 来源引用：可追溯到具体诊断项、预测信号、知识条目或命令元数据。 */
export interface CopilotSourceRef {
  /** 来源类型。 */
  readonly sourceKind: CopilotAnswerSourceKind
  /** 来源 ID（诊断项 ID、信号 ID、知识条目 ID、命令 ID）。 */
  readonly sourceId: string
  /** 来源摘要（低敏）。 */
  readonly summary: string
}

/** 答案来源类型。 */
export type CopilotAnswerSourceKind =
  | 'diagnosis-item'
  | 'prediction-signal'
  | 'knowledge-entry'
  | 'command-metadata'
  | SharedCopilotSourceKind

export type { CopilotConfidenceBand }

// ===========================================================================
// 「暂无足够依据」形状
// ===========================================================================

/** 答案缺少足够依据时的输出。 */
export interface CopilotAnswerInsufficient {
  /** 固定标识。 */
  readonly kind: 'insufficient'
  /** 缺失原因枚举。 */
  readonly reason: CopilotInsufficientReason
  /** 缺什么的说明（中文）。 */
  readonly missingWhat: string
}

/** 缺失原因枚举。 */
export type CopilotInsufficientReason =
  | 'no-diagnosis-record'
  | 'no-prediction-signal'
  | 'no-knowledge-entry'
  | 'no-command-metadata'
  | 'all-sources-inaccessible'
  | 'material-insufficient'

// ===========================================================================
// 答案输出
// ===========================================================================

/** 答案输出：要么是充足的结论集合，要么是「暂无足够依据」。 */
export type CopilotAnswerOutput = CopilotAnswerSufficient | CopilotAnswerInsufficient

/** 充足的答案输出。 */
export interface CopilotAnswerSufficient {
  /** 固定标识。 */
  readonly kind: 'sufficient'
  /** 答案类型。 */
  readonly answerKind: CopilotAnswerKind
  /** 结论条目集合。 */
  readonly entries: readonly CopilotAnswerEntry[]
  /** 答案文本（有界摘要）。 */
  readonly narrative: string
  /** 是否为模型不可用时的确定性模板降级。 */
  readonly isFallback: boolean
  /** 降级原因（仅 isFallback=true 时有值）。 */
  readonly fallbackReason?: string
  /** 跳转链接（可选，如健康诊断页面）。 */
  readonly deepLink?: CopilotAnswerDeepLink
}

/** 答案跳转链接。 */
export interface CopilotAnswerDeepLink {
  /** 链接文本（中文）。 */
  readonly label: string
  /** 路由路径。 */
  readonly href: string
}

// ===========================================================================
// 页面用法答案专用
// ===========================================================================

/** 页面用法答案条目：扩展基础条目，增加快捷键与示例。 */
export interface CopilotPageUsageEntry extends CopilotAnswerEntry {
  /** 快捷键提示（可选）。 */
  readonly shortcut?: string
  /** 「你可以这样问」示例（可选）。 */
  readonly examples?: readonly string[]
}

// ===========================================================================
// 术语解释答案专用
// ===========================================================================

/** 术语解释答案条目：扩展基础条目，增加术语来源标注。 */
export interface CopilotTermEntry extends CopilotAnswerEntry {
  /** 术语来源标注：来自本项目知识库还是组织词表。 */
  readonly termSource: 'project' | 'organization'
}

// ===========================================================================
// 禁存约束
// ===========================================================================

/**
 * 答案记录禁存边界。
 *
 * 合成答案只存有界低敏摘要与来源引用，不存 prompt、模型输出全文、token 与 secret。
 * 此类型用于校验答案记录的合规性。
 */
export interface CopilotAnswerStorageConstraint {
  /** 答案文本上限（字符数）。 */
  readonly MAX_NARRATIVE_LENGTH: 2000
  /** 禁止存储的字段模式。 */
  readonly FORBIDDEN_PATTERNS: readonly string[]
}

/** 答案文本有界摘要上限（字符数）。 */
export const COPILOT_ANSWER_MAX_NARRATIVE_LENGTH = 2000

// ===========================================================================
// 确定性模板（模型不可用降级）
// ===========================================================================

/** 确定性模板条目。 */
export interface CopilotAnswerTemplateEntry {
  /** 结论模板（含占位符）。 */
  readonly template: string
  /** 分组。 */
  readonly group: string
  /** 置信度档。 */
  readonly confidence: CopilotConfidenceBand
}

/** 健康答案确定性模板。 */
export const HEALTH_ANSWER_TEMPLATES: readonly CopilotAnswerTemplateEntry[] = [
  {
    template: '项目整体健康状况为{overallLabel}，总分{overallScore}分。',
    group: 'overall',
    confidence: 'medium',
  },
  {
    template: '进度维度得分{progressScore}分，存在{overdueCount}个逾期任务。',
    group: 'progress',
    confidence: 'medium',
  },
  {
    template: '关键路径维度得分{criticalPathScore}分，{criticalPathOverdue}个关键任务逾期。',
    group: 'critical_path',
    confidence: 'medium',
  },
  {
    template: '资源维度得分{resourceScore}分，{overloadedResources}个资源超载。',
    group: 'resource',
    confidence: 'medium',
  },
  {
    template: '风险维度得分{riskScore}分，{criticalRisks}个严重风险、{highRisks}个高风险。',
    group: 'risk',
    confidence: 'medium',
  },
]

/** 页面用法答案确定性模板。 */
export const PAGE_USAGE_ANSWER_TEMPLATES: readonly CopilotAnswerTemplateEntry[] = [
  {
    template: '当前页面提供{capabilityCount}项功能。',
    group: 'overview',
    confidence: 'high',
  },
]

/** 术语解释答案确定性模板。 */
export const TERM_ANSWER_TEMPLATES: readonly CopilotAnswerTemplateEntry[] = [
  {
    template: '「{term}」的知识库暂未收录。',
    group: 'term',
    confidence: 'high',
  },
]

// ===========================================================================
// Fixtures（六态）
// ===========================================================================

/** 健康答案 fixture：有素材。 */
export const HEALTH_ANSWER_FIXTURE_SUFFICIENT = {
  answerKind: 'health' as const,
  entries: [
    {
      entryId: 'entry-1',
      statement: '项目整体健康状况为关注，总分72分。',
      sourceRefs: [
        {
          sourceKind: 'diagnosis-item' as const,
          sourceId: 'diag-1',
          summary: '健康诊断总分72分',
        },
      ],
      confidence: 'medium' as const,
      group: 'overall',
    },
    {
      entryId: 'entry-2',
      statement: '进度维度存在3个逾期任务，逾期率15%。',
      sourceRefs: [
        {
          sourceKind: 'diagnosis-item' as const,
          sourceId: 'diag-2',
          summary: '3个任务逾期，逾期率15%',
        },
      ],
      confidence: 'medium' as const,
      group: 'progress',
    },
  ],
  narrative: '项目整体健康状况为关注，总分72分。进度维度存在3个逾期任务，逾期率15%。',
  isFallback: false,
}

/** 健康答案 fixture：零素材。 */
export const HEALTH_ANSWER_FIXTURE_INSUFFICIENT = {
  kind: 'insufficient' as const,
  reason: 'no-diagnosis-record' as const,
  missingWhat: '本项目尚无健康诊断记录',
}

/** 术语解释 fixture：命中。 */
export const TERM_ANSWER_FIXTURE_HIT = {
  answerKind: 'term-explanation' as const,
  entries: [
    {
      entryId: 'term-1',
      statement: '「甘特图」是一种项目管理图表，用于可视化项目进度和任务依赖关系。',
      sourceRefs: [
        {
          sourceKind: 'knowledge-entry' as const,
          sourceId: 'kb-1',
          summary: '甘特图知识条目',
        },
      ],
      confidence: 'high' as const,
      group: 'term',
    },
  ],
  narrative: '「甘特图」是一种项目管理图表，用于可视化项目进度和任务依赖关系。',
  isFallback: false,
}

/** 术语解释 fixture：未收录。 */
export const TERM_ANSWER_FIXTURE_MISS = {
  kind: 'insufficient' as const,
  reason: 'no-knowledge-entry' as const,
  missingWhat: '知识库暂未收录该术语',
}

/** 页面用法 fixture：权限过滤。 */
export const PAGE_USAGE_ANSWER_FIXTURE = {
  answerKind: 'page-usage' as const,
  entries: [
    {
      entryId: 'page-1',
      statement: '当前页面提供任务管理、甘特图查看等功能。',
      sourceRefs: [
        {
          sourceKind: 'command-metadata' as const,
          sourceId: 'cmd-1',
          summary: '任务管理命令',
        },
      ],
      confidence: 'high' as const,
      group: 'capabilities',
    },
  ],
  narrative: '当前页面提供任务管理、甘特图查看等功能。',
  isFallback: false,
}

/** 模型不可用降级 fixture。 */
export const ANSWER_FIXTURE_FALLBACK = {
  answerKind: 'health' as const,
  entries: [
    {
      entryId: 'fallback-1',
      statement: '项目整体健康状况为关注，总分72分。',
      sourceRefs: [],
      confidence: 'medium' as const,
      group: 'overall',
    },
  ],
  narrative: '项目整体健康状况为关注，总分72分。',
  isFallback: true,
  fallbackReason: '模型服务不可用，使用确定性模板降级',
}
