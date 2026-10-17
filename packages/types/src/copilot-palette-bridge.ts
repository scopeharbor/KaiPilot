/**
 * @aiproj/types — V3 Copilot × Command Palette Bridge 契约（前后端共享）
 * v3-copilot-command-palette-bridge —— 命令面板与 Copilot 的双向转交类型。
 *
 * 纯类型 + 确定性纯函数，零 Adonis/React/数据库/网络依赖。
 *
 * 关键约束（design.md D1–D8 / spec）：
 * - 转交必须显式，禁止静默自动转交（D1）
 * - 无命中判定：精确与模糊匹配均无结果时才为真（D2）
 * - 反向转交仅限 navigation 与 open-form 两类 effect（D3）
 * - 转交不得扩权（D4）
 * - 不可用类别与路由器同语义（D6）
 * - 转交判定确定性（D8）
 */

// ===========================================================================
// 1. 转交载荷（Panel → Copilot）
// ===========================================================================

/** 已解析实体引用（最小引用形状；与 copilot-intent-catalog 的 CopilotEntityReference 对齐）。 */
export interface CopilotPaletteEntityRef {
  /** 实体类型（如 'task' / 'project' / 'milestone'）。 */
  readonly entityType: string
  /** 实体 ID。 */
  readonly entityId: string
  /** 实体标题/显示文本。 */
  readonly label: string
}

/**
 * 面板 → Copilot 转交载荷。
 *
 * 载荷携带用户原文、路由上下文与已解析实体引用，
 * 用户不必重输（spec「转交携带输入与上下文」）。
 * 载荷**不携带任何授权含义**（spec「转交不得扩权」）。
 */
export interface CopilotPaletteHandoffPayload {
  /** 用户在命令面板中输入的原始文本。 */
  readonly inputText: string
  /** 当前路由路径（低敏：仅 pathname，不含查询串与哈希）。 */
  readonly routeContext: string
  /** 已解析的实体引用（来自面板搜索/上下文命令解析）。 */
  readonly entityRefs: readonly CopilotPaletteEntityRef[]
  /** 转交来源标识（固定值 'command-palette'）。 */
  readonly source: 'command-palette'
}

// ===========================================================================
// 2. 无命中判定结果
// ===========================================================================

/**
 * 转交判定原因。
 *
 * - `no-match`：精确与模糊匹配均无结果
 * - `all-unavailable`：有匹配但全部对该 actor 不可用（可选：按 design 未决问题裁决）
 */
export type CopilotPaletteHandoffReason = 'no-match' | 'all-unavailable'

/**
 * 无命中判定结果。
 *
 * 判定是确定性的：相同输入、权限与注册表快照下结果一致（spec/D8）。
 */
export interface CopilotPaletteHandoffDecision {
  /** 是否应提示转交。 */
  readonly shouldHandoff: boolean
  /** 转交原因（shouldHandoff=true 时必填）。 */
  readonly reason?: CopilotPaletteHandoffReason
}

// ===========================================================================
// 3. 反向转交目标（Copilot → Panel）
// ===========================================================================

/**
 * 反向转交允许的 effect 子集（仅 navigation 与 open-form）。
 *
 * 类型层直接排除 `ui-setting`（不通过反向转交触发）和 `open-confirm`（同理）。
 * 不含 `write`（类型系统已禁止注册此类命令）。
 */
export type CopilotReverseHandoffEffect = 'navigate' | 'open-form'

/**
 * 反向转交目标。
 *
 * 指向已注册命令，但仅限 navigation 与 open-form 两类 effect
 * （spec「反向转交仅限导航与打开表单」）。
 * 持久化类命令（如 create/update/delete）**永不**成为反向目标
 * （类型层已通过 CommandEffect 排除 `write`，此处额外约束）。
 */
export interface CopilotReverseHandoffTarget {
  /** 目标命令 ID。 */
  readonly commandId: string
  /** 目标命令标签（用于展示）。 */
  readonly label: string
  /** 目标 effect 类型（仅 'navigate' | 'open-form'）。 */
  readonly effect: CopilotReverseHandoffEffect
}

// ===========================================================================
// 4. 不可用类别（与路由器同语义）
// ===========================================================================

/**
 * 转交后的不可用类别（与 copilot-intent-catalog 的 CopilotDestinationUnavailabilityKind 同语义）。
 *
 * - `not-permitted`：actor 无权限（面板因权限过滤不可见 → 转交后仍不可达）
 * - `not-enabled`：能力未启用
 * - `authorization-gated`：需要用户授权
 *
 * 补充 `not-permitted` 是因为命令注册表的 `requiresPermission` 过滤
 * 与路由器的 availability 输入共享同一权限集。
 */
export type CopilotPaletteUnavailabilityKind =
  'not-permitted' | 'not-enabled' | 'authorization-gated'

/**
 * 转交后不可用说明（三类各自产出不同说明而非泛化失败，spec）。
 */
export interface CopilotPaletteUnavailabilityInfo {
  /** 不可用类别。 */
  readonly kind: CopilotPaletteUnavailabilityKind
  /** 人类可读说明（与路由器同语义措辞）。 */
  readonly message: string
}

// ===========================================================================
// 5. 历史条目区分
// ===========================================================================

/**
 * 历史条目类型区分（转交 vs 普通命令执行）。
 *
 * 转交动作计入既有历史机制，作为可区分条目（spec）。
 */
export type CopilotPaletteHistoryEntryKind = 'command' | 'handoff'

// ===========================================================================
// 6. 纯函数
// ===========================================================================

/**
 * 构造转交载荷（确定性纯函数）。
 *
 * 输入文本必为非空字符串（否则抛错）；路由上下文不含查询串与哈希（低敏边界）。
 */
export function buildHandoffPayload(
  inputText: string,
  routeContext: string,
  entityRefs: readonly CopilotPaletteEntityRef[],
): CopilotPaletteHandoffPayload {
  if (typeof inputText !== 'string' || inputText.trim().length === 0) {
    throw new Error('handoffPayload: inputText must be non-empty')
  }
  // 低敏路径校验：不含查询串与哈希
  if (routeContext.includes('?') || routeContext.includes('#')) {
    throw new Error('handoffPayload: routeContext must not contain ? or #')
  }
  return {
    inputText: inputText.trim(),
    routeContext,
    entityRefs: [...entityRefs],
    source: 'command-palette',
  }
}

/**
 * 构造无命中判定结果（确定性纯函数）。
 */
export function buildHandoffDecision(
  shouldHandoff: boolean,
  reason?: CopilotPaletteHandoffReason,
): CopilotPaletteHandoffDecision {
  if (shouldHandoff && !reason) {
    throw new Error('handoffDecision: reason is required when shouldHandoff is true')
  }
  return { shouldHandoff, reason }
}

/**
 * 校验反向转交目标是否合法（仅 navigation 与 open-form）。
 *
 * 持久化类命令（effect 不在允许集合内）永不过校验。
 */
export function isValidReverseHandoffTarget(target: CopilotReverseHandoffTarget): boolean {
  const allowed: readonly CopilotReverseHandoffEffect[] = ['navigate', 'open-form']
  return (allowed as readonly string[]).includes(target.effect)
}

/**
 * 构造不可用说明（确定性纯函数：三种类别各自固定措辞，与路由器同语义）。
 */
export function buildUnavailabilityInfo(
  kind: CopilotPaletteUnavailabilityKind,
): CopilotPaletteUnavailabilityInfo {
  switch (kind) {
    case 'not-permitted':
      return { kind, message: '您没有执行此操作的权限' }
    case 'not-enabled':
      return { kind, message: '该能力未启用，可在设置中开启' }
    case 'authorization-gated':
      return { kind, message: '需要用户授权后才能使用该能力' }
  }
}

/**
 * 类型守卫：判断是否为合法的不可用类别。
 */
export function isCopilotPaletteUnavailabilityKind(
  v: unknown,
): v is CopilotPaletteUnavailabilityKind {
  return (
    typeof v === 'string' &&
    (['not-permitted', 'not-enabled', 'authorization-gated'] as readonly string[]).includes(v)
  )
}

/**
 * 类型守卫：判断是否为合法的反向转交 effect。
 */
export function isCopilotReverseHandoffEffect(v: unknown): v is CopilotReverseHandoffEffect {
  return typeof v === 'string' && (['navigate', 'open-form'] as readonly string[]).includes(v)
}
