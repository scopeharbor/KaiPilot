/**
 * v3-copilot-context-chips —— Copilot 上下文快捷操作芯片共享契约。
 *
 * 定义芯片描述符类型、来源类别、点击语义、相关性档、可用性类别、
 * 可见上界与省略计数、实体引用注入、低敏曝光与点击记录形状。
 *
 * 本模块纯类型 + 确定性常量，零运行时依赖。
 */

// ===========================================================================
// 枚举 — 来源类别
// ===========================================================================

/** 芯片来源：已注册命令（确定性动作）或意图目录（对话入口）。 */
export type ChipSourceKind = 'registered-command' | 'intent-catalog'

// ===========================================================================
// 枚举 — 点击语义
// ===========================================================================

/** 点击语义：确定性动作直接执行（导航/打开表单），意图芯片仅填充输入框。 */
export type ChipClickSemantics = 'direct-execution' | 'populate-composer'

// ===========================================================================
// 枚举 — 相关性档
// ===========================================================================

/** 相关性档：决定芯片在列表中的优先级顺序。 */
export type ChipRelevanceTier = 'critical' | 'high' | 'medium' | 'low'

// ===========================================================================
// 枚举 — 可用性类别
// ===========================================================================

/**
 * 可用性类别：
 * - available: 可用
 * - not-permitted: 无权限（缺席，不泄露存在）
 * - not-enabled: 能力未启用（可见不可用，给启用提示）
 * - authorization-gated: 需用户授权（可见不可用，给原因，点击不发外部请求）
 */
export type ChipAvailabilityKind =
  'available' | 'not-permitted' | 'not-enabled' | 'authorization-gated'

// ===========================================================================
// 结构类型 — 排序键
// ===========================================================================

/**
 * 芯片排序键：确定性排序依据。
 * 按 relevanceTier 降序 → impactSeverity 降序 → stableTieBreak 升序。
 */
export interface ChipSortKey {
  readonly relevanceTier: ChipRelevanceTier
  readonly impactSeverity: number
  readonly stableTieBreak: string
}

// ===========================================================================
// 结构类型 — 芯片描述符
// ===========================================================================

/**
 * 芯片描述符：描述一个上下文快捷操作芯片的完整信息。
 */
export interface ChipDescriptor {
  /** 唯一标识符。 */
  readonly id: string
  /** 中文标签。 */
  readonly label: string
  /** 来源类别。 */
  readonly sourceKind: ChipSourceKind
  /** 点击语义。 */
  readonly clickSemantics: ChipClickSemantics
  /** 相关性档。 */
  readonly relevanceTier: ChipRelevanceTier
  /** 影响严重度（数值越高越重要，用于同档排序）。 */
  readonly impactSeverity: number
  /** 可用性类别。 */
  readonly availabilityKind: ChipAvailabilityKind
  /** 不可用原因提示（当 availabilityKind 不是 'available' 时）。 */
  readonly hint?: string
  /** 目标 destination（用于去重与路由器可用性一致性校验）。 */
  readonly destination: string
  /** 所需权限列表（用于权限过滤）。 */
  readonly requiredPermissions: readonly string[]
  /** 上下文条件哈希（可选，用于确定性测试）。 */
  readonly whenPredicateHash?: string
  /** 实体引用注入（当在实体作用域时）。 */
  readonly entityRef?: ChipEntityReference
  /** 稳定排序键（用于确定性排序）。 */
  readonly sortKey: ChipSortKey
}

// ===========================================================================
// 结构类型 — 实体引用注入
// ===========================================================================

/**
 * 实体引用注入：在实体作用域下携带当前实体信息。
 */
export interface ChipEntityReference {
  /** 实体类型（如 'task', 'risk', 'milestone'）。 */
  readonly kind: string
  /** 实体 ID。 */
  readonly id: number
  /** 实体名称（用于填充文本）。 */
  readonly name: string
  /** 实体作用域（如 'project', 'global'）。 */
  readonly scope: string
}

// ===========================================================================
// 结构类型 — 可见上界与省略计数
// ===========================================================================

/**
 * 芯片可见上界与省略计数。
 */
export interface ChipVisibleBound {
  /** 最大可见芯片数。 */
  readonly maxVisible: number
  /** 实际可见芯片数（可能小于 maxVisible）。 */
  readonly visibleCount: number
  /** 省略芯片数（超出上界的部分）。 */
  readonly omittedCount: number
}

// ===========================================================================
// 结构类型 — 曝光与点击记录
// ===========================================================================

/**
 * 低敏芯片曝光记录：供后续前端体验观测消费。
 * 不含用户输入、prompt、模型输出、token 或 secret。
 */
export interface ChipExposureRecord {
  /** 芯片 ID。 */
  readonly chipId: string
  /** 来源类别。 */
  readonly sourceKind: ChipSourceKind
  /** 位次（从 0 开始）。 */
  readonly ordinal: number
  /** 是否点击。 */
  readonly clicked: boolean
  /** 不可用类别（当不可用时）。 */
  readonly unavailabilityKind?: ChipAvailabilityKind
}

/**
 * 低敏芯片点击记录：与曝光记录结构相同，但 clicked 固定为 true。
 * 本 change 只产出不落库。
 */
export type ChipClickRecord = ChipExposureRecord & {
  readonly clicked: true
}

// ===========================================================================
// 常量 — 默认可见上界
// ===========================================================================

/** 默认最大可见芯片数。 */
export const DEFAULT_CHIP_VISIBLE_BOUND = 6

// ===========================================================================
// 类型守卫
// ===========================================================================

/** 类型守卫：检查是否为有效的 ChipSourceKind。 */
export function isChipSourceKind(value: unknown): value is ChipSourceKind {
  return value === 'registered-command' || value === 'intent-catalog'
}

/** 类型守卫：检查是否为有效的 ChipClickSemantics。 */
export function isChipClickSemantics(value: unknown): value is ChipClickSemantics {
  return value === 'direct-execution' || value === 'populate-composer'
}

/** 类型守卫：检查是否为有效的 ChipRelevanceTier。 */
export function isChipRelevanceTier(value: unknown): value is ChipRelevanceTier {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
}

/** 类型守卫：检查是否为有效的 ChipAvailabilityKind。 */
export function isChipAvailabilityKind(value: unknown): value is ChipAvailabilityKind {
  return (
    value === 'available' ||
    value === 'not-permitted' ||
    value === 'not-enabled' ||
    value === 'authorization-gated'
  )
}

/** 类型守卫：检查芯片描述符是否完整。 */
export function isValidChipDescriptor(descriptor: unknown): descriptor is ChipDescriptor {
  if (typeof descriptor !== 'object' || descriptor === null) return false
  const d = descriptor as Record<string, unknown>
  return (
    typeof d.id === 'string' &&
    typeof d.label === 'string' &&
    isChipSourceKind(d.sourceKind) &&
    isChipClickSemantics(d.clickSemantics) &&
    isChipRelevanceTier(d.relevanceTier) &&
    typeof d.impactSeverity === 'number' &&
    isChipAvailabilityKind(d.availabilityKind) &&
    typeof d.destination === 'string' &&
    Array.isArray(d.requiredPermissions) &&
    typeof d.sortKey === 'object' &&
    d.sortKey !== null
  )
}
