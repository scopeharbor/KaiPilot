/**
 * BiCustomReportController —— 自定义 BI 报表构建器 API 控制器。
 *
 * /api/v1/organizations/:organizationId/bi/custom-reports/*
 *
 * v3-bi-custom-report-builder §5.1–5.4
 */
import type { HttpContext } from '@adonisjs/core/http'
import {
  biCustomReportDataSourceRegistry,
  biCustomReportDefinitionService,
  biCustomReportPreviewService,
} from '#services/bi_custom_report/index'
import { BiCustomReportPolicy } from '#policies/bi_custom_report_policy'
import type { Actor } from '#policies/bi_custom_report_policy'
import {
  createBiCustomReportValidator,
  updateBiCustomReportValidator,
  copyBiCustomReportValidator,
  setDefaultBiCustomReportValidator,
  archiveRestoreBiCustomReportValidator,
  listBiCustomReportValidator,
  previewBiCustomReportValidator,
} from '#validators/bi_custom_report'

/**
 * vine.any() 的输出类型天然含 undefined，因而 filters[].value 被推成可选，
 * 而 BiCustomReportFilter.value 是必填。这里把缺省值显式补成 null，
 * 让「筛选值缺失」在下游按空值处理，而不是静默丢掉整条筛选器。
 */
function normalizeFilterValues<
  T extends { filters?: Array<{ fieldKey: F; operator: O; value?: unknown; label?: string }> },
  F,
  O,
>(payload: T) {
  if (!payload.filters) return payload as T & { filters?: never }
  return {
    ...payload,
    filters: payload.filters.map((f) => ({ ...f, value: f.value ?? null })),
  }
}

export default class BiCustomReportController {
  /**
   * 从 HTTP context 提取 actor。
   */
  private actorFromCtx(ctx: HttpContext): Actor {
    const user = ctx.auth?.user
    return {
      id: user?.id ?? 0,
      organizationId: Number(ctx.params.organizationId),
      permissions: new Set((user as any)?.permissions ?? ['report:view']),
    }
  }

  // ── Registry ────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/organizations/:organizationId/bi/custom-reports/registry
   * 列出授权数据源目录。
   */
  async registry(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const all = biCustomReportDataSourceRegistry.listAll()
    const visible = all.filter((ds) =>
      ds.permissionTags.some((tag) => BiCustomReportPolicy.canViewDataSource(actor, tag)),
    )
    return ctx.response.json({
      data: visible,
      meta: { total: visible.length },
    })
  }

  // ── Preview ─────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/organizations/:organizationId/bi/custom-reports/preview
   * 无副作用预览端点。
   */
  async preview(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const organizationId = Number(ctx.params.organizationId)

    const payload = await ctx.request.validateUsing(previewBiCustomReportValidator)
    const result = await biCustomReportPreviewService.preview(
      actor,
      organizationId,
      normalizeFilterValues(payload),
    )
    return ctx.response.json({ data: result })
  }

  // ── Definitions CRUD ───────────────────────────────────────────────────

  /**
   * GET /api/v1/organizations/:organizationId/bi/custom-reports/definitions
   */
  async list(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const organizationId = Number(ctx.params.organizationId)

    const query = ctx.request.qs()
    const validated = await listBiCustomReportValidator.validate(query)

    const result = await biCustomReportDefinitionService.list(actor, organizationId, validated)
    return ctx.response.json(result)
  }

  /**
   * GET /api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId
   */
  async get(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const organizationId = Number(ctx.params.organizationId)
    const { definitionId } = ctx.params

    const def = await biCustomReportDefinitionService.get(actor, organizationId, definitionId)
    if (!def) {
      return ctx.response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '定义不存在或无权访问' },
      })
    }

    return ctx.response.json({ data: def })
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/custom-reports/definitions
   */
  async create(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const organizationId = Number(ctx.params.organizationId)

    const payload = await ctx.request.validateUsing(createBiCustomReportValidator)

    try {
      const def = await biCustomReportDefinitionService.create(
        actor,
        organizationId,
        normalizeFilterValues(payload),
      )
      return ctx.response.status(201).json({ data: def })
    } catch (err: any) {
      if (err.code === 'VALIDATION_ERROR') {
        return ctx.response.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: err.message },
        })
      }
      if (err.code === 'PERMISSION_DENIED') {
        return ctx.response.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: '无权创建定义' },
        })
      }
      throw err
    }
  }

  /**
   * PUT /api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId
   */
  async update(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const organizationId = Number(ctx.params.organizationId)
    const { definitionId } = ctx.params

    const payload = await ctx.request.validateUsing(updateBiCustomReportValidator)

    try {
      const def = await biCustomReportDefinitionService.update(
        actor,
        organizationId,
        definitionId,
        normalizeFilterValues(payload),
      )
      return ctx.response.json({ data: def })
    } catch (err: any) {
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return ctx.response.status(404).json({
          error: { code: 'RESOURCE_NOT_FOUND', message: '定义不存在' },
        })
      }
      if (err.code === 'PERMISSION_DENIED') {
        return ctx.response.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: '无权更新定义' },
        })
      }
      if (err.code === 'CONFLICT') {
        return ctx.response.status(409).json({
          error: { code: 'CONFLICT', message: err.message },
        })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId/copy
   */
  async copy(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const organizationId = Number(ctx.params.organizationId)
    const { definitionId } = ctx.params

    const payload = await ctx.request.validateUsing(copyBiCustomReportValidator)

    try {
      const def = await biCustomReportDefinitionService.copy(
        actor,
        organizationId,
        definitionId,
        payload,
      )
      return ctx.response.status(201).json({ data: def })
    } catch (err: any) {
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return ctx.response.status(404).json({
          error: { code: 'RESOURCE_NOT_FOUND', message: '定义不存在' },
        })
      }
      if (err.code === 'PERMISSION_DENIED') {
        return ctx.response.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: '无权复制定义' },
        })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId/set-default
   */
  async setDefault(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const organizationId = Number(ctx.params.organizationId)
    const { definitionId } = ctx.params

    const payload = await ctx.request.validateUsing(setDefaultBiCustomReportValidator)

    try {
      await biCustomReportDefinitionService.setDefault(
        actor,
        organizationId,
        definitionId,
        payload.expectedVersion,
      )
      return ctx.response.json({ data: { success: true } })
    } catch (err: any) {
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return ctx.response.status(404).json({
          error: { code: 'RESOURCE_NOT_FOUND', message: '定义不存在' },
        })
      }
      if (err.code === 'PERMISSION_DENIED') {
        return ctx.response.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: '无权设置默认定义' },
        })
      }
      if (err.code === 'CONFLICT') {
        return ctx.response.status(409).json({
          error: { code: 'CONFLICT', message: err.message },
        })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId/archive
   */
  async archive(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const organizationId = Number(ctx.params.organizationId)
    const { definitionId } = ctx.params

    const payload = await ctx.request.validateUsing(archiveRestoreBiCustomReportValidator)

    try {
      await biCustomReportDefinitionService.archive(
        actor,
        organizationId,
        definitionId,
        payload.expectedVersion,
      )
      return ctx.response.json({ data: { success: true } })
    } catch (err: any) {
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return ctx.response.status(404).json({
          error: { code: 'RESOURCE_NOT_FOUND', message: '定义不存在' },
        })
      }
      if (err.code === 'PERMISSION_DENIED') {
        return ctx.response.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: '无权归档定义' },
        })
      }
      if (err.code === 'CONFLICT') {
        return ctx.response.status(409).json({
          error: { code: 'CONFLICT', message: err.message },
        })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId/restore
   */
  async restore(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const organizationId = Number(ctx.params.organizationId)
    const { definitionId } = ctx.params

    const payload = await ctx.request.validateUsing(archiveRestoreBiCustomReportValidator)

    try {
      await biCustomReportDefinitionService.restore(
        actor,
        organizationId,
        definitionId,
        payload.expectedVersion,
      )
      return ctx.response.json({ data: { success: true } })
    } catch (err: any) {
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return ctx.response.status(404).json({
          error: { code: 'RESOURCE_NOT_FOUND', message: '定义不存在' },
        })
      }
      if (err.code === 'PERMISSION_DENIED') {
        return ctx.response.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: '无权恢复定义' },
        })
      }
      if (err.code === 'CONFLICT') {
        return ctx.response.status(409).json({
          error: { code: 'CONFLICT', message: err.message },
        })
      }
      throw err
    }
  }

  /**
   * GET /api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId/versions
   */
  async versions(ctx: HttpContext) {
    const actor = this.actorFromCtx(ctx)
    const organizationId = Number(ctx.params.organizationId)
    const { definitionId } = ctx.params

    try {
      const versions = await biCustomReportDefinitionService.listVersions(
        actor,
        organizationId,
        definitionId,
      )
      return ctx.response.json({
        data: versions.map((v) => ({
          version: v.version,
          definitionHash: v.definitionHash,
          title: v.title,
          updatedAt: v.createdAt?.toISO() ?? null,
          updatedBy: v.updatedBy,
          changeSummary: v.changeSummary,
        })),
      })
    } catch (err: any) {
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return ctx.response.status(404).json({
          error: { code: 'RESOURCE_NOT_FOUND', message: '定义不存在' },
        })
      }
      if (err.code === 'PERMISSION_DENIED') {
        return ctx.response.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: '无权查看版本历史' },
        })
      }
      throw err
    }
  }
}
