/**
 * ReportV2Controller —— V2 报表工作台端点（v2-reporting-system-upgrade）。
 *
 * 端点概览：
 * - GET  /projects/:projectId/reports/v2/templates — 模板目录
 * - GET  /projects/:projectId/reports/v2/workspace — 工作台摘要
 * - POST /projects/:projectId/reports/v2/preview — 预览（dry-run，不落库）
 * - POST /projects/:projectId/reports/v2/versions — 创建版本
 * - GET  /projects/:projectId/reports/v2/versions — 版本列表
 * - GET  /projects/:projectId/reports/v2/versions/:versionId — 版本详情
 * - GET  /projects/:projectId/reports/v2/jobs/:jobId — 任务详情
 * - POST /projects/:projectId/reports/v2/jobs/:jobId/retry — 重试任务
 * - POST /projects/:projectId/reports/v2/versions/:versionId/exports — 创建导出
 * - GET  /projects/:projectId/reports/v2/versions/:versionId/exports — 导出列表
 * - GET  /projects/:projectId/reports/v2/exports/:exportId/download — 下载
 * - PATCH /projects/:projectId/reports/v2/versions/:versionId/ai-review — AI 审核
 *
 * 安全设计：
 * - 所有端点先走 ReportPolicy 权限校验
 * - 跨组织访问统一返回 404（组织隔离由 Service 层保证）
 * - 审计事件低敏化：只记录 ID、状态、错误分类，不记录报表正文
 * - 通知点击和下载端点二次鉴权
 */
import ReportVersion from '#models/report_version'
import ReportJob from '#models/report_job'
import ReportExport from '#models/report_export'
import ReportPolicy from '#policies/report_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import type User from '#models/user'
import {
  previewReport,
  createReportVersion,
  retryJob,
} from '#services/report_v2/generation_service'
import { createExport, listExportsByVersion } from '#services/report_v2/export_service'
import { confirmAiDraft } from '#services/report_v2/ai_draft_service'
import { getVisibleTemplates } from '#services/report_v2/templates'
import {
  v2PreviewValidator,
  v2CreateVersionValidator,
  v2ListVersionsValidator,
  v2CreateExportValidator,
  v2RetryJobValidator,
  v2AiReviewValidator,
} from '#validators/report_v2'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class ReportV2Controller {
  constructor(
    private policy: ReportPolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  // ---------------------------------------------------------------------------
  // 模板目录
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/projects/:projectId/reports/v2/templates
   * 返回用户权限范围内可见的模板目录。
   */
  async listTemplates(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, organizationId, projectId)

    const canViewResources = await this.policy.view(user, organizationId, projectId)
    const canViewRisks = await this.policy.view(user, organizationId, projectId)

    const templates = getVisibleTemplates(true, canViewResources, canViewRisks)
    return ctx.response.ok({ data: templates })
  }

  // ---------------------------------------------------------------------------
  // 工作台摘要
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/projects/:projectId/reports/v2/workspace
   * 工作台摘要：最新版本、进行中的任务、最近导出、警告统计。
   */
  async workspaceSummary(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, organizationId, projectId)

    const [latestVersion, activeJobs, recentExports] = await Promise.all([
      ReportVersion.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .orderBy('created_at', 'desc')
        .first(),
      ReportJob.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .whereNotIn('status', ['succeeded', 'failed', 'cancelled'])
        .orderBy('created_at', 'desc')
        .limit(10),
      ReportExport.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .orderBy('created_at', 'desc')
        .limit(5),
    ])

    return ctx.response.ok({
      data: {
        latestVersion: latestVersion
          ? {
              id: latestVersion.id,
              templateId: latestVersion.templateId,
              title: latestVersion.title,
              generatedAt: latestVersion.generatedAt?.toISO?.() ?? '',
            }
          : null,
        activeJobs: activeJobs.map((j) => ({
          id: j.id,
          templateId: j.templateId,
          status: j.status,
          attempt: j.attempt,
          startedAt: j.startedAt?.toISO?.() ?? null,
        })),
        recentExports: recentExports.map((e) => ({
          id: e.id,
          format: e.format,
          status: e.status,
          completedAt: e.completedAt?.toISO?.() ?? null,
        })),
      },
    })
  }

  // ---------------------------------------------------------------------------
  // 预览（dry-run）
  // ---------------------------------------------------------------------------

  /**
   * POST /api/v1/projects/:projectId/reports/v2/preview
   * 预览报表：聚合数据源、返回 warnings、不创建正式版本。
   */
  async preview(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeGenerate(user, organizationId, projectId)

    const input = await ctx.request.validateUsing(v2PreviewValidator)
    const result = await previewReport(organizationId, projectId, user.id, input)

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.REPORT_V2_PREVIEWED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'report_version',
      metadata: {
        templateId: input.templateId,
        blocking: result.blocking,
        dataSourceCount: Object.keys(result.dataSources).length,
      },
    })

    return ctx.response.ok({ data: result })
  }

  // ---------------------------------------------------------------------------
  // 创建版本
  // ---------------------------------------------------------------------------

  /**
   * POST /api/v1/projects/:projectId/reports/v2/versions
   * 创建报表版本和生成任务。先校验 blocking warning，再创建版本。
   */
  async createVersion(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeGenerate(user, organizationId, projectId)

    const input = await ctx.request.validateUsing(v2CreateVersionValidator)

    const { version, job } = await createReportVersion(
      organizationId,
      projectId,
      user.id,
      null,
      input,
    )

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.REPORT_V2_VERSION_GENERATED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'report_version',
      entityId: version.id,
      metadata: {
        templateId: input.templateId,
        versionId: version.id,
        jobId: job.id,
      },
    })

    return ctx.response.created({ data: { version, job } })
  }

  // ---------------------------------------------------------------------------
  // 版本列表 & 详情
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/projects/:projectId/reports/v2/versions
   * 版本历史分页列表。
   */
  async listVersions(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, organizationId, projectId)

    const filters = await ctx.request.validateUsing(v2ListVersionsValidator, {
      data: ctx.request.qs(),
    })

    const query = ReportVersion.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    if (filters.templateId) {
      query.where('template_id', filters.templateId)
    }

    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20
    const result = await query.paginate(page, perPage)

    return ctx.response.ok({
      data: result.all(),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: Math.ceil(result.total / result.perPage),
      },
    })
  }

  /**
   * GET /api/v1/projects/:projectId/reports/v2/versions/:versionId
   * 版本详情。
   */
  async showVersion(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const versionId = Number(ctx.params.versionId)
    await this.policy.authorizeView(user, organizationId, projectId)

    const version = await ReportVersion.query()
      .where('id', versionId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!version) {
      return ctx.response.notFound({
        error: { code: 'REPORT_VERSION_NOT_FOUND', message: '报表版本不存在' },
      })
    }

    return ctx.response.ok({ data: version })
  }

  // ---------------------------------------------------------------------------
  // 任务详情 & 重试
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/projects/:projectId/reports/v2/jobs/:jobId
   * 任务详情。
   */
  async showJob(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const jobId = Number(ctx.params.jobId)
    await this.policy.authorizeView(user, organizationId, projectId)

    const job = await ReportJob.query()
      .where('id', jobId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!job) {
      return ctx.response.notFound({
        error: { code: 'REPORT_JOB_NOT_FOUND', message: '报表任务不存在' },
      })
    }

    return ctx.response.ok({ data: job })
  }

  /**
   * POST /api/v1/projects/:projectId/reports/v2/jobs/:jobId/retry
   * 重试失败任务：创建新 attempt。
   */
  async retryJob(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const jobId = Number(ctx.params.jobId)
    await this.policy.authorizeGenerate(user, organizationId, projectId)

    await ctx.request.validateUsing(v2RetryJobValidator)

    const newJob = await retryJob(jobId, organizationId)

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.REPORT_V2_JOB_RETRIED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'report_job',
      entityId: newJob.id,
      metadata: {
        originalJobId: jobId,
        newAttempt: newJob.attempt,
      },
    })

    return ctx.response.ok({ data: newJob })
  }

  // ---------------------------------------------------------------------------
  // 导出
  // ---------------------------------------------------------------------------

  /**
   * POST /api/v1/projects/:projectId/reports/v2/versions/:versionId/exports
   * 创建导出记录并触发渲染。
   * V2 导出记录独立保存，支持多格式导出历史。
   */
  async createExport(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const versionId = Number(ctx.params.versionId)
    await this.policy.authorizeExport(user, organizationId, projectId)

    const input = await ctx.request.validateUsing(v2CreateExportValidator)

    // 验证版本存在
    const version = await ReportVersion.query()
      .where('id', versionId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!version) {
      return ctx.response.notFound({
        error: { code: 'REPORT_VERSION_NOT_FOUND', message: '报表版本不存在' },
      })
    }

    // 创建导出记录
    const exportRecord = await createExport({
      organizationId,
      projectId,
      reportId: version.reportId ?? 0,
      versionId,
      format: input.format,
      createdBy: user.id,
    })

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.REPORT_V2_EXPORT_CREATED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'report_export',
      entityId: exportRecord.id,
      metadata: {
        versionId,
        format: input.format,
      },
    })

    return ctx.response.created({
      data: {
        exportId: exportRecord.id,
        format: input.format,
        status: exportRecord.status,
      },
    })
  }

  /**
   * GET /api/v1/projects/:projectId/reports/v2/versions/:versionId/exports
   * 版本导出记录列表。
   */
  async listExports(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const versionId = Number(ctx.params.versionId)
    await this.policy.authorizeView(user, organizationId, projectId)

    const version = await ReportVersion.query()
      .where('id', versionId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!version) {
      return ctx.response.notFound({
        error: { code: 'REPORT_VERSION_NOT_FOUND', message: '报表版本不存在' },
      })
    }

    const exports = await listExportsByVersion(versionId, organizationId)
    // 过滤敏感字段
    const sanitized = exports.map((e) => ({
      id: e.id,
      format: e.format,
      status: e.status,
      fileHash: e.fileHash,
      fileSize: e.fileSize,
      mimeType: e.mimeType,
      errorCategory: e.errorCategory,
      createdBy: e.createdBy,
      createdAt: e.createdAt?.toISO?.() ?? '',
      completedAt: e.completedAt?.toISO?.() ?? null,
    }))

    return ctx.response.ok({ data: sanitized })
  }

  /**
   * GET /api/v1/projects/:projectId/reports/v2/exports/:exportId/download
   * 下载导出文件。二次鉴权：检查当前用户权限 + 导出归属校验。
   */
  async downloadExport(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const exportId = Number(ctx.params.exportId)
    await this.policy.authorizeDownload(user, organizationId, projectId)

    const exportRecord = await ReportExport.query()
      .where('id', exportId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!exportRecord || exportRecord.status !== 'completed') {
      return ctx.response.notFound({
        error: { code: 'REPORT_EXPORT_NOT_FOUND', message: '导出文件不存在或未就绪' },
      })
    }

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.REPORT_V2_EXPORT_DOWNLOADED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'report_export',
      entityId: exportRecord.id,
      metadata: {
        format: exportRecord.format,
        fileHash: exportRecord.fileHash,
        fileSize: exportRecord.fileSize,
      },
    })

    ctx.response.header('Content-Type', exportRecord.mimeType ?? 'application/octet-stream')
    ctx.response.header(
      'Content-Disposition',
      `attachment; filename="report-${exportRecord.id}.${exportRecord.format}"`,
    )

    // 返回导出文件内容（V2 简化版：返回文件元数据 + 内容头，实际文件路径安全处理）
    return ctx.response.ok({
      data: {
        exportId: exportRecord.id,
        format: exportRecord.format,
        fileHash: exportRecord.fileHash,
        fileSize: exportRecord.fileSize,
        mimeType: exportRecord.mimeType,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // AI 草稿审核
  // ---------------------------------------------------------------------------

  /**
   * PATCH /api/v1/projects/:projectId/reports/v2/versions/:versionId/ai-review
   * AI 草稿审核：用户可确认或拒绝 AI 生成的草稿。
   * 确认动作只提交报表版本审核状态，不触发项目数据修改。
   */
  async aiReview(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const versionId = Number(ctx.params.versionId)
    await this.policy.authorizeAiReview(user, organizationId, projectId)

    const input = await ctx.request.validateUsing(v2AiReviewValidator)

    const version = await ReportVersion.query()
      .where('id', versionId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!version) {
      return ctx.response.notFound({
        error: { code: 'REPORT_VERSION_NOT_FOUND', message: '报表版本不存在' },
      })
    }

    if (input.reviewStatus === 'confirmed') {
      await confirmAiDraft(versionId, user.id, {
        editedDraft: input.aiDraft,
      })

      await this.audit.log({
        event: AuditEvent.REPORT_V2_AI_DRAFT_CONFIRMED,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'report_version',
        entityId: versionId,
        metadata: {
          templateId: version.templateId,
          hasEdits: !!input.aiDraft,
        },
      })

      return ctx.response.ok({
        data: {
          versionId,
          aiReviewStatus: 'confirmed',
          confirmedAt: new Date().toISOString(),
        },
      })
    }

    if (input.reviewStatus === 'rejected') {
      await ReportVersion.query().where('id', versionId).update({
        aiReviewStatus: 'rejected',
      })

      await this.audit.log({
        event: AuditEvent.REPORT_V2_AI_DRAFT_FAILED,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'report_version',
        entityId: versionId,
        metadata: {
          templateId: version.templateId,
          reason: 'user_rejected',
        },
      })

      return ctx.response.ok({
        data: {
          versionId,
          aiReviewStatus: 'rejected',
          confirmedAt: null,
        },
      })
    }

    return ctx.response.badRequest({
      error: { code: 'VALIDATION_ERROR', message: '不支持的审核状态' },
    })
  }
}
