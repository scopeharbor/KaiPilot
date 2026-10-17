/**
 * report_v2/export_service —— V2 报表导出服务。
 *
 * 支持格式：Markdown、CSV、PDF、XLSX
 * PDF/XLSX 为 V2 新增格式，必须有失败分类、重试和审计。
 * 所有导出记录挂载到报表版本，二次权限校验后方可下载。
 */
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'
import ReportExport from '#models/report_export'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { withExportLease, poolTenantContextFor } from '#services/tenant_connection_pool_wrapper'
import type { V2ReportExportFormat, ReportDocument } from '@aiproj/types'

/**
 * 组织 scope 内解析导出记录（v3-multitenant-database-isolation §5.3）。
 * 跨组织与不存在统一 `RESOURCE_NOT_FOUND`，不泄露导出记录存在性。
 */
async function scopedExportOrFail(exportId: number, organizationId: number): Promise<ReportExport> {
  const exp = await ReportExport.query()
    .where('id', exportId)
    .where('organization_id', organizationId)
    .first()
  if (!exp) throw new ResourceNotFoundException('导出记录不存在')
  return exp
}

// ---------------------------------------------------------------------------
// 导出请求
// ---------------------------------------------------------------------------

export interface CreateExportInput {
  organizationId: number
  projectId: number
  reportId: number
  versionId: number
  format: V2ReportExportFormat
  createdBy: number
}

// ---------------------------------------------------------------------------
// MD 格式化器（V1 兼容 + warnings 摘要）
// ---------------------------------------------------------------------------

export function renderMarkdown(document: ReportDocument): string {
  const lines: string[] = []

  lines.push(`# ${document.title}`)
  lines.push('')
  lines.push(`> 生成时间：${document.generatedAt}`)
  lines.push(`> 项目：${document.projectName}`)
  if (document.dateRange.fromDate) {
    lines.push(`> 时间范围：${document.dateRange.fromDate} ~ ${document.dateRange.toDate ?? ''}`)
  }
  lines.push('')

  // Warnings
  if (document.warnings.length > 0) {
    lines.push('## 警告')
    for (const w of document.warnings) {
      lines.push(`- [${w.code}] ${w.message}`)
    }
    lines.push('')
  }

  // Sections
  for (const section of document.sections) {
    lines.push(`## ${section.title}`)
    lines.push('')
    if (typeof section.content === 'string') {
      lines.push(section.content)
    } else if (Array.isArray(section.content)) {
      for (const item of section.content) {
        if (typeof item === 'object' && item !== null) {
          lines.push(`- ${JSON.stringify(item, null, 2)}`)
        } else {
          lines.push(`- ${String(item)}`)
        }
      }
    }
    lines.push('')
  }

  // AI 草稿
  if (document.aiDraft) {
    lines.push('---')
    lines.push('')
    lines.push(document.aiDraft)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CSV 格式化器（任务/资源/风险/里程碑等表格型 section）
// ---------------------------------------------------------------------------

export function renderCsv(document: ReportDocument): string {
  const rows: string[] = []

  // 元数据
  rows.push(`# ${document.title}`)
  rows.push(`# 生成时间,${document.generatedAt}`)
  rows.push(`# 项目,${document.projectName}`)
  rows.push('')

  // Warnings
  for (const w of document.warnings) {
    rows.push(`# WARNING: [${w.code}] ${w.message}`)
  }
  if (document.warnings.length > 0) rows.push('')

  // Sections — 只处理 table 类型 section
  for (const section of document.sections) {
    if (section.type !== 'table' || !Array.isArray(section.content)) continue

    rows.push(`# ${section.title}`)
    for (const row of section.content) {
      if (typeof row === 'object' && row !== null) {
        const values = Object.values(row as Record<string, unknown>).map((v) =>
          String(v ?? '').replace(/"/g, '""'),
        )
        rows.push(values.map((v) => `"${v}"`).join(','))
      }
    }
    rows.push('')
  }

  // AI 草稿
  if (document.aiDraft) {
    rows.push('# AI 草稿')
    rows.push(document.aiDraft.replace(/\n/g, ' '))
  }

  return rows.join('\n')
}

// ---------------------------------------------------------------------------
// PDF 格式化器（占桩 — V2 PDF 渲染库待选择接入）
// ---------------------------------------------------------------------------

/**
 * PDF 格式化器占桩。
 * V2 要求 PDF 包含中文标题、关键指标、warnings 和主要表格。
 * 当前返回简易 Markdown 格式，后续接入 pdf-lib 或 puppeteer 后替换。
 */
export function renderPdf(document: ReportDocument): string {
  // 占桩：返回 MIME 声明和标记内容
  const md = renderMarkdown(document)
  return `[V2-PDF-PLACEHOLDER]\n\n${md}`
}

/**
 * XLSX 格式化器占桩。
 * V2 要求 XLSX 多工作表、字段标题、来源说明、hash 和 MIME。
 * 后续接入 exceljs 或 xlsx 后替换。
 */
export function renderXlsx(document: ReportDocument): string {
  return `[V2-XLSX-PLACEHOLDER]\ntitle: ${document.title}\nsections: ${document.sections.length}\n`
}

// ---------------------------------------------------------------------------
// MIME type
// ---------------------------------------------------------------------------

export const FORMAT_MIME: Record<V2ReportExportFormat, string> = {
  markdown: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export const FORMAT_EXT: Record<V2ReportExportFormat, string> = {
  markdown: '.md',
  csv: '.csv',
  pdf: '.pdf',
  xlsx: '.xlsx',
}

// ---------------------------------------------------------------------------
// 导出记录管理
// ---------------------------------------------------------------------------

/**
 * 创建导出记录。
 *
 * v3-multitenant-connection-pool-management §5.5：导出是高风险长流程入口，
 * 记录创建在 `export:report` 租户连接 lease 保护下执行，使单租户的批量导出
 * 受租户/全局预算与有界队列约束；失败路径由 wrapper 的 finally 释放。
 */
export async function createExport(input: CreateExportInput): Promise<ReportExport> {
  return withExportLease(
    'export:report',
    {
      operationKind: 'export_create',
      tenant: poolTenantContextFor({
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorRef: `user:${input.createdBy}`,
      }),
      requestId: `report-export:${input.reportId}:${input.versionId}`,
    },
    () => createExportRecord(input),
  )
}

async function createExportRecord(input: CreateExportInput): Promise<ReportExport> {
  return ReportExport.create({
    organizationId: input.organizationId,
    projectId: input.projectId,
    reportId: input.reportId,
    versionId: input.versionId,
    format: input.format,
    status: 'pending',
    fileHash: null,
    fileSize: null,
    mimeType: null,
    filePath: null,
    errorCategory: null,
    createdBy: input.createdBy,
    completedAt: null,
  })
}

/**
 * 标记导出成功。
 */
export async function completeExport(
  exportId: number,
  content: string,
  organizationId: number,
): Promise<ReportExport> {
  // v3-multitenant-database-isolation §5.3：导出记录状态写回必须在组织 scope 内解析。
  // 原实现 `ReportExport.findOrFail(exportId)` 无租户条件，任何持有 exportId 的
  // 调用路径都能改写他租导出记录（状态/hash/大小/mime）。
  const exp = await scopedExportOrFail(exportId, organizationId)
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 64)

  exp.status = 'completed'
  exp.fileHash = hash
  exp.fileSize = Buffer.byteLength(content, 'utf-8')
  exp.mimeType = FORMAT_MIME[exp.format as V2ReportExportFormat] ?? 'text/plain'
  exp.completedAt = DateTime.now()
  await exp.save()

  return exp
}

/**
 * 标记导出失败。
 */
export async function failExport(
  exportId: number,
  errorCategory: string,
  organizationId: number,
): Promise<ReportExport> {
  const exp = await scopedExportOrFail(exportId, organizationId)
  exp.status = 'failed'
  exp.errorCategory = errorCategory
  exp.completedAt = DateTime.now()
  await exp.save()
  return exp
}

/**
 * 渲染导出文件内容。
 */
export function renderDocument(document: ReportDocument, format: V2ReportExportFormat): string {
  switch (format) {
    case 'markdown':
      return renderMarkdown(document)
    case 'csv':
      return renderCsv(document)
    case 'pdf':
      return renderPdf(document)
    case 'xlsx':
      return renderXlsx(document)
  }
}

/**
 * 列出版本的导出记录。
 */
export async function listExportsByVersion(
  versionId: number,
  organizationId: number,
): Promise<ReportExport[]> {
  // v3-multitenant-database-isolation §5.3：列表先 scope 再按版本过滤，
  // 避免仅凭 versionId 列出他租导出记录（文件 hash/大小/路径均为可用信息）。
  return ReportExport.query()
    .where('organization_id', organizationId)
    .where('version_id', versionId)
    .orderBy('created_at', 'desc')
}
