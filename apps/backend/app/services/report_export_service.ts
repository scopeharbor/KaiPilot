import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import Report from '#models/report'
import User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import TenantSelectionSnapshotService from '#services/tenant_selection_snapshot_service'
import { ensureDir, fileExists, isPathSafe, safeUnlink } from '#services/file_storage'
import CsvRenderer from '#services/report_exporters/csv_renderer'
import MarkdownRenderer from '#services/report_exporters/markdown_renderer'
import type { RenderReportMeta, ReportRenderer } from '#services/report_exporters/renderer_contract'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  isReportExportFormat,
  type ReportExportFormat,
  type ReportFormatConfig,
} from '@aiproj/types'

/**
 * ReportExportService —— 快照 → 磁盘文件的编排（design D5 / tasks 5.3~5.5）。
 *
 * 职责：
 *   - 分发到 Markdown/CSV 渲染器（不做二次 DB 查询）；
 *   - 落盘到受控目录 `{UPLOAD_ROOT}/projects/{projectId}/reports/{reportId}/`；
 *   - 更新 `reports.file_path` / `file_format`（旧文件先清理，避免磁盘堆积）；
 *   - 写审计事件：`REPORT_EXPORTED` / `REPORT_DOWNLOADED` / `REPORT_DOWNLOAD_DENIED`；
 *   - 下载路径校验 `isPathSafe` + `fileExists`，不暴露真实磁盘布局。
 *
 * 组织隔离：所有入口通过 `Project.query().where('organization_id', ...)` 校验。
 * 权限校验：调用方（Controller）必须先经 `ReportPolicy`。
 */

/** 上传根目录（同 file_storage 模块契约，可通过环境变量覆盖）。 */
const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? 'storage/uploads'

const RENDERERS: Record<ReportExportFormat, ReportRenderer> = {
  markdown: new MarkdownRenderer(),
  csv: new CsvRenderer(),
}

export interface ExportResult {
  reportId: number
  format: ReportExportFormat
  /** API 层拼装下载 URL 的相对路径（不含 `/api/v1` 前缀）。 */
  downloadPath: string
  /** 建议展示给用户的文件名（安全 slug）。 */
  filename: string
  /** 文件字节数 */
  size: number
  generatedAt: string
}

export interface DownloadHandle {
  /** 服务端绝对路径（Controller 用于 `response.download`）。 */
  absolutePath: string
  filename: string
  mimeType: string
  size: number
}

@inject()
export default class ReportExportService {
  constructor(
    private audit: AuditService,
    /**
     * 租户 selection 快照服务（v3-multitenant-tenant-identification §7.1/§7.2）。
     *
     * 报表导出是典型的 export builder + 延后交付制品：`create()` 落盘一次，
     * `getDownloadHandle()` 可能在很久之后交付。spec 要求"在制品生成/交付之前
     * 重新解析有效租户"——成员被移出组织后，旧导出文件不该还能下载。
     */
    private selectionSnapshot: TenantSelectionSnapshotService = new TenantSelectionSnapshotService(),
  ) {}

  /**
   * 交付制品前复核 actor 对该组织的成员新鲜度（§7.2）。
   *
   * 复核失败统一 404「导出文件不存在」——与本服务其它拒绝分支同一文案，
   * 不区分"文件不存在"与"你已不是成员"，避免泄露制品存在性。
   */
  private async assertTenantStillFresh(user: User, organizationId: number): Promise<void> {
    const revalidated = await this.selectionSnapshot.revalidateBeforeSideEffect({
      snapshot: {
        schemaVersion: '1',
        actorRef: `user:${user.id}`,
        organizationId,
        scopeMode: 'tenant',
        selectionSource: 'server_selection',
        resolutionReason: 'RESOLVED',
        // 不比对 membershipVersionHash / epoch：本服务没有签发时的快照可比，
        // 这里要复核的是"此刻该 actor 在该组织的成员关系是否仍然有效"。
        membershipVersionHash: null,
        scopeHash: '',
        permissionSnapshotHash: '',
        sourceRefs: [],
        idempotencyKey: '',
        requestId: '',
        issuedAt: new Date().toISOString(),
        selectionEpoch: null,
      },
      operation: 'report.export.deliver',
    })
    // epoch 栅栏这条必然不通过（无签发快照），只认 membership 那一道。
    if (!revalidated.ok && revalidated.failedCheck === 'membership') {
      throw new ResourceNotFoundException('导出文件不存在')
    }
  }

  /**
   * 触发一次导出：渲染 → 落盘 → 更新 Report 记录 → 审计。
   *
   * 幂等策略：同一 report 多次导出时，只保留最新一份磁盘文件（旧文件通过
   * `safeUnlink` 清理），`file_format` 与 `file_path` 更新为最新。
   */
  async create(
    user: User,
    organizationId: number,
    reportId: number,
    input: { format: ReportExportFormat; formatConfig?: ReportFormatConfig },
    options?: { requestId?: string | null },
  ): Promise<ExportResult> {
    if (!isReportExportFormat(input.format)) {
      throw new ValidationException(`不支持的导出格式：${input.format}`)
    }
    const { report, project, generatorName } = await this.loadReportForOrg(organizationId, reportId)

    const renderer = RENDERERS[input.format]
    if (!renderer) {
      throw new ValidationException(`未注册的导出格式：${input.format}`)
    }

    const meta: RenderReportMeta = {
      reportId: Number(report.id),
      title: report.title,
      projectName: project.name,
      generatedAt: report.generatedAt?.toISO() ?? new Date().toISOString(),
      generatedByName: generatorName,
    }
    const rendered = renderer.render(report.dataSnapshot, meta)

    // §7.1：为这次导出创建低敏 tenant selection snapshot（export builder 的租户归属凭据）。
    // sourceRefs 只放低敏引用（report:<id>），绝不放文件路径或正文。
    const tenantSnapshot = await this.selectionSnapshot.createForBackgroundWork({
      context: {
        actorRef: `user:${user.id}`,
        organizationId,
        projectId: Number(project.id),
        membershipRole: null,
        membershipVersionHash: null,
        scopeMode: 'tenant',
        selectionSource: 'server_selection',
        resolutionReason: 'RESOLVED',
        scopeHash: '',
        resolvedAt: new Date().toISOString(),
        warningCodes: [],
        isSuperAdmin: false,
      },
      permissionSnapshotHash: '',
      sourceRefs: [`report:${report.id}`],
      idempotencyKey: `report-export:${report.id}:${input.format}`,
      requestId: options?.requestId ?? '',
    })

    // 落盘：{UPLOAD_ROOT}/projects/{projectId}/reports/{reportId}/{uuid}.{ext}
    const relDir = join('projects', String(project.id), 'reports', String(report.id))
    const absDir = resolve(UPLOAD_ROOT, relDir)
    if (!isPathSafe(absDir, UPLOAD_ROOT)) {
      throw new ValidationException('导出目录不合法')
    }
    await ensureDir(absDir)

    // 清理旧文件（避免磁盘堆积；同一 reportId 仅保留最新一份导出）。
    if (report.filePath) {
      const oldAbs = resolve(UPLOAD_ROOT, report.filePath)
      if (isPathSafe(oldAbs, UPLOAD_ROOT)) {
        await safeUnlink(oldAbs)
      }
    }

    const uniqueName = `${randomUUID()}.${rendered.extension}`
    const absPath = resolve(absDir, uniqueName)
    if (!isPathSafe(absPath, UPLOAD_ROOT)) {
      throw new ValidationException('导出路径不合法')
    }
    await writeFile(absPath, rendered.content)
    const relPath = join(relDir, uniqueName)

    // 更新 report 记录（file_path / file_format）
    await db.transaction(async (trx) => {
      report.useTransaction(trx)
      report.filePath = relPath.replace(/\\/g, '/')
      report.fileFormat = input.format
      await report.save()

      await this.audit.log({
        event: AuditEvent.REPORT_EXPORTED,
        userId: user.id,
        organizationId,
        projectId: Number(project.id),
        entityType: 'report',
        entityId: Number(report.id),
        requestId: options?.requestId ?? randomUUID(),
        metadata: {
          template: report.template,
          format: input.format,
          size: rendered.content.byteLength,
          // §7.5：快照元数据以白名单收敛后才进日志（只含 ID/hash/枚举/时间戳）。
          tenantSelection: this.selectionSnapshot.sanitizeForPayload(tenantSnapshot),
        },
        client: trx,
        strict: true,
      })
    })

    const filename = this.buildDownloadFilename(report.title, report.template, rendered.extension)
    return {
      reportId: Number(report.id),
      format: input.format,
      // Controller 端拼装为 /api/v1/reports/:id/exports/:format/download
      downloadPath: `/reports/${report.id}/exports/${input.format}/download`,
      filename,
      size: rendered.content.byteLength,
      generatedAt: DateTime.local().toISO() ?? new Date().toISOString(),
    }
  }

  /**
   * 定位下载文件：校验存在 + 路径安全 + 与请求 format 匹配。失败会写
   * `REPORT_DOWNLOAD_DENIED` 审计并抛错，让 Controller 返回 404。
   */
  async getDownloadHandle(
    user: User,
    organizationId: number,
    reportId: number,
    format: ReportExportFormat,
    options?: { requestId?: string | null },
  ): Promise<DownloadHandle> {
    // §7.2：交付制品前重新解析有效租户（成员被移除后旧导出不得再下载）。
    await this.assertTenantStillFresh(user, organizationId)
    const { report, project } = await this.loadReportForOrg(organizationId, reportId)

    // 未导出过 or 格式不匹配 → 视为不存在（不泄露内部状态）。
    if (!report.filePath || !report.fileFormat) {
      await this.logDownloadDenied(
        user,
        organizationId,
        project.id,
        report.id,
        format,
        'no_file',
        options,
      )
      throw new ResourceNotFoundException('导出文件不存在')
    }
    if (report.fileFormat !== format) {
      await this.logDownloadDenied(
        user,
        organizationId,
        project.id,
        report.id,
        format,
        'format_mismatch',
        options,
      )
      throw new ResourceNotFoundException('导出文件不存在')
    }

    const absPath = resolve(UPLOAD_ROOT, report.filePath)
    if (!isPathSafe(absPath, UPLOAD_ROOT)) {
      await this.logDownloadDenied(
        user,
        organizationId,
        project.id,
        report.id,
        format,
        'unsafe_path',
        options,
      )
      throw new ResourceNotFoundException('导出文件不存在')
    }
    if (!(await fileExists(absPath))) {
      await this.logDownloadDenied(
        user,
        organizationId,
        project.id,
        report.id,
        format,
        'missing_file',
        options,
      )
      throw new ResourceNotFoundException('导出文件不存在')
    }

    const filename = this.buildDownloadFilename(
      report.title,
      report.template,
      getExtByFormat(format),
    )

    const { size } = await import('node:fs/promises').then((m) => m.stat(absPath))

    await this.audit.log({
      event: AuditEvent.REPORT_DOWNLOADED,
      userId: user.id,
      organizationId,
      projectId: Number(project.id),
      entityType: 'report',
      entityId: Number(report.id),
      requestId: options?.requestId ?? randomUUID(),
      metadata: {
        template: report.template,
        format,
        size: Number(size),
      },
    })

    return {
      absolutePath: absPath,
      filename,
      mimeType: mimeForFormat(format),
      size: Number(size),
    }
  }

  // --- 内部辅助 -------------------------------------------------------------

  /**
   * 查询报表并校验组织+项目。任何跨组织/项目失败 → `RESOURCE_NOT_FOUND`（不泄露存在性）。
   * 同时预加载生成者姓名，供渲染器展示。
   */
  private async loadReportForOrg(
    organizationId: number,
    reportId: number,
  ): Promise<{ report: Report; project: Project; generatorName: string | null }> {
    const report = await Report.query().where('id', reportId).first()
    if (!report) throw new ResourceNotFoundException('报表不存在')

    const project = await Project.query()
      .where('id', Number(report.projectId))
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) throw new ResourceNotFoundException('报表不存在')

    let generatorName: string | null = null
    if (report.generatedBy) {
      const generator = await User.find(report.generatedBy)
      generatorName = generator?.fullName ?? generator?.email ?? null
    }
    return { report, project, generatorName }
  }

  private async logDownloadDenied(
    user: User,
    organizationId: number,
    projectId: number,
    reportId: number,
    format: ReportExportFormat,
    reason: string,
    options?: { requestId?: string | null },
  ): Promise<void> {
    await this.audit.log({
      event: AuditEvent.REPORT_DOWNLOAD_DENIED,
      severity: 'warning',
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'report',
      entityId: reportId,
      requestId: options?.requestId ?? randomUUID(),
      metadata: { format, reason },
    })
  }

  /**
   * 构造下载文件名：`{title}-{template}-{yyyyMMdd}.{ext}`，中文/危险字符替换为下划线。
   * 全部服务端生成，禁止使用客户端提交的 filename。
   */
  private buildDownloadFilename(title: string, template: string, extension: string): string {
    const clean = (basename(title || '') || `report-${template}`)
      .replace(/[\\/:*?"<>|\s]/g, '_')
      .slice(0, 120)
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    return `${clean}-${template}-${date}.${extension}`
  }
}

function getExtByFormat(format: ReportExportFormat): 'md' | 'csv' {
  return format === 'markdown' ? 'md' : 'csv'
}

function mimeForFormat(format: ReportExportFormat): string {
  return format === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/csv; charset=utf-8'
}
