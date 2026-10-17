import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import Report from '#models/report'
import AuditService, { AuditEvent } from '#services/audit_service'
import { REPORT_AGGREGATORS, type AggregatorContext } from '#services/report_aggregators/index'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { createHash, randomUUID } from 'node:crypto'
import {
  REPORT_TEMPLATE_VERSION,
  isReportTemplate,
  type CreateReportRequest,
  type ReportListFilters,
  type ReportSnapshot,
  type ReportSnapshotMetadata,
  type ReportTemplate,
  type ReportWarning,
} from '@aiproj/types'

/**
 * ReportService —— 报表生成/列表/详情编排（design D6/D8）。
 *
 * 组织隔离：任何入口都先经 `assertProjectInOrg`，跨组织抛 `RESOURCE_NOT_FOUND`
 * （spec 需求「跨组织访问返回 RESOURCE_NOT_FOUND」）。
 *
 * 数据来源：全部通过聚合器读取正式落库数据；禁止读 AI 草案/客户端统计
 * （spec 需求「反幻觉与非目标」）。
 *
 * 事务：`create` 期间快照生成失败即抛错，聚合器已只读；写入与审计同事务原子。
 */
@inject()
export default class ReportService {
  constructor(private audit: AuditService) {}

  /**
   * 查询项目是否在组织内且未删除；用于跨组织 404 隔离。
   * 命中失败一律抛 `ResourceNotFoundException`（不泄露存在性）。
   */
  private async assertProjectInOrg(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  /**
   * 列表：按 `report_type`/`generated_by`/时间范围过滤，分页返回 `{ data, meta }`。
   */
  async list(
    organizationId: number,
    projectId: number,
    filters: ReportListFilters = {},
  ): Promise<{
    data: Report[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.assertProjectInOrg(organizationId, projectId)

    const page = Math.max(1, Number(filters.page ?? 1))
    const perPage = Math.min(100, Math.max(1, Number(filters.perPage ?? 20)))

    const query = Report.query().where('project_id', projectId)
    if (filters.template) query.where('report_type', filters.template)
    if (filters.generatedBy) query.where('generated_by', filters.generatedBy)
    if (filters.fromDate) query.where('generated_at', '>=', filters.fromDate)
    if (filters.toDate) query.where('generated_at', '<=', filters.toDate)

    // 排序
    if (filters.sort) {
      const parts = filters.sort.split(',')
      for (const part of parts) {
        const trimmed = part.trim()
        if (!trimmed) continue
        const desc = trimmed.startsWith('-')
        const col = trimmed.replace(/^[+-]/, '')
        // 仅允许安全字段
        if (['generated_at', 'created_at', 'updated_at'].includes(col)) {
          query.orderBy(col, desc ? 'desc' : 'asc')
        }
      }
    } else {
      query.orderBy('generated_at', 'desc').orderBy('id', 'desc')
    }

    const pageResult = await query.paginate(page, perPage)
    return {
      data: pageResult.all(),
      meta: {
        total: pageResult.total,
        page: pageResult.currentPage,
        perPage: pageResult.perPage,
        totalPages: pageResult.lastPage,
      },
    }
  }

  /**
   * 详情：读取已保存的快照，禁止实时替换历史内容（design D5）。
   */
  async show(organizationId: number, projectId: number, reportId: number): Promise<Report> {
    await this.assertProjectInOrg(organizationId, projectId)
    const report = await Report.query().where('id', reportId).where('project_id', projectId).first()
    if (!report) throw new ResourceNotFoundException('报表不存在')
    return report
  }

  /**
   * 生成一次报表：
   *   1. 校验组织+项目；
   *   2. 分发到白名单聚合器（非白名单模板在 Validator 已拦截，此处再兜底 defensive）；
   *   3. 装配 snapshotMetadata（templateVersion/generatedAt/generatedBy/sourceRange/sourceDataHash/warnings）；
   *   4. 事务：Report.create + audit.log（strict 语义，任一失败回滚）。
   */
  async create(
    organizationId: number,
    projectId: number,
    input: CreateReportRequest,
    generatedBy: number,
    options?: { requestId?: string | null },
  ): Promise<Report> {
    const project = await this.assertProjectInOrg(organizationId, projectId)

    const template = input.template
    if (!isReportTemplate(template)) {
      // Validator 层已拦截；此处 defensive
      throw new ValidationException(`不支持的报表模板：${template}`)
    }
    const aggregator = REPORT_AGGREGATORS[template]
    if (!aggregator) {
      throw new ValidationException(`未注册的报表模板：${template}`)
    }

    const filters = input.filters ?? {}
    const warnings: ReportWarning[] = []
    const now = new Date()

    const context: AggregatorContext = {
      organizationId,
      project,
      filters,
      now,
      warnings,
    }

    // 聚合器只读，可在事务外先跑；写入再进事务
    const partial = await aggregator.aggregate(context)
    const metadata: ReportSnapshotMetadata = {
      templateVersion: REPORT_TEMPLATE_VERSION,
      generatedAt: now.toISOString(),
      generatedBy,
      sourceRange: filters,
      sourceDataHash: this.hashSnapshot(partial),
      sourceDataTimestamp: now.toISOString(),
      warnings,
    }
    const snapshot = { ...partial, snapshotMetadata: metadata } as ReportSnapshot

    const title =
      input.title?.trim() || this.defaultTitle(template, now, project.name) || `${template} 报表`

    return db.transaction(async (trx) => {
      const report = await Report.create(
        {
          projectId,
          title,
          template,
          config: filters,
          formatConfig: input.formatConfig ?? null,
          dataSnapshot: snapshot,
          fileFormat: null,
          filePath: null,
          generatedAt: DateTime.fromJSDate(now),
          generatedBy,
        },
        { client: trx },
      )

      await this.audit.log({
        event: AuditEvent.REPORT_GENERATED,
        userId: generatedBy,
        organizationId,
        projectId,
        entityType: 'report',
        entityId: Number(report.id),
        requestId: options?.requestId ?? randomUUID(),
        metadata: {
          template,
          title: report.title,
          warningCount: warnings.length,
        },
        client: trx,
        strict: true,
      })

      return report
    })
  }

  /**
   * 默认报表标题：`{项目名}-{中文模板名}-{yyyy-MM-dd}`。
   */
  private defaultTitle(template: ReportTemplate, now: Date, projectName: string): string {
    const label: Record<ReportTemplate, string> = {
      progress: '进度报表',
      delay: '延期报表',
      workload: '工作量报表',
      milestone: '里程碑报表',
    }
    const date = now.toISOString().slice(0, 10)
    return `${projectName}-${label[template]}-${date}`
  }

  /**
   * SHA-256 摘要前 32 位 hex，用于识别陈旧快照。
   */
  private hashSnapshot(snapshot: unknown): string {
    const json = JSON.stringify(snapshot)
    return createHash('sha256').update(json).digest('hex').slice(0, 32)
  }
}
