import AuditService, { AuditEvent } from '#services/audit_service'
import ProjectHealthDiagnosisPolicy from '#policies/project_health_diagnosis_policy'
import ProjectHealthDiagnosisService from '#services/health_diagnosis/diagnosis_service'
import ProjectHealthAiDraftService from '#services/health_diagnosis/ai_draft_service'
import {
  listDiagnosesValidator,
  generateDiagnosisValidator,
  confirmDiagnosisValidator,
  rejectDiagnosisValidator,
  confirmStaleDiagnosisValidator,
} from '#validators/health_diagnosis'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * 项目健康诊断 Controller（v2-ai-project-health-diagnosis §5.3）。
 * 所有端点嵌套于 /api/v1/projects/:projectId/health-diagnoses。
 */
@inject()
export default class ProjectHealthDiagnosesController {
  constructor(
    private service: ProjectHealthDiagnosisService,
    private aiDraft: ProjectHealthAiDraftService,
    private policy: ProjectHealthDiagnosisPolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  /** GET /api/v1/projects/:projectId/health-diagnoses/latest */
  async latest(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)

    if (!(await this.policy.view(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无项目健康诊断查看权限' },
      })
    }

    try {
      const diagnosis = await this.service.getLatest(organizationId, projectId, user.id)
      return ctx.response.ok({ data: diagnosis })
    } catch (err) {
      if (err instanceof Error && err.message === 'RESOURCE_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在或已删除' },
        })
      }
      throw err
    }
  }

  /** GET /api/v1/projects/:projectId/health-diagnoses */
  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)

    if (!(await this.policy.view(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无项目健康诊断查看权限' },
      })
    }

    const filters = await ctx.request.validateUsing(listDiagnosesValidator, {
      data: ctx.request.qs(),
    })

    try {
      const { data, meta } = await this.service.list({
        projectId,
        organizationId,
        status: filters.status,
        page: filters.page ?? 1,
        perPage: filters.perPage ?? 20,
        sort: filters.sort,
      })
      return ctx.response.ok({ data, meta })
    } catch (err) {
      if (err instanceof Error && err.message === 'RESOURCE_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在或已删除' },
        })
      }
      throw err
    }
  }

  /** GET /api/v1/projects/:projectId/health-diagnoses/:id */
  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const diagnosisId = Number(ctx.params.id)

    if (!(await this.policy.view(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无项目健康诊断查看权限' },
      })
    }

    try {
      const diagnosis = await this.service.getById(diagnosisId, organizationId, projectId, user.id)
      return ctx.response.ok({ data: diagnosis })
    } catch (err) {
      if (err instanceof Error && err.message === 'RESOURCE_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: '诊断记录或项目不存在' },
        })
      }
      throw err
    }
  }

  /** POST /api/v1/projects/:projectId/health-diagnoses */
  async store(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)

    if (!(await this.policy.generate(user, organizationId))) {
      await this.audit.log({
        event: AuditEvent.HEALTH_DIAGNOSIS_PERMISSION_DENIED,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'project_health_diagnosis',
        metadata: { action: 'generate' },
      })
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无项目健康诊断生成权限' },
      })
    }

    const input = await ctx.request.validateUsing(generateDiagnosisValidator)

    try {
      const hasRiskView = await this.policy.view(user, organizationId)
      const { diagnosis, warnings } = await this.service.create({
        organizationId,
        projectId,
        userId: user.id,
        hasRiskView,
        hasResourceView: hasRiskView,
        hasChangeImpactView: hasRiskView,
        enableAiDraft: input.enableAiDraft ?? false,
      })
      return ctx.response.created({ data: diagnosis, warnings })
    } catch (err) {
      if (err instanceof Error && err.message === 'RESOURCE_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在或已删除' },
        })
      }
      throw err
    }
  }

  /** POST /api/v1/projects/:projectId/health-diagnoses/refresh */
  async refresh(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)

    if (!(await this.policy.generate(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无项目健康诊断生成权限' },
      })
    }

    try {
      const { diagnosis, warnings } = await this.service.refresh({
        organizationId,
        projectId,
        userId: user.id,
        hasRiskView: true,
        hasResourceView: true,
        hasChangeImpactView: true,
      })
      return ctx.response.created({ data: diagnosis, warnings })
    } catch (err) {
      if (err instanceof Error && err.message === 'RESOURCE_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在或已删除' },
        })
      }
      throw err
    }
  }

  /** POST /api/v1/projects/:projectId/health-diagnoses/:id/ai-draft */
  async generateAiDraft(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const diagnosisId = Number(ctx.params.id)

    if (!(await this.policy.generate(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无项目健康诊断生成权限' },
      })
    }

    try {
      const result = await this.aiDraft.generateAiDraft({
        diagnosisId,
        organizationId,
        projectId,
        userId: user.id,
      })
      return ctx.response.ok({
        data: result.draft,
        warnings: result.warnings,
        costSummary: result.costSummary,
      })
    } catch (err) {
      if (err instanceof Error && err.message === 'RESOURCE_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: '诊断记录或项目不存在' },
        })
      }
      throw err
    }
  }

  /** POST /api/v1/projects/:projectId/health-diagnoses/:id/confirm */
  async confirm(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const diagnosisId = Number(ctx.params.id)

    if (!(await this.policy.confirm(user, organizationId))) {
      await this.audit.log({
        event: AuditEvent.HEALTH_DIAGNOSIS_PERMISSION_DENIED,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'project_health_diagnosis',
        metadata: { action: 'confirm' },
      })
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无项目健康诊断确认权限' },
      })
    }

    const input = await ctx.request.validateUsing(confirmDiagnosisValidator)

    try {
      const diagnosis = await this.service.confirm({
        diagnosisId,
        userId: user.id,
        organizationId,
        projectId,
        notes: input.notes,
      })
      return ctx.response.ok({ data: diagnosis })
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'RESOURCE_NOT_FOUND')
          return ctx.response.notFound({
            error: { code: 'RESOURCE_NOT_FOUND', message: '诊断记录或项目不存在' },
          })
        if (err.message === 'HEALTH_DIAGNOSIS_REJECTED_CANNOT_CONFIRM')
          return ctx.response.conflict({
            error: { code: 'CONFLICT', message: '已驳回的诊断不可确认' },
          })
        if (err.message === 'HEALTH_DIAGNOSIS_ALREADY_CONFIRMED')
          return ctx.response.conflict({ error: { code: 'CONFLICT', message: '诊断已被确认' } })
      }
      throw err
    }
  }

  /** POST /api/v1/projects/:projectId/health-diagnoses/:id/reject */
  async reject(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const diagnosisId = Number(ctx.params.id)

    if (!(await this.policy.confirm(user, organizationId))) {
      await this.audit.log({
        event: AuditEvent.HEALTH_DIAGNOSIS_PERMISSION_DENIED,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'project_health_diagnosis',
        metadata: { action: 'reject' },
      })
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无项目健康诊断确认权限' },
      })
    }

    const input = await ctx.request.validateUsing(rejectDiagnosisValidator)

    try {
      const diagnosis = await this.service.reject({
        diagnosisId,
        userId: user.id,
        organizationId,
        projectId,
        reason: input.reason,
      })
      return ctx.response.ok({ data: diagnosis })
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'RESOURCE_NOT_FOUND')
          return ctx.response.notFound({
            error: { code: 'RESOURCE_NOT_FOUND', message: '诊断记录或项目不存在' },
          })
        if (err.message === 'HEALTH_DIAGNOSIS_ALREADY_REJECTED')
          return ctx.response.conflict({ error: { code: 'CONFLICT', message: '诊断已被驳回' } })
      }
      throw err
    }
  }

  /** POST /api/v1/projects/:projectId/health-diagnoses/:id/confirm-stale */
  async confirmStale(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const diagnosisId = Number(ctx.params.id)

    if (!(await this.policy.confirm(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无项目健康诊断确认权限' },
      })
    }

    const input = await ctx.request.validateUsing(confirmStaleDiagnosisValidator)

    try {
      const diagnosis = await this.service.confirmStale(
        diagnosisId,
        organizationId,
        projectId,
        user.id,
        input.reason,
      )
      return ctx.response.ok({ data: diagnosis })
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'RESOURCE_NOT_FOUND')
          return ctx.response.notFound({
            error: { code: 'RESOURCE_NOT_FOUND', message: '诊断记录或项目不存在' },
          })
        if (err.message === 'HEALTH_DIAGNOSIS_NOT_CONFIRMED')
          return ctx.response.conflict({
            error: { code: 'CONFLICT', message: '仅已确认的诊断可标记为继续使用' },
          })
      }
      throw err
    }
  }
}
