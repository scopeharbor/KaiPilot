'use client'

/**
 * v3-copilot-inline-triggers —— 内联入口可用性判定。
 *
 * 复用既有 deriveChips / deriveCommands 的同一份派生（D3），
 * 不另建可用性表。三处（内联入口、面板芯片、斜杠命令）对同一上下文产出一致可用性。
 */

import type { InlineAvailabilityKind } from '@/components/copilot/CopilotInlineTrigger'

/**
 * 内联入口可用性上下文。
 * 与 ChipDerivationContext / CommandDerivationContext 同源。
 */
export interface InlineTriggerAvailabilityContext {
  /** 用户权限列表。 */
  permissions: string[]
  /** 当前 scope（如 'project', 'global', 'task'）。 */
  scope: string
  /** 能力是否启用（destination -> enabled）。 */
  enabledDestinations: Record<string, boolean>
  /** 授权门 destination 列表。 */
  authorizationGatedDestinations: string[]
  /** 目标能力的 destination ID。 */
  destinationId: string
}

/**
 * 判定内联入口可用性。
 *
 * 与 deriveChips / deriveCommands 的 determineAvailability 同源逻辑：
 * 1. 未启用 → 'not-enabled'
 * 2. 授权门 → 'authorization-gated'
 * 3. 否则 → 'available'
 *
 * 注意：无权限的情况由父组件控制（不可访问实体不出现入口），
 * 这里只处理"入口可见但能力不可用"的两种状态。
 */
export function determineInlineAvailability(
  ctx: InlineTriggerAvailabilityContext,
): InlineAvailabilityKind {
  const enabled = ctx.enabledDestinations[ctx.destinationId] ?? true
  if (!enabled) {
    return 'not-enabled'
  }

  if (ctx.authorizationGatedDestinations.includes(ctx.destinationId)) {
    return 'authorization-gated'
  }

  return 'available'
}

/**
 * 获取可用性提示文案。
 * 与 completion-derivation.ts 的 getAvailabilityHint 同源。
 */
export function getInlineAvailabilityHint(kind: InlineAvailabilityKind): string | undefined {
  switch (kind) {
    case 'not-enabled':
      return '该能力未启用，可在设置中开启'
    case 'authorization-gated':
      return '需要用户授权后才能使用该能力'
    default:
      return undefined
  }
}
