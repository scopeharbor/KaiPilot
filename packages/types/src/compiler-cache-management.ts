/**
 * compiler-cache-management —— Compiler Stage 缓存运维管理共享契约（V2.5 W3 P1）。
 *
 * 定义面向 deterministic Stage 缓存的**受治理运维 API** DTO：只读盘点、只读失效预览/差异、
 * 受控按范围失效写入。沿用 `StageCacheSummary` 低敏字段家族（storeKind/count/key-hash/
 * cachePolicyVersion/removedCount），禁止承载缓存值正文、raw key、prompt、模型输出或 artifact 正文。
 *
 * @aiproj/types 零依赖约束：不导入 zod / adonisjs。运行时 schema 校验由后端 validator 负责。
 *
 * 边界（与姊妹 change 不重叠）：
 * - 不治理缓存**策略选择**（TTL/storeKind 偏好/cachePolicyVersion 设定归 compiler-config-management-api）。
 * - 不改 StageCacheService 命中/重算/指纹语义（归 compiler-stage-cache-wiring）。
 * - 只**盘点与失效**缓存内容。
 */

// ── storeKind / 范围枚举 ───────────────────────────────────

/** 实际生效的 store 类型（与 stage_cache_service.StageCacheStoreKind 对齐）。 */
export type CacheManagementStoreKind = 'memory' | 'redis' | 'unknown'

/**
 * 失效范围枚举（design D6）。
 * 受限枚举避免任意前缀注入与越权清除。
 */
export const CACHE_INVALIDATION_SCOPES = ['organization', 'stage', 'cachePolicyVersion'] as const

export type CacheInvalidationScope = (typeof CACHE_INVALIDATION_SCOPES)[number]

// ── 切片 1：只读盘点 ───────────────────────────────────────

/**
 * 缓存盘点响应（低敏）。
 * 全部字段为 enums/counts/version/key-hash，禁止含缓存值正文或 raw key。
 */
export interface CacheInventoryResponse {
  organizationId: number
  /** 当前生效 store 种类（经 cache_factory 解析）。 */
  storeKind: CacheManagementStoreKind
  /** 组织范围（或按 stageId 细分）条目计数。 */
  count: number
  /** 有限条完整缓存键的 SHA-256（可比对、不可反推键内容）。 */
  sampleKeyHashes: string[]
  /** 生效 cachePolicyVersion（与 stage_cache_fingerprint.STAGE_CACHE_POLICY_VERSION 对齐）。 */
  cachePolicyVersion: string
  /** stage cache enabled 解析值（env 或 org profile）。 */
  stageCacheEnabled: boolean
  /** 枚举/降级时为 true，盘点为尽力而为。 */
  degraded?: boolean
  /** 可选：按 stageId 细分盘点时的目标 stageId。 */
  stageId?: string
}

// ── 切片 2：只读失效预览 / 差异 ─────────────────────────────

/**
 * 失效范围请求（preview 与 invalidation 共用）。
 * `stage` 范围必填 `stageId`；`cachePolicyVersion` 首期降级为 organization 级（见 note）。
 */
export interface CacheInvalidationScopeRequest {
  scope: CacheInvalidationScope
  /** stage 范围必填。 */
  stageId?: string
  /**
   * cachePolicyVersion 范围目标值。
   * 注意：cachePolicyVersion 折叠进缓存键的 inputHash（stage_cache_fingerprint），不在键前缀里，
   * 故首期无法纯前缀精确匹配，降级为 organization 级失效并在响应 `degraded`/`note` 明示。
   */
  cachePolicyVersion?: string
}

/**
 * 失效预览响应（只读，no-delete/no-execute）。
 * 返回将被清除的条目计数 + 低敏 key-hash refs + 与当前盘点的差异。
 */
export interface CacheInvalidationPreviewResponse {
  organizationId: number
  scope: CacheInvalidationScope
  /** 将被清除的条目计数。 */
  affectedCount: number
  /** 将被清除条目的低敏 key-hash refs（有限条）。 */
  sampleKeyHashes: string[]
  /** 与当前盘点的差异：失效后剩余计数。 */
  remainingCount: number
  /** 降级标记（cachePolicyVersion 降级为 organization 级时为 true）。 */
  degraded?: boolean
  /** 降级说明（cachePolicyVersion 范围首期降级为 organization 级）。 */
  note?: string
}

// ── 切片 3：受控失效写入 ───────────────────────────────────

/**
 * 失效写入请求（受控，需显式确认）。
 */
export interface CacheInvalidationRequest extends CacheInvalidationScopeRequest {
  /** 必须为 true 才执行清除（design D4 人工显式确认）。 */
  confirm: boolean
}

/**
 * 失效结果响应（低敏：实际清除计数 + 摘要，无敏感正文）。
 */
export interface CacheInvalidationResponse {
  organizationId: number
  scope: CacheInvalidationScope
  /** 实际清除条目计数（best-effort 快照）。 */
  removedCount: number
  /** 降级标记。 */
  degraded?: boolean
  /** 降级说明。 */
  note?: string
}

// ── 低敏守卫 ───────────────────────────────────────────────

/**
 * 低敏字段白名单：盘点/预览/失效响应只允许这些字段名。
 * 供 validator 检测响应或请求是否混入敏感字段（prompt/secret/token/modelOutput/artifact 等）。
 */
const LOW_SENSITIVE_RESPONSE_FIELDS = new Set([
  'organizationId',
  'storeKind',
  'count',
  'sampleKeyHashes',
  'cachePolicyVersion',
  'stageCacheEnabled',
  'degraded',
  'stageId',
  'scope',
  'affectedCount',
  'remainingCount',
  'note',
  'removedCount',
])

const SENSITIVE_FIELD_NAMES = new Set([
  'prompt',
  'context',
  'modeloutput',
  'modeloutputtext',
  'artifact',
  'artifactpayload',
  'token',
  'secret',
  'apikey',
  'api_key',
  'value',
  'rawkey',
  'rawkeyhash',
])

/**
 * 检测对象是否含敏感字段（低敏守卫，供 validator 复用）。
 * 返回 found=true 与首个敏感字段路径。
 */
export function cacheResponseContainsSensitiveFields(obj: unknown): {
  found: boolean
  fieldPath?: string
} {
  return checkSensitive(obj, '')
}

function checkSensitive(obj: unknown, path: string): { found: boolean; fieldPath?: string } {
  if (obj === null || typeof obj !== 'object') return { found: false }
  const record = obj as Record<string, unknown>
  for (const [key, val] of Object.entries(record)) {
    const currentPath = path ? `${path}.${key}` : key
    const lower = key.toLowerCase()
    if (SENSITIVE_FIELD_NAMES.has(lower)) {
      return { found: true, fieldPath: currentPath }
    }
    // 允许的低敏字段名外、且非已知响应字段名时，递归检查值结构（不直接判敏感，但深入排查）。
    if (val !== null && typeof val === 'object') {
      const nested = checkSensitive(val, currentPath)
      if (nested.found) return nested
    }
    void LOW_SENSITIVE_RESPONSE_FIELDS
  }
  return { found: false }
}
