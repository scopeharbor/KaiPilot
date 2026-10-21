/**
 * @aiproj/types — V3 Copilot × Command Palette Bridge 测试夹具
 * v3-copilot-command-palette-bridge —— 七态 fixtures + 反向转交夹具。
 *
 * 纯数据，零依赖。
 */

import type {
  CopilotPaletteEntityRef,
  CopilotPaletteHandoffDecision,
  CopilotPaletteHandoffPayload,
  CopilotPaletteUnavailabilityInfo,
  CopilotReverseHandoffEffect,
  CopilotReverseHandoffTarget,
} from './copilot-palette-bridge.js'

// ===========================================================================
// 1. 转交载荷 fixtures
// ====================================================================================

/** 基本转交载荷：纯文本输入，无实体引用。 */
export function fixtureHandoffPayloadBasic(): CopilotPaletteHandoffPayload {
  return {
    inputText: '把首页设计拆成子任务',
    routeContext: '/projects/1/tasks',
    entityRefs: [],
    source: 'command-palette',
  }
}

/** 含实体引用的转交载荷。 */
export function fixtureHandoffPayloadWithRefs(): CopilotPaletteHandoffPayload {
  return {
    inputText: '给这个任务添加风险',
    routeContext: '/projects/1/tasks/42',
    entityRefs: [{ entityType: 'task', entityId: '42', label: '实现登录功能' }],
    source: 'command-palette',
  }
}

// ===========================================================================
// 2. 无命中判定 fixtures
// ====================================================================================

/** 部分命中：应展示命令，不提示转交。 */
export function fixtureDecisionPartialMatch(): CopilotPaletteHandoffDecision {
  return { shouldHandoff: false }
}

/** 零命中：应提示转交。 */
export function fixtureDecisionZeroMatch(): CopilotPaletteHandoffDecision {
  return { shouldHandoff: true, reason: 'no-match' }
}

/** 命中但全不可用：按 design 未决问题裁决是否转交。 */
export function fixtureDecisionAllUnavailable(): CopilotPaletteHandoffDecision {
  return { shouldHandoff: false, reason: 'all-unavailable' }
}

// ===========================================================================
// 3. 反向转交 fixtures
// ====================================================================================

/** 合法反向目标：导航类。 */
export function fixtureReverseTargetNavigate(): CopilotReverseHandoffTarget {
  return {
    commandId: 'nav./projects/1/gantt',
    label: '打开甘特图',
    effect: 'navigate',
  }
}

/** 合法反向目标：打开表单类。 */
export function fixtureReverseTargetOpenForm(): CopilotReverseHandoffTarget {
  return {
    commandId: 'ctx.project.new-task',
    label: '新建任务',
    effect: 'open-form',
  }
}

/** 非法反向目标：持久化类（effect 不在允许集合内）。 */
export function fixtureReverseTargetPersistence(): CopilotReverseHandoffTarget {
  return {
    commandId: 'ctx.project.create-milestone',
    label: '创建里程碑',
    effect: 'open-form' as CopilotReverseHandoffEffect,
    // 注意：实际中持久化类命令不会注册为 open-form，
    // 但测试中需验证 isValidReverseHandoffTarget 的行为。
  }
}

// ===========================================================================
// 4. 不可用 fixtures
// ====================================================================================

/** 无权限。 */
export function fixtureUnavailabilityNotPermitted(): CopilotPaletteUnavailabilityInfo {
  return { kind: 'not-permitted', message: '您没有执行此操作的权限' }
}

/** 未启用。 */
export function fixtureUnavailabilityNotEnabled(): CopilotPaletteUnavailabilityInfo {
  return { kind: 'not-enabled', message: '该能力未启用，可在设置中开启' }
}

/** 授权门。 */
export function fixtureUnavailabilityAuthGated(): CopilotPaletteUnavailabilityInfo {
  return { kind: 'authorization-gated', message: '需要用户授权后才能使用该能力' }
}

// ===========================================================================
// 5. 实体引用 fixtures
// ====================================================================================

export function fixtureEntityRefTask(): CopilotPaletteEntityRef {
  return { entityType: 'task', entityId: '42', label: '实现登录功能' }
}

export function fixtureEntityRefProject(): CopilotPaletteEntityRef {
  return { entityType: 'project', entityId: '1', label: '开项 KaiPilot' }
}
