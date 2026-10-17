import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import CrossProjectAllocationService from '#services/cross_project_allocation_service'
import {
  crossProjectAllocationParamsValidator,
  createDraftValidator,
  updateDraftItemsValidator,
  listDraftsValidator,
  listCandidatesValidator,
  confirmDraftValidator,
  applyDraftValidator,
  listConflictsValidator,
  drillDownValidator,
  parseProjectIdsParam,
} from '#validators/cross_project_allocation'

/**
 * 跨项目资源调配 Controller（v3-cross-project-resource-allocation §4.7）。
 *
 * 职责：认证 → 参数解析与校验 → Policy 调用 → Service 调用 → 响应格式化。
 * 路由前缀：`/api/v1/organizations/:organizationId/cross-project-resource-allocations`
 */
@inject()
export default class CrossProjectAllocationController {
  constructor(private readonly service: CrossProjectAllocationService) {}

  // ── 创建草案 ────────────────────────────────────────────────────────────
  /** POST /api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts */
  async createDraft(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })
    const body = await createDraftValidator.validate(ctx.request.body())

    const result = await this.service.createDraft(user, organizationId, body)
    return ctx.response.status(201).json({ data: result })
  }

  // ── 更新草案 items ────────────────────────────────────────────────────
  /** PUT /api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/items */
  async updateItems(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })
    const body = await updateDraftItemsValidator.validate(ctx.request.body())

    const result = await this.service.updateItems(
      user,
      organizationId,
      Number(ctx.params.draftId),
      body,
    )
    return ctx.response.json({ data: result })
  }

  // ── 列出草案 ────────────────────────────────────────────────────────────
  /** GET /api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts */
  async listDrafts(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })
    const qs = await listDraftsValidator.validate(ctx.request.qs())

    const result = await this.service.listDrafts(user, organizationId, {
      organizationId,
      draftStatuses: (qs.status ? [qs.status] : []) as any[],
      projectIds: parseProjectIdsParam(qs.projectIds) ?? [],
      search: qs.search ?? null,
      sort: (qs.sort ?? 'created_at') as any,
      sortDir: (qs.order ?? 'desc') as any,
      page: qs.page ?? 1,
      perPage: qs.perPage ?? 20,
    })
    return ctx.response.json(result)
  }

  // ── 获取单个草案 ────────────────────────────────────────────────────────
  /** GET /api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId */
  async getDraft(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    const result = await this.service.getDraft(user, organizationId, Number(ctx.params.draftId))
    return ctx.response.json({ data: result })
  }

  // ── 候选资源 ────────────────────────────────────────────────────────────
  /** GET /api/v1/organizations/:organizationId/cross-project-resource-allocations/candidates */
  async listCandidates(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })
    const qs = await listCandidatesValidator.validate(ctx.request.qs())

    const result = await this.service.listCandidates(user, organizationId, qs)
    return ctx.response.json(result)
  }

  // ── 预览草案 ────────────────────────────────────────────────────────────
  /** POST /api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/preview */
  async previewDraft(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    const result = await this.service.previewDraft(user, organizationId, Number(ctx.params.draftId))
    return ctx.response.json({ data: result })
  }

  // ── 确认草案 ────────────────────────────────────────────────────────────
  /** POST /api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/confirm */
  async confirmDraft(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })
    const body = await confirmDraftValidator.validate(ctx.request.body())

    const result = await this.service.confirmDraft(
      user,
      organizationId,
      Number(ctx.params.draftId),
      body,
    )
    return ctx.response.json({ data: result })
  }

  // ── 应用确认草案 ────────────────────────────────────────────────────────
  /** POST /api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/apply */
  async applyDraft(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })
    const body = await applyDraftValidator.validate(ctx.request.body())

    const result = await this.service.applyConfirmedDraft(
      user,
      organizationId,
      Number(ctx.params.draftId),
      body,
    )
    return ctx.response.json({ data: result })
  }

  // ── 取消草案 ────────────────────────────────────────────────────────────
  /** POST /api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/cancel */
  async cancelDraft(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    const result = await this.service.cancelDraft(user, organizationId, Number(ctx.params.draftId))
    return ctx.response.json({ data: result })
  }

  // ── 冲突列表 ────────────────────────────────────────────────────────────
  /** GET /api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/conflicts */
  async listConflicts(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })
    await listConflictsValidator.validate({
      draftId: Number(ctx.params.draftId),
      ...ctx.request.qs(),
    })

    // 冲突列表在 preview 中包含
    const draft = await this.service.getDraft(user, organizationId, Number(ctx.params.draftId))
    const conflicts = draft.items.flatMap((i) => i.conflicts)
    return ctx.response.json({ data: conflicts })
  }

  // ── 下钻 ────────────────────────────────────────────────────────────────
  /** GET /api/v1/organizations/:organizationId/cross-project-resource-allocations/drill-down */
  async drillDown(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await crossProjectAllocationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })
    const qs = await drillDownValidator.validate(ctx.request.qs())

    const result = await this.service.drillDown(
      user,
      organizationId,
      qs.kind,
      qs.targetId,
      qs.projectId,
      qs.resourceId,
    )
    return ctx.response.json({ data: result })
  }
}
