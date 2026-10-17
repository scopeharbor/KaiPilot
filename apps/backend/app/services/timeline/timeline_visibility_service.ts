/**
 * Timeline 可见性与脱敏。
 *
 * - project_member：项目成员可见
 * - admin：组织管理员或可管理成员的项目角色
 * - hidden：丢弃
 * - 目标不可访问：泛化摘要，不泄露名称
 */

import type { ActivityEvent } from '#types/timeline_event'

export interface TimelineViewerContext {
  userId: number
  isAdmin: boolean
  /** 当前用户可访问的目标 id 集合（按 objectType 分组可选）。 */
  accessibleTargetIds?: Map<string, Set<number>>
}

export interface VisibilityDecision {
  visible: boolean
  redactObjectLabel: boolean
  targetAccessible: boolean
}

export default class TimelineVisibilityService {
  /**
   * 判定单条活动事件对当前用户是否可见，以及是否需要脱敏。
   */
  decide(event: ActivityEvent, viewer: TimelineViewerContext): VisibilityDecision {
    if (event.visibility === 'hidden') {
      return { visible: false, redactObjectLabel: true, targetAccessible: false }
    }

    if (event.visibility === 'admin' && !viewer.isAdmin) {
      return { visible: false, redactObjectLabel: true, targetAccessible: false }
    }

    // 删除类已在 mapping 中 hidden；此处再兜底 objectType 删除语义
    if (event.verb === 'deleted' && !viewer.isAdmin) {
      return { visible: false, redactObjectLabel: true, targetAccessible: false }
    }

    const targetAccessible = this.isTargetAccessible(event, viewer)
    // 目标不可访问时仍可展示泛化摘要（不隐藏整条），但不泄露名称与 href
    return {
      visible: true,
      redactObjectLabel: !targetAccessible,
      targetAccessible,
    }
  }

  /**
   * 过滤列表：不可见事件移除。
   */
  filterVisible(
    events: ActivityEvent[],
    viewer: TimelineViewerContext,
  ): Array<{ event: ActivityEvent; decision: VisibilityDecision }> {
    const result: Array<{ event: ActivityEvent; decision: VisibilityDecision }> = []
    for (const event of events) {
      const decision = this.decide(event, viewer)
      if (decision.visible) {
        result.push({ event, decision })
      }
    }
    return result
  }

  private isTargetAccessible(event: ActivityEvent, viewer: TimelineViewerContext): boolean {
    if (event.objectId === null) return true
    // project 自身始终可访问（调用方已校验项目权限）
    if (event.objectType === 'project') return true
    // 无白名单时默认认为可访问（P0 不强依赖全量目标预检，避免 N+1）
    if (!viewer.accessibleTargetIds) return true
    const set = viewer.accessibleTargetIds.get(event.objectType)
    if (!set) return true
    return set.has(event.objectId)
  }
}
