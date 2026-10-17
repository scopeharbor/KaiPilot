/**
 * v3-ai-context-and-retrieval-observability —— 上下文与检索观测共享契约。
 *
 * 设计纪律（D1-D7）：
 * - D1：只加落点，不新增计算（装配服务已产出全部字段）
 * - D2：检索词原文不落库（比 OTel opt-in 更严）
 * - D3：评分区间而非逐条评分（记录体积不随召回数线性增长）
 * - D4：观测失败降级，不阻断回合
 * - D5：字段命名对齐 gen_ai.retrieval.*，本地扩展用 aiproj_ 前缀
 * - D6：证据点击率是前端事件，本 change 只定义落点契约
 * - D7：零结果按「来源种类 + 查询类别」聚合，不按具体查询
 *
 * 禁存边界：不含检索词原文、来源正文、prompt、模型输出、token 与 secret。
 *
 * @aiproj/types
 */

import type {
  CopilotRetrievalSourceKind,
  CopilotSourcePermissionDecision,
  CopilotTruncationStage,
} from './copilot-context-assembly.js'
import type { RetrievalQueryCategory } from './copilot-web-search.js'

// ===========================================================================
// §2.1 逐来源观测记录
// ===========================================================================

/**
 * 逐来源观测记录：来源种类、命中计数、评分区间、字节占比、新鲜度、
 * stale 阻断、权限判定。
 *
 * 字段命名对齐 gen_ai.retrieval.*（D5），本地扩展用 aiproj_ 前缀。
 */
export interface ContextObservationSourceRecord {
  /** 来源种类（12 类检索来源之一）。 */
  readonly retrievalKind: CopilotRetrievalSourceKind
  /** 命中计数（0 = 零结果）。 */
  readonly hitCount: number
  /** 评分区间（min/max/median；逐条评分会随召回数线性增长，D3）。 */
  readonly scoreRange: {
    readonly min: number
    readonly max: number
    readonly median: number
  }
  /** 该来源字节占总上下文字节的比例 0..1。 */
  readonly byteShare: number
  /** 内容新鲜度（来源捕获时间 ISO 8601）。 */
  readonly capturedAt: string
  /** 是否触发 stale 阻断。 */
  readonly staleBlocked: boolean
  /** 权限判定结果。 */
  readonly permissionDecision: CopilotSourcePermissionDecision
}

// ===========================================================================
// §2.2 截断观测记录
// ===========================================================================

/**
 * 截断观测记录：省略种类、省略条数、省略字节、是否触及路由输入保护。
 */
export interface ContextObservationTruncationRecord {
  /** 是否发生截断。 */
  readonly truncated: boolean
  /** 截断阶段。 */
  readonly stage: CopilotTruncationStage
  /** 省略的来源条数。 */
  readonly omittedSourceCount: number
  /** 省略的证据正文字节。 */
  readonly omittedEvidenceBytes: number
  /** 被丢弃的来源种类。 */
  readonly droppedRetrievalKinds: readonly CopilotRetrievalSourceKind[]
  /** 是否触及预算下界。 */
  readonly hitBudgetFloor: boolean
  /** 路由输入保护是否被 breaches（路由输入恒保留，触及即为异常信号）。 */
  readonly routingInputPreservationBreached: boolean
}

// ===========================================================================
// §2.3 不确定三分观测记录
// ===========================================================================

/**
 * 不确定三分观测：零结果 / 低置信 / 不可访问 分别计数。
 */
export interface ContextObservationUncertaintyRecord {
  /** 经权威查询确认不存在。 */
  readonly notExistsCount: number
  /** 存在但本 actor 不可访问（只记计数不记来源标识，D2）。 */
  readonly notAccessibleCount: number
  /** 来源存在但未匹配查询（零结果）。 */
  readonly noMatchCount: number
}

// ===========================================================================
// §2.4 检索质量聚合记录
// ===========================================================================

/**
 * 检索质量聚合：按「来源种类 + 查询类别」聚合的召回数与零结果率。
 * 不按具体查询聚合（D7）。
 */
export interface ContextObservationRetrievalQuality {
  /** 来源种类。 */
  readonly retrievalKind: CopilotRetrievalSourceKind
  /** 查询类别（复用 web_search change 的 RetrievalQueryCategory）。 */
  readonly queryCategory: RetrievalQueryCategory
  /** 该维度的总查询次数。 */
  readonly totalQueries: number
  /** 零结果查询次数。 */
  readonly zeroResultCount: number
  /** 平均命中数。 */
  readonly avgHitCount: number
  /** 评分区间聚合（min/max across all queries）。 */
  readonly aggregatedScoreRange: {
    readonly min: number
    readonly max: number
  }
}

// ===========================================================================
// §2.5 证据点击记录形状（落点契约，实际采集归前端遥测 change）
// ===========================================================================

/**
 * 证据点击记录形状：定义"点击了哪条证据"的记录形状。
 * 实际采集归 v3-frontend-ai-usage-telemetry（D6）。
 */
export interface ContextObservationEvidenceClickRecord {
  /** 会话 ID。 */
  readonly sessionId: string
  /** 消息 ID。 */
  readonly messageId: string
  /** 点击的来源引用。 */
  readonly sourceRef: string
  /** 点击时间 ISO 8601。 */
  readonly clickedAt: string
  /** 来源种类。 */
  readonly retrievalKind: CopilotRetrievalSourceKind
}

// ===========================================================================
// §2.6 字段命名对齐 gen_ai.retrieval.*（D5）
// ===========================================================================

/**
 * 本地扩展维度命名空间（与账本 LEDGER_LOCAL_ATTRIBUTE_PREFIX = 'aiproj_' 一致）。
 * 本地维度不得伪装成 gen_ai.* 标准键。
 */
export const CONTEXT_OBSERVATION_LOCAL_NS = 'aiproj_'

/**
 * 上下文观测记录的 ledger 属性名映射。
 * 标准字段 → gen_ai.retrieval.* 裸名，本地维度 → aiproj_*。
 */
export function contextObservationLedgerAttributeName(
  field: keyof ContextObservationRecord,
): string {
  switch (field) {
    // gen_ai.retrieval.* 对齐字段
    case 'assemblyId':
      return 'gen_ai.retrieval.assembly_id'
    case 'organizationId':
      return 'aiproj_organization_id'
    case 'projectId':
      return 'aiproj_project_id'
    case 'actorId':
      return 'aiproj_actor_id'
    case 'sources':
      return 'aiproj_sources'
    case 'truncation':
      return 'aiproj_truncation'
    case 'uncertainty':
      return 'aiproj_uncertainty'
    case 'retrievalQuality':
      return 'aiproj_retrieval_quality'
    case 'routingInputsPreserved':
      return 'aiproj_routing_inputs_preserved'
    case 'totalMs':
      return 'gen_ai.retrieval.total_ms'
    case 'degraded':
      return 'aiproj_degraded'
    case 'degradedReason':
      return 'aiproj_degraded_reason'
    case 'observedAt':
      return 'aiproj_observed_at'
    default:
      return `${CONTEXT_OBSERVATION_LOCAL_NS}${String(field)}`
  }
}

// ===========================================================================
// §2.7 观测记录主体
// ===========================================================================

/**
 * 上下文与检索观测记录主体。
 *
 * 禁存：不含检索词原文、来源正文、prompt、模型输出、token 与 secret。
 * 组织隔离：必须附带 organization_id。
 */
export interface ContextObservationRecord {
  /** 组装 ID（与 CopilotContextAssemblyResult.assemblyId 对齐）。 */
  readonly assemblyId: string
  /** 组织 ID（组织隔离）。 */
  readonly organizationId: number
  /** 项目 ID（可选）。 */
  readonly projectId: number | null
  /** 操作者 ID。 */
  readonly actorId: number
  /** 逐来源观测记录。 */
  readonly sources: readonly ContextObservationSourceRecord[]
  /** 截断观测记录。 */
  readonly truncation: ContextObservationTruncationRecord
  /** 不确定三分观测记录。 */
  readonly uncertainty: ContextObservationUncertaintyRecord
  /** 检索质量聚合（按来源种类 + 查询类别）。 */
  readonly retrievalQuality: readonly ContextObservationRetrievalQuality[]
  /** 路由输入保护是否完整。 */
  readonly routingInputsPreserved: boolean
  /** 装配总耗时 ms。 */
  readonly totalMs: number
  /** 是否发生降级（观测层自身失败）。 */
  readonly degraded: boolean
  /** 降级原因（degraded=true 时填写）。 */
  readonly degradedReason?: string
  /** 观测时间 ISO 8601。 */
  readonly observedAt: string
}

// ===========================================================================
// §2.8 禁存约束验证
// ===========================================================================

/** 禁存字段名模式（值中出现即为违规）。 */
const FORBIDDEN_VALUE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/, // API key
  /Bearer\s+[a-zA-Z0-9._-]+/, // Bearer token
  /password\s*[:=]\s*\S+/i, // password assignment
]

/** 禁存的键名（出现在 record 任何层级的键名中即为违规；比较时全小写）。 */
const FORBIDDEN_KEY_NAMES = [
  'querytext',
  'query_text',
  'sourcebody',
  'source_body',
  'prompt',
  'modeloutput',
  'model_output',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
]

/**
 * 验证观测记录不含禁存内容。
 * 返回 { ok, violations }。
 */
export function validateObservationNoSensitiveContent(record: Record<string, unknown>): {
  ok: boolean
  violations: string[]
} {
  const violations: string[] = []

  function walk(obj: Record<string, unknown>, path: string) {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key

      // 键名检查
      if (FORBIDDEN_KEY_NAMES.includes(key.toLowerCase())) {
        violations.push(`forbidden key: ${fullPath}`)
      }

      // 值检查（仅字符串）
      if (typeof value === 'string') {
        for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
          if (pattern.test(value)) {
            violations.push(`forbidden value pattern at: ${fullPath}`)
          }
        }
      }

      // 递归检查对象
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value as Record<string, unknown>, fullPath)
      }

      // 递归检查数组
      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          if (item && typeof item === 'object') {
            walk(item as Record<string, unknown>, `${fullPath}[${i}]`)
          }
        })
      }
    }
  }

  walk(record, '')
  return { ok: violations.length === 0, violations }
}

// ===========================================================================
// §2.9 本地扩展不冒充标准键验证
// ===========================================================================

/** gen_ai.* 标准命名空间前缀。 */
const STANDARD_NAMESPACE_PREFIX = 'gen_ai.'

/**
 * 验证本地扩展字段不伪装成 gen_ai.* 标准键。
 * 仅 aiproj_organization_id 等已声明的对齐字段允许使用 gen_ai.* 前缀。
 */
export function validateNoLocalImpersonation(attributes: Record<string, unknown>): {
  ok: boolean
  violations: string[]
} {
  const violations: string[] = []
  const ALLOWED_STANDARD_KEYS = new Set([
    'gen_ai.retrieval.assembly_id',
    'gen_ai.retrieval.total_ms',
  ])

  for (const key of Object.keys(attributes)) {
    if (key.startsWith(STANDARD_NAMESPACE_PREFIX) && !ALLOWED_STANDARD_KEYS.has(key)) {
      violations.push(`local field impersonates standard namespace: ${key}`)
    }
  }

  return { ok: violations.length === 0, violations }
}
