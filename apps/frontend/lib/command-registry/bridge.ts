/**
 * 命令面板 × Copilot 转交桥接层（v3-copilot-command-palette-bridge）。
 *
 * 纯函数：无命中判定、转交载荷构造、历史条目区分。
 * 零副作用，不读写 localStorage / 注册表 / 网络。
 * 持久化与 UI 集成见 CommandPalette.tsx。
 *
 * 关键约束（design.md D1–D8 / spec）：
 * - 无命中判定：精确与模糊匹配均无结果时才为真（D2）
 * - 转交判定确定性：相同输入、权限与注册表快照下结果一致（D8）
 * - 转交不得扩权（D4）
 * - 反向转交仅限 navigation 与 open-form（D3）
 */

import type { RegisteredCommand, CommandEffect } from './types'
import type {
  CopilotPaletteEntityRef,
  CopilotPaletteHandoffPayload,
  CopilotPaletteHandoffDecision,
  CopilotReverseHandoffTarget,
  CopilotReverseHandoffEffect,
  CopilotPaletteUnavailabilityKind,
  CopilotPaletteUnavailabilityInfo,
  CopilotPaletteHistoryEntryKind,
} from '@aiproj/types'
import {
  buildHandoffPayload,
  buildHandoffDecision,
  isValidReverseHandoffTarget,
  buildUnavailabilityInfo,
} from '@aiproj/types'

// ===========================================================================
// 1. 无命中判定
// ===========================================================================

/**
 * 精确匹配：命令 label 或 id 完全匹配输入（case-insensitive）。
 */
function exactMatch(input: string, commands: readonly RegisteredCommand[]): boolean {
  const lower = input.toLowerCase()
  return commands.some((cmd) => cmd.label.toLowerCase() === lower || cmd.id.toLowerCase() === lower)
}

/**
 * 模糊匹配：输入的 token 子集匹配命令的 label、keywords 或 id（子串匹配）。
 * 只要有任何一个 token 命中任意命令的任一字段，即为有命中。
 */
function fuzzyMatch(input: string, commands: readonly RegisteredCommand[]): boolean {
  const tokens = input.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  return commands.some((cmd) => {
    const haystack = [
      cmd.label.toLowerCase(),
      cmd.id.toLowerCase(),
      ...(cmd.keywords?.map((k) => k.toLowerCase()) ?? []),
    ].join(' ')
    return tokens.some((token) => haystack.includes(token))
  })
}

/**
 * 无命中判定：精确与模糊匹配均无结果时才为真（design.md D2）。
 *
 * 判定是确定性的：相同输入与可见命令集合下，结果一致。
 * 不修改传入数组。
 *
 * @param input 用户输入文本
 * @param visibleCommands 已经过权限与 when(ctx) 过滤的可见命令列表
 * @returns 是否应提示转交
 */
export function shouldOfferHandoff(
  input: string,
  visibleCommands: readonly RegisteredCommand[],
): CopilotPaletteHandoffDecision {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return buildHandoffDecision(false)
  }

  const hasExact = exactMatch(trimmed, visibleCommands)
  if (hasExact) {
    return buildHandoffDecision(false)
  }

  const hasFuzzy = fuzzyMatch(trimmed, visibleCommands)
  if (hasFuzzy) {
    return buildHandoffDecision(false)
  }

  return buildHandoffDecision(true, 'no-match')
}

// ===========================================================================
// 2. 转交载荷构造
// ===========================================================================

/**
 * 从命令面板状态构造转交载荷。
 *
 * 载荷携带用户原文、路由上下文与已解析实体引用，
 * 用户不必重输（spec「转交携带输入与上下文」）。
 *
 * @param inputText 用户在面板中的输入
 * @param routeContext 当前路由路径（低敏：仅 pathname）
 * @param entityRefs 已解析的实体引用
 * @returns 转交载荷
 */
export function createHandoffPayload(
  inputText: string,
  routeContext: string,
  entityRefs: readonly CopilotPaletteEntityRef[] = [],
): CopilotPaletteHandoffPayload {
  return buildHandoffPayload(inputText, routeContext, entityRefs)
}

// ===========================================================================
// 3. 反向转交
// ===========================================================================

/**
 * 候选反向目标：从注册表中查找与意图匹配的可执行命令。
 *
 * 仅返回 effect 为 'navigate' 或 'open-form' 的命令
 * （design.md D3 / spec「反向转交仅限导航与打开表单」）。
 *
 * @param intentText 用户意图文本（来自 Copilot）
 * @param visibleCommands 已经过权限过滤的可见命令列表
 * @returns 匹配的反向转交目标列表（可能为空）
 */
export function findReverseHandoffTargets(
  intentText: string,
  visibleCommands: readonly RegisteredCommand[],
): readonly CopilotReverseHandoffTarget[] {
  const targets: CopilotReverseHandoffTarget[] = []
  const allowed: readonly CommandEffect[] = ['navigate', 'open-form']

  for (const cmd of visibleCommands) {
    // 只允许 navigation 与 open-form（D3）
    if (!(allowed as readonly string[]).includes(cmd.effect)) continue

    // 检查命令是否匹配意图文本
    const lowerIntent = intentText.toLowerCase()
    const matchFields = [
      cmd.label.toLowerCase(),
      cmd.id.toLowerCase(),
      ...(cmd.keywords?.map((k) => k.toLowerCase()) ?? []),
    ]
    const matched = matchFields.some(
      (field) => lowerIntent.includes(field) || field.includes(lowerIntent),
    )
    if (!matched) continue

    const target: CopilotReverseHandoffTarget = {
      commandId: cmd.id,
      label: cmd.label,
      effect: cmd.effect as CopilotReverseHandoffEffect,
    }

    // 额外校验：确保目标合法
    if (!isValidReverseHandoffTarget(target)) continue

    targets.push(target)
  }

  return targets
}

/**
 * 验证反向转交目标不会绕过动作 preview 与人工确认。
 *
 * 持久化类命令（effect 不在允许集合内）永不过校验。
 * 反向转交只产出「指向命令的动作」，不直接执行（spec）。
 */
export function validateReverseHandoffTarget(target: CopilotReverseHandoffTarget): {
  valid: boolean
  reason?: string
} {
  if (!isValidReverseHandoffTarget(target)) {
    return { valid: false, reason: 'effect not in allowed set (navigate|open-form)' }
  }
  return { valid: true }
}

// ===========================================================================
// 4. 不可用判断
// ===========================================================================

/**
 * 判断一个能力对当前 actor 的不可用类别。
 *
 * 与路由器同语义（design.md D6）：not-permitted / not-enabled / authorization-gated。
 *
 * @param command 目标命令
 * @param actorPermissions 当前 actor 的权限列表
 * @param enabledDestinations 已启用的 destination 集合（可选，用于 not-enabled 判断）
 * @param authorizedDestinations 已授权的 destination 集合（可选，用于 authorization-gated 判断）
 * @returns 不可用类别，或 null（表示可用）
 */
export function classifyUnavailability(
  command: RegisteredCommand,
  actorPermissions: readonly string[],
  enabledDestinations?: ReadonlySet<string>,
  authorizedDestinations?: ReadonlySet<string>,
): CopilotPaletteUnavailabilityKind | null {
  // 权限检查
  if (command.requiresPermission && command.requiresPermission.length > 0) {
    const permitted = command.requiresPermission.some((p) => actorPermissions.includes(p))
    if (!permitted) return 'not-permitted'
  }

  // 启用检查（通过 destination ID 映射）
  if (enabledDestinations && !enabledDestinations.has(command.id)) {
    return 'not-enabled'
  }

  // 授权门检查
  if (authorizedDestinations && !authorizedDestinations.has(command.id)) {
    return 'authorization-gated'
  }

  return null
}

/**
 * 构造不可用说明（三种类别各自固定措辞，与路由器同语义）。
 */
export function explainUnavailability(
  kind: CopilotPaletteUnavailabilityKind,
): CopilotPaletteUnavailabilityInfo {
  return buildUnavailabilityInfo(kind)
}

// ===========================================================================
// 5. 历史条目区分
// ===========================================================================

/**
 * 历史条目前缀：转交条目以此前缀标识，与普通命令执行区分。
 *
 * 命令面板 history 机制使用命令 ID 作为 key，
 * 转交条目使用 `__handoff__:` 前缀 + 输入摘要。
 */
export const HANDOFF_HISTORY_PREFIX = '__handoff__:'

/**
 * 构造转交历史条目 ID（可区分，spec「转交计入既有历史机制」）。
 *
 * @param inputText 用户输入文本
 * @returns 可区分的历史条目 ID
 */
export function handoffHistoryId(inputText: string): string {
  // 低敏摘要：最多 40 字符
  const summary = inputText.trim().slice(0, 40)
  return `${HANDOFF_HISTORY_PREFIX}${summary}`
}

/**
 * 判断一个历史条目 ID 是否为转交条目。
 */
export function isHandoffHistoryEntry(id: string): boolean {
  return id.startsWith(HANDOFF_HISTORY_PREFIX)
}

/**
 * 判断历史条目类型。
 */
export function historyEntryKind(id: string): CopilotPaletteHistoryEntryKind {
  return isHandoffHistoryEntry(id) ? 'handoff' : 'command'
}
