/**
 * bi_report_templates/controller —— BI 报表模板库 Controller（tasks §3.3）。
 *
 * 端点：
 *   GET    /api/v1/organizations/:organizationId/bi/report-templates
 *   GET    /api/v1/organizations/:organizationId/bi/report-templates/:templateId
 *   GET    /api/v1/organizations/:organizationId/bi/report-templates/:templateId/preview
 *   POST   /api/v1/organizations/:organizationId/bi/report-templates/:templateId/instantiate
 *   POST   /api/v1/organizations/:organizationId/bi/report-templates/:templateId/copy
 *   PATCH  /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId
 *   POST   /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId/archive
 *   POST   /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId/restore
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { BiTemplateLibraryService } from '#services/bi_report_templates/template_library_service'
import { BiTemplateCopyService, CopyServiceError } from '#services/bi_report_templates/copy_service'
import BiReportTemplatePolicy from '#policies/bi_report_template_policy'
import {
  biTemplateParamsValidator,
  biTemplateDetailParamsValidator,
  biCopyParamsValidator,
  biListTemplatesQueryValidator,
  biSaveCopyValidator,
  biUpdateCopyValidator,
  biInstantiateValidator,
  biCopyPreviewValidator,
  biCopyConfirmValidator,
} from '#validators/bi_report_template'
import AuditService, { AuditEvent } from '#services/audit_service'

@inject()
export default class BiReportTemplateController {
  constructor(
    private readonly libraryService: BiTemplateLibraryService,
    private readonly copyService: BiTemplateCopyService,
    private readonly policy: BiReportTemplatePolicy,
    private readonly auditService: AuditService,
  ) {}

  /**
   * GET /api/v1/organizations/:organizationId/bi/report-templates
   * 模板目录列表（内置 + 组织自定义副本）。
   */
  async index({ params, request, response, auth }: HttpContext) {
    const { organizationId } = await biTemplateParamsValidator.validate(params)
    const user = auth.user!
    await this.policy.canRead(user, organizationId)

    const qs = request.qs()
    const query = await biListTemplatesQueryValidator.validate({
      category: qs.category,
      page: qs.page ? Number(qs.page) : undefined,
      perPage: qs.perPage ? Number(qs.perPage) : undefined,
    })

    const result = await this.libraryService.listTemplates(organizationId, query)
    return response.json({ data: result.data, meta: result.meta })
  }

  /**
   * GET /api/v1/organizations/:organizationId/bi/report-templates/:templateId
   * 模板详情。
   */
  async show({ params, response, auth }: HttpContext) {
    const { organizationId, templateId } = await biTemplateDetailParamsValidator.validate(params)
    const user = auth.user!
    await this.policy.canRead(user, Number(organizationId))

    const template = await this.libraryService.getTemplate(Number(organizationId), templateId)
    if (!template) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '模板不存在' },
      })
    }

    return response.json({ data: template })
  }

  /**
   * GET /api/v1/organizations/:organizationId/bi/report-templates/:templateId/preview
   * 模板预览（只读聚合）。
   */
  async preview({ params, response, auth }: HttpContext) {
    const { organizationId, templateId } = await biTemplateDetailParamsValidator.validate(params)
    const user = auth.user!
    await this.policy.canRead(user, Number(organizationId))

    const preview = await this.libraryService.previewTemplate(Number(organizationId), templateId)
    return response.json({ data: preview })
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/report-templates/:templateId/instantiate
   * 从模板创建实例（降级路径，走 reporting-system-upgrade 预览→确认→生成→导出）。
   */
  async instantiate({ params, request, response, auth }: HttpContext) {
    const { organizationId, templateId } = await biTemplateDetailParamsValidator.validate(params)
    const user = auth.user!
    await this.policy.canRead(user, Number(organizationId))

    const template = await this.libraryService.getTemplate(Number(organizationId), templateId)
    if (!template) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '模板不存在' },
      })
    }

    const body = await biInstantiateValidator.validate(request.body())

    // D3 降级路径：custom-report-builder 不可用，走 reporting-system-upgrade
    // 生成预填报表请求并进入既有预览→确认→生成→导出流程

    const auditMeta: Record<string, unknown> = {
      path: 'reporting_system_upgrade',
      projectId: body.projectId,
      source: template.source ?? 'builtin',
    }
    if (template.pluginRef) {
      auditMeta.pluginRef = template.pluginRef
    }

    // 审计
    void this.auditService.log({
      event: AuditEvent.BI_TEMPLATE_INSTANTIATED,
      userId: user.id,
      organizationId: Number(organizationId),
      entityType: 'bi_report_template',
      entityId: null,
      metadata: auditMeta,
    })

    return response.json({
      data: {
        path: 'reporting_system_upgrade',
        prefill: {
          templateId,
          filters: body.filters ?? {},
          projectId: body.projectId,
        },
      },
    })
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/report-templates/:templateId/copy
   * 另存为自定义模板副本（兼容直接创建，支持 builtin 与 plugin，插件副本带快照）。
   */
  async saveCopy({ params, request, response, auth }: HttpContext) {
    const { organizationId, templateId } = await biTemplateDetailParamsValidator.validate(params)
    const user = auth.user!
    await this.policy.canWrite(user, Number(organizationId))

    const body = await biSaveCopyValidator.validate(request.body())

    try {
      const copy = await this.copyService.saveCopy(
        Number(organizationId),
        templateId,
        body.name,
        body.description ?? '',
        user.id,
      )

      const auditMeta: Record<string, unknown> = {
        sourceTemplateId: templateId,
        sourceVersion: copy.sourceVersion,
      }
      const cfg = (copy as any).config ?? {}
      if ((cfg as any).pluginRef) auditMeta.pluginRef = (cfg as any).pluginRef

      void this.auditService.log({
        event: AuditEvent.BI_TEMPLATE_COPY_SAVED,
        userId: user.id,
        organizationId: Number(organizationId),
        entityType: 'bi_report_template_copy',
        entityId: copy.id,
        metadata: auditMeta as any,
      })

      return response.status(201).json({ data: copy })
    } catch (err) {
      if (err instanceof CopyServiceError) {
        if (err.code === 'VALIDATION_ERROR') {
          return response.badRequest({
            error: { code: 'VALIDATION_ERROR', message: err.message },
          })
        }
        if (err.code === 'RESOURCE_NOT_FOUND') {
          return response.notFound({
            error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
          })
        }
        throw err
      }
      throw err
    }
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/report-templates/:templateId/copy/preview
   * 预览从模板创建组织副本（两步确认第1步，不落库）。
   */
  async previewCopy({ params, request, response, auth }: HttpContext) {
    const { organizationId, templateId } = await biTemplateDetailParamsValidator.validate(params)
    const user = auth.user!
    await this.policy.canWrite(user, Number(organizationId))

    const body = await biCopyPreviewValidator.validate(request.body())
    const hasPersonPermission = await this.policy.canViewPersonDimension(
      user,
      Number(organizationId),
    )

    try {
      const preview = await this.copyService.previewCopy(
        Number(organizationId),
        templateId,
        body.name,
        body.description ?? '',
        user.id,
        { hasPersonPermission },
      )
      return response.json({ data: preview })
    } catch (err) {
      if (err instanceof CopyServiceError) {
        if (err.code === 'VALIDATION_ERROR') {
          return response.badRequest({
            error: { code: 'VALIDATION_ERROR', message: err.message },
          })
        }
        if (err.code === 'RESOURCE_NOT_FOUND') {
          return response.notFound({
            error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
          })
        }
        throw err
      }
      throw err
    }
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/report-templates/:templateId/copy/confirm
   * 确认预览并创建组织副本（两步确认第2步，落库）。
   */
  async confirmCopy({ params, request, response, auth }: HttpContext) {
    const { organizationId } = await biTemplateDetailParamsValidator.validate(params)
    const user = auth.user!
    await this.policy.canWrite(user, Number(organizationId))

    const body = await biCopyConfirmValidator.validate(request.body())

    try {
      const copy = await this.copyService.confirmCopy(
        Number(organizationId),
        body.previewHandle,
        body.previewDigest,
        user.id,
      )

      void this.auditService.log({
        event: AuditEvent.BI_TEMPLATE_COPY_SAVED,
        userId: user.id,
        organizationId: Number(organizationId),
        entityType: 'bi_report_template_copy',
        entityId: copy.id,
        metadata: {
          sourceTemplateId: copy.sourceTemplateId,
          sourceVersion: copy.sourceVersion,
          previewHandle: body.previewHandle,
        } as any,
      })

      return response.status(201).json({ data: copy })
    } catch (err) {
      if (err instanceof CopyServiceError) {
        if (err.code === 'VALIDATION_ERROR') {
          return response.badRequest({
            error: { code: 'VALIDATION_ERROR', message: err.message },
          })
        }
        if (err.code === 'RESOURCE_NOT_FOUND') {
          return response.notFound({
            error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
          })
        }
        throw err
      }
      throw err
    }
  }

  /**
   * PATCH /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId
   * 编辑自定义模板副本元数据。
   */
  async updateCopy({ params, request, response, auth }: HttpContext) {
    const { organizationId, copyId } = await biCopyParamsValidator.validate(params)
    const user = auth.user!
    await this.policy.canWrite(user, Number(organizationId))

    const body = await biUpdateCopyValidator.validate(request.body())

    try {
      const copy = await this.copyService.updateCopy(Number(organizationId), Number(copyId), {
        name: body.name,
        description: body.description,
        defaultFilters: body.defaultFilters as Record<string, string>,
        chartOverrides: body.chartOverrides as Record<string, boolean>,
        concurrencyVersion: body.concurrencyVersion,
      })

      // 审计
      void this.auditService.log({
        event: AuditEvent.BI_TEMPLATE_COPY_UPDATED,
        userId: user.id,
        organizationId: Number(organizationId),
        entityType: 'bi_report_template_copy',
        entityId: copy.id,
      })

      return response.json({ data: copy })
    } catch (err) {
      if (err instanceof CopyServiceError) {
        if (err.code === 'CONCURRENCY_CONFLICT') {
          return response.conflict({
            error: { code: 'CONCURRENCY_CONFLICT', message: err.message },
          })
        }
        if (err.code === 'RESOURCE_NOT_FOUND') {
          return response.notFound({
            error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
          })
        }
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: err.message },
        })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId/archive
   * 归档自定义模板副本。
   */
  async archiveCopy({ params, response, auth }: HttpContext) {
    const { organizationId, copyId } = await biCopyParamsValidator.validate(params)
    const user = auth.user!
    await this.policy.canWrite(user, Number(organizationId))

    try {
      const copy = await this.copyService.archiveCopy(Number(organizationId), Number(copyId))

      // 审计
      void this.auditService.log({
        event: AuditEvent.BI_TEMPLATE_COPY_ARCHIVED,
        userId: user.id,
        organizationId: Number(organizationId),
        entityType: 'bi_report_template_copy',
        entityId: copy.id,
      })

      return response.json({ data: copy })
    } catch (err) {
      if (err instanceof CopyServiceError) {
        if (err.code === 'RESOURCE_NOT_FOUND') {
          return response.notFound({
            error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
          })
        }
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: err.message },
        })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId/restore
   * 恢复已归档的自定义模板副本。
   */
  async restoreCopy({ params, response, auth }: HttpContext) {
    const { organizationId, copyId } = await biCopyParamsValidator.validate(params)
    const user = auth.user!
    await this.policy.canWrite(user, Number(organizationId))

    try {
      const copy = await this.copyService.restoreCopy(Number(organizationId), Number(copyId))

      // 审计
      void this.auditService.log({
        event: AuditEvent.BI_TEMPLATE_COPY_RESTORED,
        userId: user.id,
        organizationId: Number(organizationId),
        entityType: 'bi_report_template_copy',
        entityId: copy.id,
      })

      return response.json({ data: copy })
    } catch (err) {
      if (err instanceof CopyServiceError) {
        if (err.code === 'RESOURCE_NOT_FOUND') {
          return response.notFound({
            error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
          })
        }
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: err.message },
        })
      }
      throw err
    }
  }
}
