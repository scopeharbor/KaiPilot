/**
 * periodic_report_controller —— AI 周期报表 HTTP 控制器。
 *
 * 端点前缀：/projects/:projectId/reports/v2/periodic
 * 所有端点需认证，并在授权范围内执行。
 */
import type { V2ReportTemplateId, V2ReportExportFormat, ReportWarningV2 } from '@aiproj/types'
import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import { errors } from '@vinejs/vine'
import ReportVersion from '#models/report_version'
import ReportJob from '#models/report_job'
import { ReportPeriodicInputAggregator } from '#services/report_v2/periodic_aggregator'
import { AiPeriodicReportDraftService } from '#services/report_v2/periodic_draft_service'
import {
  periodicPreviewValidator,
  periodicGenerateValidator,
  periodicReviewValidator,
  periodicExportValidator,
} from '#validators/report_periodic'
import {
  checkExportPermission,
  renderPeriodicDocument,
} from '#services/report_v2/periodic_export_service'
import { TEMPLATE_MAP } from '#services/report_v2/templates'

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 根据模板 ID 获取周期类型。
 */
function getPeriodType(templateId: string): 'weekly' | 'monthly' {
  const template = TEMPLATE_MAP.get(templateId as any)
  return (template?.periodType ?? 'weekly') as 'weekly' | 'monthly'
}

/**
 * 根据当前周期范围推算上一周期范围。
 */
function derivePrevPeriod(
  fromDate: string,
  toDate: string,
  _periodType: 'weekly' | 'monthly',
): { prevFromDate: string; prevToDate: string } {
  const from = new Date(fromDate)
  const to = new Date(toDate)
  const diff = to.getTime() - from.getTime()

  const prevTo = new Date(from.getTime() - 1)
  const prevFrom = new Date(prevTo.getTime() - diff)

  return {
    prevFromDate: prevFrom.toISOString().slice(0, 10),
    prevToDate: prevTo.toISOString().slice(0, 10),
  }
}

/**
 * 获取认证用户和项目 ID。
 */
function getContext(ctx: HttpContext) {
  ctx.auth.getUserOrFail()
  const projectId = Number(ctx.params.projectId)
  const organizationId = ctx.tenant?.organizationId ?? 1
  const userId = Number(ctx.authPayload?.sub ?? 0)
  return { projectId, organizationId, userId }
}

// ---------------------------------------------------------------------------
// 控制器
// ---------------------------------------------------------------------------

export default class PeriodicReportController {
  /**
   * POST /projects/:projectId/reports/v2/periodic/preview
   * 创建周期报表预览（dry-run）。
   */
  async previewPeriodic(ctx: HttpContext) {
    const { projectId, organizationId, userId } = getContext(ctx)

    try {
      const payload = await periodicPreviewValidator.validate(ctx.request.all())
      const template = TEMPLATE_MAP.get(payload.templateId as any)
      if (!template) {
        return ctx.response.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: '未知模板' },
        })
      }

      const periodType = getPeriodType(payload.templateId)
      const { prevFromDate, prevToDate } = derivePrevPeriod(
        payload.fromDate,
        payload.toDate,
        periodType,
      )

      // 聚合
      const aggregator = new ReportPeriodicInputAggregator()
      const aggregation = await aggregator.aggregate({
        organizationId,
        projectId,
        userId,
        templateId: payload.templateId,
        fromDate: payload.fromDate,
        toDate: payload.toDate,
        prevFromDate,
        prevToDate,
      })

      return ctx.response.json({
        data: {
          templateId: payload.templateId,
          templateVersion: template ? '1.0' : '0.0',
          title: payload.title ?? template.name,
          dateRange: { fromDate: payload.fromDate, toDate: payload.toDate },
          prevDateRange: { fromDate: prevFromDate, toDate: prevToDate },
          periodType,
          dataSources: aggregation.currentPeriod,
          previousDataSources: aggregation.previousPeriod,
          comparison: aggregation.comparison,
          warnings: aggregation.warnings,
          blocking: aggregation.blocking,
          sourceHash: aggregation.sourceHash,
          exportFormats: template.supportedFormats,
          aiEnabled: template.aiEnabled ?? false,
        },
      })
    } catch (error) {
      if (error instanceof errors.E_VALIDATION_ERROR) {
        return ctx.response.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: error.messages },
        })
      }
      throw error
    }
  }

  /**
   * POST /projects/:projectId/reports/v2/periodic/generate
   * 生成 AI 周期报表版本和草稿。
   */
  async generatePeriodic(ctx: HttpContext) {
    const { projectId, organizationId, userId } = getContext(ctx)

    try {
      const payload = await periodicGenerateValidator.validate(ctx.request.all())
      const template = TEMPLATE_MAP.get(payload.templateId as any)
      if (!template) {
        return ctx.response.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: '未知模板' },
        })
      }

      const periodType = getPeriodType(payload.templateId)
      const { prevFromDate, prevToDate } = derivePrevPeriod(
        payload.fromDate,
        payload.toDate,
        periodType,
      )

      // 聚合
      const aggregator = new ReportPeriodicInputAggregator()
      const aggregation = await aggregator.aggregate({
        organizationId,
        projectId,
        userId,
        templateId: payload.templateId,
        fromDate: payload.fromDate,
        toDate: payload.toDate,
        prevFromDate,
        prevToDate,
      })

      // 检查 blocking
      if (aggregation.blocking) {
        return ctx.response.status(400).json({
          error: {
            code: 'BLOCKING_WARNING',
            message: '存在阻断性警告，无法生成报表',
            details: { warnings: aggregation.warnings },
          },
        })
      }

      const now = DateTime.now()

      // 创建版本
      const version = await ReportVersion.create({
        organizationId,
        projectId,
        reportId: null,
        templateId: payload.templateId as V2ReportTemplateId,
        templateVersion: '1.0',
        title: payload.title ?? template.name,
        dateRange: { fromDate: payload.fromDate, toDate: payload.toDate },
        periodType,
        prevDateRange: { fromDate: prevFromDate, toDate: prevToDate },
        filters: { fromDate: payload.fromDate, toDate: payload.toDate },
        dataSourceHashes: null,
        snapshotHash: payload.previewSnapshotHash,
        warnings: aggregation.warnings,
        documentRef: null,
        aiDraft: null,
        aiReviewStatus: null,
        aiDraftRef: null,
        inputSourceHashes: null,
        modelSummary: null,
        costSummary: null,
        aiCostRef: null,
        attempt: 1,
        idempotencyKey: payload.idempotencyKey ?? null,
        reviewNotes: null,
        reviewAction: null,
        generatedBy: userId,
        generatedAt: now,
        confirmedAt: null,
        confirmedBy: null,
        returnedAt: null,
        returnedBy: null,
      })

      // 创建任务
      const job = await ReportJob.create({
        organizationId,
        projectId,
        reportId: null,
        versionId: version.id,
        templateId: payload.templateId as V2ReportTemplateId,
        requestedBy: userId,
        status: 'queued',
        attempt: 1,
        idempotencyKey: payload.idempotencyKey ?? null,
        progress: null,
        errorCategory: null,
        errorDetail: null,
        startedAt: null,
        finishedAt: null,
      })

      // 生成 AI 草稿（使用 fake provider）
      const draftService = new AiPeriodicReportDraftService(organizationId, projectId, userId)
      const draftResult = await draftService.generateDraft({
        templateId: payload.templateId,
        periodType,
        fromDate: payload.fromDate,
        toDate: payload.toDate,
        aggregation,
        idempotencyKey: payload.idempotencyKey,
      })

      // 持久化草稿
      if (draftResult.draft) {
        await draftService.persistDraft(
          version.id,
          draftResult.draft,
          draftResult.modelSummary,
          draftResult.costSummary,
          aggregation.warnings.map((w) => w.code),
          payload.previewSnapshotHash,
          payload.idempotencyKey,
        )
      }

      // 更新任务状态
      job.status = 'succeeded'
      job.finishedAt = DateTime.now()
      await job.save()

      return ctx.response.json({
        data: {
          version: version.serialize(),
          job: job.serialize(),
          draft: draftResult.draft,
          costSummary: draftResult.costSummary,
          warnings: draftResult.warnings,
          blocked: draftResult.blocked,
        },
      })
    } catch (error) {
      if (error instanceof errors.E_VALIDATION_ERROR) {
        return ctx.response.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: error.messages },
        })
      }
      throw error
    }
  }

  /**
   * GET /projects/:projectId/reports/v2/periodic/jobs/:jobId
   * 获取周期报表任务状态。
   */
  async showPeriodicJob(ctx: HttpContext) {
    const { organizationId } = getContext(ctx)
    const jobId = Number(ctx.params.jobId)

    const job = await ReportJob.query()
      .where('id', jobId)
      .where('organization_id', organizationId)
      .first()

    if (!job) {
      return ctx.response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '任务不存在' },
      })
    }

    return ctx.response.json({ data: job.serialize() })
  }

  /**
   * POST /projects/:projectId/reports/v2/periodic/jobs/:jobId/retry
   * 重试周期报表任务。
   */
  async retryPeriodicJob(ctx: HttpContext) {
    const { organizationId } = getContext(ctx)
    const jobId = Number(ctx.params.jobId)

    const existingJob = await ReportJob.query()
      .where('id', jobId)
      .where('organization_id', organizationId)
      .first()

    if (!existingJob) {
      return ctx.response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '任务不存在' },
      })
    }

    const newJob = await ReportJob.create({
      organizationId: existingJob.organizationId,
      projectId: existingJob.projectId,
      reportId: existingJob.reportId,
      versionId: existingJob.versionId,
      templateId: existingJob.templateId,
      requestedBy: existingJob.requestedBy,
      status: 'queued',
      attempt: (existingJob.attempt ?? 0) + 1,
      idempotencyKey: existingJob.idempotencyKey
        ? `${existingJob.idempotencyKey}-retry-${(existingJob.attempt ?? 0) + 1}`
        : null,
      progress: null,
      errorCategory: null,
      errorDetail: null,
      startedAt: null,
      finishedAt: null,
    })

    return ctx.response.json({ data: newJob.serialize() })
  }

  /**
   * PATCH /projects/:projectId/reports/v2/periodic/versions/:versionId/review
   * 审核周期报表草稿（确认/退回/编辑）。
   */
  async reviewPeriodicDraft(ctx: HttpContext) {
    const { organizationId, userId } = getContext(ctx)
    const versionId = Number(ctx.params.versionId)

    try {
      const payload = await periodicReviewValidator.validate(ctx.request.all())

      const version = await ReportVersion.query()
        .where('id', versionId)
        .where('organization_id', organizationId)
        .first()

      if (!version) {
        return ctx.response.status(404).json({
          error: { code: 'RESOURCE_NOT_FOUND', message: '版本不存在' },
        })
      }

      const draftService = new AiPeriodicReportDraftService(
        organizationId,
        version.projectId,
        userId,
      )

      switch (payload.action) {
        case 'confirm': {
          const result = await draftService.confirmDraft(versionId, payload.editedDraft as any)
          return ctx.response.json({
            data: {
              versionId: result.versionId,
              reviewStatus: result.reviewStatus,
              confirmedAt: DateTime.now().toISO(),
              confirmedBy: userId,
            },
          })
        }

        case 'return': {
          if (!payload.returnReason) {
            return ctx.response.status(422).json({
              error: { code: 'VALIDATION_ERROR', message: '退回原因不能为空' },
            })
          }
          const result = await draftService.returnDraft(versionId, payload.returnReason)
          return ctx.response.json({
            data: {
              versionId: result.versionId,
              reviewStatus: result.reviewStatus,
              returnedAt: DateTime.now().toISO(),
              returnedBy: userId,
            },
          })
        }

        case 'edit': {
          if (!payload.editedDraft) {
            return ctx.response.status(422).json({
              error: { code: 'VALIDATION_ERROR', message: '编辑内容不能为空' },
            })
          }
          version.aiDraft = JSON.stringify(payload.editedDraft)
          version.aiReviewStatus = 'editing'
          version.reviewAction = 'edit'
          await version.save()

          return ctx.response.json({
            data: {
              versionId: version.id,
              reviewStatus: 'editing',
              confirmedAt: null,
              confirmedBy: null,
            },
          })
        }

        default:
          return ctx.response.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: '未知审核操作' },
          })
      }
    } catch (error) {
      if (error instanceof errors.E_VALIDATION_ERROR) {
        return ctx.response.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: error.messages },
        })
      }
      throw error
    }
  }

  /**
   * POST /projects/:projectId/reports/v2/periodic/versions/:versionId/exports
   * 请求周期报表导出。
   */
  async requestPeriodicExport(ctx: HttpContext) {
    const { organizationId } = getContext(ctx)
    const versionId = Number(ctx.params.versionId)

    try {
      const payload = await periodicExportValidator.validate(ctx.request.all())

      const version = await ReportVersion.query()
        .where('id', versionId)
        .where('organization_id', organizationId)
        .first()

      if (!version) {
        return ctx.response.status(404).json({
          error: { code: 'RESOURCE_NOT_FOUND', message: '版本不存在' },
        })
      }

      // 检查导出权限
      const permission = checkExportPermission(
        version.aiReviewStatus,
        payload.draftOverride ?? false,
      )

      if (!permission.allowed) {
        return ctx.response.status(403).json({
          error: {
            code: 'PERMISSION_DENIED',
            message: permission.reason ?? '无权导出',
          },
        })
      }

      // 渲染导出
      const isDraftExport = !!(payload.draftOverride && version.aiReviewStatus === 'pending_review')

      const renderedContent = renderPeriodicDocument(
        {
          title: version.title,
          projectName: `Project#${ctx.params.projectId}`,
          templateId: version.templateId,
          periodType: version.periodType as 'weekly' | 'monthly' | undefined,
          dateRange: version.dateRange as { fromDate?: string; toDate?: string },
          generatedAt: version.generatedAt?.toISO() ?? '',
          reviewStatus: version.aiReviewStatus,
          warnings: (version.warnings ?? []) as ReportWarningV2[],
          draftContent: version.aiDraft,
          dataSources: [],
          isDraftExport,
        },
        payload.format as V2ReportExportFormat,
      )

      // 返回下载信息
      const FORMAT_MIME_MAP: Record<string, string> = {
        markdown: 'text/markdown',
        pdf: 'application/pdf',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }
      const mimeType = FORMAT_MIME_MAP[payload.format] ?? 'text/plain'

      ctx.response.header('Content-Type', mimeType)
      ctx.response.header(
        'Content-Disposition',
        `attachment; filename="${version.title}.${payload.format}"`,
      )

      return ctx.response.send(renderedContent)
    } catch (error) {
      if (error instanceof errors.E_VALIDATION_ERROR) {
        return ctx.response.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: error.messages },
        })
      }
      throw error
    }
  }

  /**
   * GET /projects/:projectId/reports/v2/periodic/exports/:exportId/download
   * 下载周期报表导出文件。
   */
  async downloadPeriodicExport(ctx: HttpContext) {
    const { organizationId } = getContext(ctx)
    const exportId = Number(ctx.params.exportId)

    // 查找导出记录（简化实现）
    const { default: ReportExport } = await import('#models/report_export')
    const exportRecord = await ReportExport.query()
      .where('id', exportId)
      .where('organization_id', organizationId)
      .first()

    if (!exportRecord) {
      return ctx.response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '导出记录不存在' },
      })
    }

    if (exportRecord.status !== 'completed') {
      return ctx.response.status(400).json({
        error: { code: 'EXPORT_NOT_READY', message: '导出尚未完成' },
      })
    }

    // 流式返回文件
    ctx.response.header('Content-Type', exportRecord.mimeType ?? 'application/octet-stream')
    ctx.response.header(
      'Content-Disposition',
      `attachment; filename="export-${exportRecord.id}.${exportRecord.format}"`,
    )

    return ctx.response.send(Buffer.from(''))
  }
}
