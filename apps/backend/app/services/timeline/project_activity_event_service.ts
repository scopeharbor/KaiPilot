/**
 * ProjectActivityEventService — 项目 Timeline 查询权威出口。
 *
 * P0：仅从 audit_logs 派生；不写业务表；不创建 activity_events。
 */

import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import Project from '#models/project'
import User from '#models/user'
import ProjectPolicy from '#policies/project_policy'
import RbacService from '#services/rbac_service'
import type { ActivityEventSource } from '#services/timeline/activity_event_source'
import AuditDerivedActivityEventSource from '#services/timeline/audit_derived_activity_event_source'
import TimelineEventAdapter from '#services/timeline/timeline_event_adapter'
import TimelineVisibilityService from '#services/timeline/timeline_visibility_service'
import type {
  ActivityEvent,
  TimelineEvent,
  TimelineListResult,
  TimelineQueryFilters,
} from '#types/timeline_event'
import { inject } from '@adonisjs/core'

/** 默认/最大每页。 */
export const TIMELINE_DEFAULT_PER_PAGE = 20
export const TIMELINE_MAX_PER_PAGE = 50
/** 聚合时间窗（毫秒）。 */
export const TIMELINE_AGGREGATE_WINDOW_MS = 5 * 60 * 1000
/** 候选拉取放大倍数，供过滤/聚合后填满一页。 */
const FETCH_MULTIPLIER = 4
const FETCH_HARD_CAP = 400

export interface TimelineCursorPayload {
  t: string
  i: number
}

export function encodeTimelineCursor(occurredAt: Date, id: number): string {
  const payload: TimelineCursorPayload = { t: occurredAt.toISOString(), i: id }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeTimelineCursor(cursor: string): TimelineCursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw) as TimelineCursorPayload
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

@inject()
export default class ProjectActivityEventService {
  // 仅 policy/rbac 由容器注入；其余为内部依赖，避免 @inject 尝试注入
  // 接口类型 ActivityEventSource（无运行时类型 → 注入 undefined）。
  private adapter = new TimelineEventAdapter()
  private visibility = new TimelineVisibilityService()
  private source: ActivityEventSource = new AuditDerivedActivityEventSource()

  constructor(
    private policy: ProjectPolicy,
    private rbac: RbacService,
  ) {}

  /**
   * 供测试注入替代数据源（例如内存 fake）。
   */
  setSource(source: ActivityEventSource): void {
    this.source = source
  }

  /**
   * 查询项目 Timeline。只读，不修改任何业务表。
   */
  async list(
    organizationId: number,
    projectId: number,
    user: User,
    filters: TimelineQueryFilters = {},
  ): Promise<TimelineListResult> {
    // 组织+项目存在性：跨组织一律 RESOURCE_NOT_FOUND
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()

    if (!project) {
      throw new ResourceNotFoundException('项目不存在')
    }

    const canView = await this.policy.view(user, organizationId, projectId)
    if (!canView) {
      throw new PermissionDeniedException('权限不足')
    }

    const perPage = Math.min(
      Math.max(filters.perPage ?? TIMELINE_DEFAULT_PER_PAGE, 1),
      TIMELINE_MAX_PER_PAGE,
    )

    let cursorOccurredAt: Date | null = null
    let cursorId: number | null = null
    if (filters.cursor) {
      const decoded = decodeTimelineCursor(filters.cursor)
      if (!decoded) {
        // 非法 cursor 当作首页
        cursorOccurredAt = null
        cursorId = null
      } else {
        cursorOccurredAt = new Date(decoded.t)
        cursorId = decoded.i
      }
    }

    const fetchLimit = Math.min(perPage * FETCH_MULTIPLIER, FETCH_HARD_CAP)
    const candidates = await this.source.fetchCandidates({
      organizationId,
      projectId,
      filters,
      fetchLimit,
      cursorOccurredAt,
      cursorId,
    })

    const isAdmin =
      (await this.rbac.isOrgAdmin(user, organizationId)) ||
      (await this.policy.manageMembers(user, organizationId, projectId))

    const viewer = { userId: user.id, isAdmin }
    const visible = this.visibility.filterVisible(candidates, viewer)

    // 应用类型/重要性/关键/与我有关/搜索筛选
    const filtered = visible.filter(({ event }) => this.matchesFilters(event, filters, user.id))

    // 低噪音聚合
    const aggregated = this.aggregateLowNoise(filtered.map((v) => v.event))

    // 映射为 DTO
    const actorIds = [
      ...new Set(
        aggregated
          .flatMap((item) =>
            item.kind === 'single' ? [item.event.actorId] : [item.events[0]?.actorId ?? null],
          )
          .filter((id): id is number => id !== null),
      ),
    ]
    const actorNameMap = await this.loadActorNames(actorIds)

    const dtoList: TimelineEvent[] = []
    for (const item of aggregated) {
      if (item.kind === 'group') {
        const head = item.events[0]!
        const name = head.actorId !== null ? (actorNameMap.get(head.actorId) ?? '系统') : '系统'
        dtoList.push(
          this.adapter.toAggregatedTimelineEvent(item.events, { actorDisplayName: name }),
        )
      } else {
        const decision = visible.find((v) => v.event.id === item.event.id)?.decision ?? {
          visible: true,
          redactObjectLabel: false,
          targetAccessible: true,
        }
        const name =
          item.event.actorId !== null ? (actorNameMap.get(item.event.actorId) ?? '系统') : '系统'
        dtoList.push(
          this.adapter.toTimelineEvent(item.event, {
            actorDisplayName: name,
            targetAccessible: decision.targetAccessible,
            redactObjectLabel: decision.redactObjectLabel,
          }),
        )
      }
    }

    // 分页切片
    const pageItems = dtoList.slice(0, perPage)
    const hasMore = dtoList.length > perPage || candidates.length >= fetchLimit

    let nextCursor: string | null = null
    if (hasMore && pageItems.length > 0) {
      const last = pageItems[pageItems.length - 1]!
      // 用 evidenceRef / 聚合头 sourceId 作为稳定 id
      const stableId = last.evidenceRef?.id ?? 0
      nextCursor = encodeTimelineCursor(new Date(last.occurredAt), stableId)
    }

    // 安全：确保响应不包含敏感键（测试会扫 JSON）
    return {
      data: pageItems,
      meta: {
        total: null,
        perPage,
        hasMore:
          Boolean(nextCursor) && (dtoList.length > perPage || candidates.length >= fetchLimit),
        nextCursor,
        source: 'audit_derived',
      },
    }
  }

  private matchesFilters(
    event: ActivityEvent,
    filters: TimelineQueryFilters,
    currentUserId: number,
  ): boolean {
    if (filters.categories && filters.categories.length > 0) {
      if (!filters.categories.includes(event.category)) return false
    }
    if (filters.importance && filters.importance.length > 0) {
      if (!filters.importance.includes(event.importance)) return false
    }
    if (filters.keyOnly && !event.isKeyEvent) return false
    if (filters.relatedToMe) {
      const related = event.metadataSnapshot?.relatedUserIds ?? []
      const isActor = event.actorId === currentUserId
      const isRelated = related.includes(currentUserId)
      if (!isActor && !isRelated) return false
    }
    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase()
      const hay = `${event.summaryTemplate} ${event.objectLabel ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }

  /**
   * 同 actor + verb + objectType，短时间窗口内低重要性事件合并。
   */
  private aggregateLowNoise(
    events: ActivityEvent[],
  ): Array<{ kind: 'single'; event: ActivityEvent } | { kind: 'group'; events: ActivityEvent[] }> {
    const result: Array<
      { kind: 'single'; event: ActivityEvent } | { kind: 'group'; events: ActivityEvent[] }
    > = []

    let i = 0
    while (i < events.length) {
      const head = events[i]!
      // 关键/高重要性不聚合
      if (head.isKeyEvent || head.importance === 'high' || head.importance === 'critical') {
        result.push({ kind: 'single', event: head })
        i += 1
        continue
      }

      const group: ActivityEvent[] = [head]
      let j = i + 1
      while (j < events.length) {
        const next = events[j]!
        if (next.isKeyEvent || next.importance === 'high' || next.importance === 'critical') break
        if (next.actorId !== head.actorId) break
        if (next.verb !== head.verb) break
        if (next.objectType !== head.objectType) break
        const delta = Math.abs(head.occurredAt.getTime() - next.occurredAt.getTime())
        if (delta > TIMELINE_AGGREGATE_WINDOW_MS) break
        group.push(next)
        j += 1
      }

      if (group.length >= 3) {
        result.push({ kind: 'group', events: group })
      } else {
        for (const e of group) result.push({ kind: 'single', event: e })
      }
      i = j
    }

    return result
  }

  private async loadActorNames(userIds: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>()
    if (userIds.length === 0) return map
    const users = await User.query().whereIn('id', userIds)
    for (const u of users) {
      map.set(u.id, u.fullName?.trim() || u.email || `用户 #${u.id}`)
    }
    return map
  }
}
