import {
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import ProjectPolicy from '#policies/project_policy'
import ProjectActivityEventService, {
  TIMELINE_DEFAULT_PER_PAGE,
  TIMELINE_MAX_PER_PAGE,
} from '#services/timeline/project_activity_event_service'
import { listTimelineValidator, parseCategoryList, parseImportanceList } from '#validators/timeline'
import type { TimelineCategory, TimelineImportance } from '#types/timeline_event'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * 项目记忆 Timeline API。
 * GET /api/v1/projects/:id/timeline
 */
@inject()
export default class ProjectTimelineController {
  constructor(
    private timeline: ProjectActivityEventService,
    private policy: ProjectPolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.id)

    if (!Number.isFinite(projectId) || projectId <= 0) {
      throw new ResourceNotFoundException('项目不存在')
    }

    // 先做存在性/权限由 service 统一处理；此处再做一次 view 预检以保持与其他 API 一致
    // Service 内仍会校验，防止跨组织探测。

    const raw = ctx.request.qs()
    // vine boolean 对 query string "true"/"false" 需预处理
    const normalized = {
      ...raw,
      keyOnly: parseBool(raw.keyOnly),
      relatedToMe: parseBool(raw.relatedToMe),
      actorId: raw.actorId !== undefined ? Number(raw.actorId) : undefined,
      perPage: raw.perPage !== undefined ? Number(raw.perPage) : undefined,
    }

    let filters: Awaited<ReturnType<typeof listTimelineValidator.validate>>
    try {
      filters = await ctx.request.validateUsing(listTimelineValidator, { data: normalized })
    } catch (error) {
      // 非法筛选 → VALIDATION_ERROR
      throw error
    }

    // 非法 category/importance 片段被 parse 丢弃；若传入但全部非法则校验失败
    if (filters.category) {
      const parsed = parseCategoryList(filters.category)
      if (!parsed || parsed.length === 0) {
        throw new ValidationException('无效的事件类型筛选', {
          details: { field: 'category' },
        })
      }
    }
    if (filters.importance) {
      const parsed = parseImportanceList(filters.importance)
      if (!parsed || parsed.length === 0) {
        throw new ValidationException('无效的重要性筛选', {
          details: { field: 'importance' },
        })
      }
    }

    // 解析时间
    let from: Date | undefined
    let to: Date | undefined
    if (filters.from) {
      from = new Date(filters.from)
      if (Number.isNaN(from.getTime())) {
        throw new ValidationException('无效的开始时间', { details: { field: 'from' } })
      }
    }
    if (filters.to) {
      to = new Date(filters.to)
      if (Number.isNaN(to.getTime())) {
        throw new ValidationException('无效的结束时间', { details: { field: 'to' } })
      }
    }

    const perPage = Math.min(filters.perPage ?? TIMELINE_DEFAULT_PER_PAGE, TIMELINE_MAX_PER_PAGE)

    // 显式 policy 检查：非成员 → PERMISSION_DENIED；不存在项目在 service 里 404
    // 但跨组织项目也在 service 404。这里若 policy 先查不存在的 project 可能误 403，
    // 因此权限检查放在 service 内（先 404 后 403）。Controller 只调用 service。
    void this.policy

    const result = await this.timeline.list(organizationId, projectId, user, {
      categories: parseCategoryList(filters.category) as TimelineCategory[] | undefined,
      importance: parseImportanceList(filters.importance) as TimelineImportance[] | undefined,
      keyOnly: filters.keyOnly ?? false,
      relatedToMe: filters.relatedToMe ?? false,
      actorId: filters.actorId,
      from,
      to,
      search: filters.search,
      cursor: filters.cursor ?? null,
      perPage,
    })

    return ctx.response.ok(result)
  }
}

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

// re-export for tests that assert exception types are available
export { PermissionDeniedException, ResourceNotFoundException }
