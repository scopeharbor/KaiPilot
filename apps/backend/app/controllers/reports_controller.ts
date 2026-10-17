import Report from '#models/report'
import ReportPolicy from '#policies/report_policy'
import ReportExportService from '#services/report_export_service'
import ReportService from '#services/report_service'
import NotificationService from '#services/notification_service'
import TenantOwnershipResolverService from '#services/tenant_ownership_resolver_service'
import type User from '#models/user'
import {
  createReportValidator,
  exportReportValidator,
  listReportsValidator,
} from '#validators/report'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { isReportExportFormat } from '@aiproj/types'

/**
 * ReportsController —— 报表列表/详情/生成/导出/下载入口（design D6）。
 *
 * 组织+项目上下文流转：
 *   - 嵌套路由（`:projectId` 存在）：直接读 `ctx.params.projectId`；
 *   - 扁平路由（`:id` 报表 id）：先查报表定位 `projectId`，再走 Policy。
 *
 * Section 5：exportStore/exportDownload 已接入 `ReportExportService`。
 * 下载 URL 契约：`/api/v1/reports/:id/exports/:format/download`，`:format` ∈ {markdown,csv}。
 */
@inject()
export default class ReportsController {
  constructor(
    private reportService: ReportService,
    private exportService: ReportExportService,
    private policy: ReportPolicy,
    private notifications: NotificationService,
    private ownership: TenantOwnershipResolverService,
  ) {}

  /**
   * 报表归属前置校验（v3-multitenant-tenant-identification §5.3）。
   *
   * 扁平路由 `/reports/:id` 只带报表 ID；report 是 tenant-derived
   *（`reports.project_id` → `projects.organization_id`），归属须两跳反推。
   */
  private async assertReportOwnership(ctx: HttpContext, reportId: number) {
    await this.ownership.assertRouteResourceOwnership({
      resourceType: 'report',
      resourceId: reportId,
      effectiveOrganizationId: ctx.tenant?.organizationId ?? null,
      decision: ctx.tenantDecision ?? null,
      userId: ctx.authUser?.id ?? null,
      requestId: ctx.request.id() ?? 'unknown',
    })
  }

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  /**
   * 通过 report id 定位项目并做组织隔离校验；命中失败一律 404 掩盖存在性。
   */
  private async loadReportForOrg(
    organizationId: number,
    reportId: number,
  ): Promise<{ report: Report; projectId: number } | null> {
    // Report 模型无 organization_id 列；join projects 校验
    const report = await Report.query().where('id', reportId).first()
    if (!report) return null
    // 交由 ReportService.show 完成 org 校验（跨组织 → 404）
    try {
      const loaded = await this.reportService.show(
        organizationId,
        Number(report.projectId),
        reportId,
      )
      return { report: loaded, projectId: Number(loaded.projectId) }
    } catch {
      return null
    }
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId
    await this.policy.authorizeView(user, organizationId, projectId)

    const filters = await ctx.request.validateUsing(listReportsValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.reportService.list(organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  async exportProjectLegacy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeExport(user, organizationId, projectId)

    const format = String(ctx.request.input('format', 'csv')).toLowerCase()
    if (format !== 'csv') {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'Only csv export is supported here' },
      })
    }

    const { data } = await this.reportService.list(organizationId, projectId, {
      page: 1,
      perPage: 100,
    })
    const rows = [
      ['id', 'title', 'template', 'fileFormat', 'createdAt'],
      ...data.map((report) => [
        String(report.id),
        csvCell(report.title),
        csvCell(report.template),
        csvCell(report.fileFormat ?? ''),
        csvCell(report.createdAt?.toISO?.() ?? String(report.createdAt ?? '')),
      ]),
    ]

    ctx.response.header('Content-Type', 'text/csv; charset=utf-8')
    ctx.response.header('Content-Disposition', 'attachment; filename="project-reports.csv"')
    return ctx.response.ok(rows.map((row) => row.join(',')).join('\n'))
  }

  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const reportId = Number(ctx.params.id)

    await this.assertReportOwnership(ctx, reportId)
    const loaded = await this.loadReportForOrg(organizationId, reportId)
    if (!loaded)
      return ctx.response.notFound({ error: { code: 'REPORT_NOT_FOUND', message: '报表不存在' } })

    await this.policy.authorizeView(user, organizationId, loaded.projectId)
    return ctx.response.ok({ data: loaded.report })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createReportValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeGenerate(user, organizationId, projectId)

    const report = await this.reportService.create(organizationId, projectId, input, user.id, {
      requestId: ctx.request.id() ?? null,
    })
    return ctx.response.created({ data: report })
  }

  /**
   * 导出请求 —— 权限校验 → Validator → ReportExportService.create → 返回下载元数据。
   *
   * 响应结构：`{ data: { reportId, format, downloadUrl, filename, size, generatedAt } }`
   * downloadUrl 由 Service 返回相对路径，此处拼装 `/api/v1` 前缀。
   */
  async exportStore(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const reportId = Number(ctx.params.id)

    await this.assertReportOwnership(ctx, reportId)
    const loaded = await this.loadReportForOrg(organizationId, reportId)
    if (!loaded)
      return ctx.response.notFound({ error: { code: 'REPORT_NOT_FOUND', message: '报表不存在' } })
    await this.policy.authorizeExport(user, organizationId, loaded.projectId)

    const input = await ctx.request.validateUsing(exportReportValidator)
    const result = await this.exportService.create(
      user,
      organizationId,
      reportId,
      { format: input.format, formatConfig: input.formatConfig },
      { requestId: ctx.request.id() ?? null },
    )

    // P1 通知：报表导出完成
    await this.notifications.createForUser({
      organizationId,
      recipientId: user.id,
      type: 'report_exported',
      title: `报表导出完成：「${loaded.report.title}」`,
      body: `报表「${loaded.report.title}」已导出为 ${input.format} 格式。`,
      severity: 'info',
      projectId: loaded.projectId,
      targetType: 'report',
      targetId: reportId,
      actionUrl: result.downloadPath ? `/api/v1${result.downloadPath}` : undefined,
      metadata: {
        reportTitle: loaded.report.title,
        format: input.format,
        reportId,
      },
    })

    return ctx.response.created({
      data: {
        reportId: result.reportId,
        format: result.format,
        downloadUrl: `/api/v1${result.downloadPath}`,
        filename: result.filename,
        size: result.size,
        generatedAt: result.generatedAt,
      },
    })
  }

  /**
   * 下载已生成的导出文件 —— 权限校验 → ReportExportService.getDownloadHandle → response.download。
   * 路由 `:exportId` 参数在 V1 语义下映射为格式字符串（'markdown'/'csv'）。
   */
  async exportDownload(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const reportId = Number(ctx.params.id)
    const rawFormat = String(ctx.params.exportId ?? '')

    if (!isReportExportFormat(rawFormat)) {
      return ctx.response.notFound({
        error: { code: 'REPORT_EXPORT_NOT_FOUND', message: '导出文件不存在' },
      })
    }

    await this.assertReportOwnership(ctx, reportId)
    const loaded = await this.loadReportForOrg(organizationId, reportId)
    if (!loaded)
      return ctx.response.notFound({ error: { code: 'REPORT_NOT_FOUND', message: '报表不存在' } })
    await this.policy.authorizeDownload(user, organizationId, loaded.projectId)

    const handle = await this.exportService.getDownloadHandle(
      user,
      organizationId,
      reportId,
      rawFormat,
      { requestId: ctx.request.id() ?? null },
    )

    ctx.response.header('Content-Type', handle.mimeType)
    ctx.response.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(handle.filename)}"`,
    )
    return ctx.response.download(handle.absolutePath)
  }
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}
