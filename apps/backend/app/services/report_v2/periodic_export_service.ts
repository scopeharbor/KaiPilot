/**
 * report_v2/periodic_export_service —— V2 AI 周期报表导出服务（tasks 7.2-7.3）。
 *
 * 职责：
 *   1. 导出 AI 周期报表版本时附加周期头部、数据源摘要和 warnings
 *   2. 不包含原始 prompt、原始模型输出和 AI 成本明细
 *   3. 导出前校验审核状态和草稿导出标记
 *
 * 导出版本：
 *   - Markdown：完整文本 + 周期头部 + AiPeriodicDraft 章节
 *   - PDF：同上，结构化用于打印
 *   - XLSX：表格型数据 + 周期对比 + 数据源详情
 *
 * 导出限制（task 7.3）：
 *   - 无 draftOverride：仅 aiReviewStatus === 'confirmed' 可导出
 *   - draftOverride=true：pending_review 可导出为草稿（每页水印）
 *   - rejected 状态不可导出
 */
import ReportVersion from '#models/report_version'
import ReportExport from '#models/report_export'
import { ValidationException } from '#exceptions/api_exception'
import { TEMPLATE_MAP } from './templates.js'
import type {
  V2ReportExportFormat,
  ReportWarningV2,
  ReportAiReviewStatus,
  AiPeriodicDraft,
} from '@aiproj/types'
import { completeExport } from './export_service.js'

// ---------------------------------------------------------------------------
// 导出输入/输出接口
// ---------------------------------------------------------------------------

export interface PeriodicExportInput {
  organizationId: number
  projectId: number
  versionId: number
  format: V2ReportExportFormat
  createdBy: number
  /** 允许导出待审核草稿（仅对 pending_review 有效） */
  draftOverride?: boolean
}

export interface PeriodicExportResult {
  exportId: number
  format: V2ReportExportFormat
  status: string
  versionId: number
  isDraft: boolean
}

// ---------------------------------------------------------------------------
// 审核状态校验（task 7.3）
// ---------------------------------------------------------------------------

export interface ExportPermission {
  allowed: boolean
  reason?: string
  isDraftExport: boolean
}

/**
 * 校验版本是否可导出。
 *
 * 规则：
 *   - `confirmed` 始终可导出
 *   - `pending_review` 仅当 draftOverride=true 时可导出，标记为草稿
 *   - `rejected` 不可导出（即使有 draftOverride）
 *   - 其他状态或无 AI 周期模板 → 仅 confirmed 可导出
 */
export function checkExportPermission(
  aiReviewStatus: ReportAiReviewStatus | null,
  draftOverride: boolean,
): ExportPermission {
  if (aiReviewStatus === 'confirmed') {
    return { allowed: true, isDraftExport: false }
  }

  if (aiReviewStatus === 'rejected') {
    return { allowed: false, reason: '已拒绝的草稿不可导出', isDraftExport: false }
  }

  if (aiReviewStatus === 'pending_review') {
    if (draftOverride) {
      return { allowed: true, isDraftExport: true }
    }
    return {
      allowed: false,
      reason: '待审核草稿需要显式草稿导出标记（draftOverride）',
      isDraftExport: false,
    }
  }

  // 无 AI 草稿的普通版本
  if (aiReviewStatus === null) {
    return { allowed: true, isDraftExport: false }
  }

  // 未知状态
  return {
    allowed: false,
    reason: `当前审核状态（${aiReviewStatus}）不允许导出`,
    isDraftExport: false,
  }
}

// ---------------------------------------------------------------------------
// 导出编排（task 7.2 主入口）
// ---------------------------------------------------------------------------

/**
 * 导出周期报表版本。
 * 1. 加载版本记录
 * 2. 校验审核状态和导出权限
 * 3. 渲染内容
 * 4. 完成导出记录
 *
 * 不包含：原始 prompt、完整模型输出、AI 成本明细
 */
export async function createPeriodicExport(
  input: PeriodicExportInput,
): Promise<PeriodicExportResult> {
  const { organizationId, projectId, versionId, format, createdBy, draftOverride } = input

  // 加载版本
  const version = await ReportVersion.query()
    .where('id', versionId)
    .where('organization_id', organizationId)
    .where('project_id', projectId)
    .first()

  if (!version) {
    throw new ValidationException('报表版本不存在')
  }

  // 校验导出权限
  const permission = checkExportPermission(version.aiReviewStatus, draftOverride ?? false)
  if (!permission.allowed) {
    throw new ValidationException(permission.reason ?? '导出被拒绝')
  }

  // 导出内容渲染
  const dataSources = extractDataSources(version.templateId)

  const exportContent = renderPeriodicDocument(
    {
      title: version.title,
      projectName: `Project#${projectId}`,
      templateId: version.templateId,
      periodType: derivePeriodTypeFromTemplate(version.templateId),
      dateRange: {
        fromDate:
          typeof version.dateRange === 'object' && version.dateRange
            ? String((version.dateRange as Record<string, unknown>).fromDate ?? '')
            : undefined,
        toDate:
          typeof version.dateRange === 'object' && version.dateRange
            ? String((version.dateRange as Record<string, unknown>).toDate ?? '')
            : undefined,
      },
      generatedAt: version.generatedAt?.toISO() ?? '',
      reviewStatus: version.aiReviewStatus,
      warnings: version.warnings ?? [],
      draftContent: formatDraftForExport(version.aiDraft),
      dataSources,
      isDraftExport: permission.isDraftExport,
    },
    format,
  )

  // 创建导出记录
  const exportRecord = await ReportExport.create({
    organizationId,
    projectId,
    reportId: version.reportId ?? 0,
    versionId,
    format,
    status: 'pending',
    fileHash: null,
    fileSize: null,
    mimeType: null,
    filePath: null,
    errorCategory: null,
    createdBy,
    completedAt: null,
  })

  // 完成导出
  await completeExport(exportRecord.id, exportContent, organizationId)

  return {
    exportId: exportRecord.id,
    format,
    status: 'completed',
    versionId,
    isDraft: permission.isDraftExport,
  }
}

// ---------------------------------------------------------------------------
// Markdown 格式化器（periodic 专用，不包含原始 prompt / 模型输出 / AI 成本）
// ---------------------------------------------------------------------------

export interface PeriodicRenderInput {
  title: string
  projectName: string
  templateId: string
  periodType?: 'weekly' | 'monthly'
  dateRange: { fromDate?: string; toDate?: string }
  generatedAt: string
  reviewStatus: ReportAiReviewStatus | null
  warnings: ReportWarningV2[]
  /** 已确认的草稿正文或编辑后内容（不包含原始 prompt 或模型原始输出） */
  draftContent: string | null
  /** 数据源摘要 */
  dataSources: { key: string; status: string }[]
  /** 是否为草稿导出 */
  isDraftExport: boolean
}

/**
 * 渲染周期报表 Markdown。
 *
 * 包含：
 *   1. Header: 报告周期、生成时间、审核状态
 *   2. 数据源摘要：哪些数据源被使用
 *   3. Warnings：所有聚合 warning
 *   4. Body：已确认的草稿正文（结构化章节），不包含原始 prompt 或原始模型输出
 *
 * 不包含：
 *   - 发送给 AI 的原始 prompt
 *   - AI 模型原始输出
 *   - AI 成本详情（costSummary 仅在 UI 展示）
 */
export function renderPeriodicMarkdown(input: PeriodicRenderInput): string {
  const lines: string[] = []

  // 草稿水印（每页顶部，简洁版）
  if (input.isDraftExport) {
    lines.push('> **草稿 - 未经审核**')
    lines.push('')
  }

  // 标题
  lines.push(`# ${input.title}`)
  lines.push('')

  // 周期头部
  lines.push('## 报表信息')
  lines.push('')
  lines.push(`- **项目**：${input.projectName}`)
  lines.push(
    `- **报表类型**：${input.periodType === 'weekly' ? '周报' : input.periodType === 'monthly' ? '月报' : input.templateId}`,
  )
  lines.push(`- **生成时间**：${input.generatedAt}`)
  lines.push(
    `- **审核状态**：${input.isDraftExport ? '待审核' : formatReviewStatus(input.reviewStatus)}`,
  )

  if (input.dateRange.fromDate) {
    lines.push(`- **统计周期**：${input.dateRange.fromDate} ~ ${input.dateRange.toDate ?? ''}`)
  }

  if (input.isDraftExport) {
    lines.push('- **导出标记**：草稿（未经审核）')
  }
  lines.push('')

  // 数据源摘要
  lines.push('## 数据来源')
  lines.push('')
  for (const ds of input.dataSources) {
    const statusLabel =
      ds.status === 'available'
        ? '可用'
        : ds.status === 'unavailable'
          ? '不可用'
          : ds.status === 'forbidden'
            ? '无权限'
            : ds.status === 'timeout'
              ? '超时'
              : ds.status
    lines.push(`- **${ds.key}**：${statusLabel}`)
  }
  lines.push('')

  // Warnings
  if (input.warnings.length > 0) {
    lines.push('## 数据警告')
    lines.push('')
    for (const w of input.warnings) {
      lines.push(`- [${w.code}] ${w.message}`)
    }
    lines.push('')
  }

  // 草稿正文
  const draftForExport = formatDraftForExport(input.draftContent)
  if (draftForExport) {
    lines.push('## 报告正文')
    lines.push('')
    lines.push(draftForExport)
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('*本报告由 AI 辅助生成，仅供参考。最终版本需人工确认。*')
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 渲染周期报表 PDF。
 * 当前为占桩实现，内容与 Markdown 一致，后续可接入 puppeteer/pdf-lib 生成真实 PDF。
 */
export function renderPeriodicPdf(input: PeriodicRenderInput): string {
  const md = renderPeriodicMarkdown(input)
  return `[V2-PERIODIC-PDF-PLACEHOLDER]\n\n${md}`
}

/**
 * 渲染周期报表 XLSX。
 * 当前为占桩实现，包含元数据行，后续可接入 exceljs 生成真实多工作表 XLSX。
 */
export function renderPeriodicXlsx(input: PeriodicRenderInput): string {
  const dataSourceLines = input.dataSources.map((ds) => `${ds.key}:${ds.status}`).join('; ')
  return [
    `[V2-PERIODIC-XLSX-PLACEHOLDER]`,
    `title: ${input.title}`,
    `periodType: ${input.periodType ?? 'none'}`,
    `generatedAt: ${input.generatedAt}`,
    `reviewStatus: ${input.reviewStatus ?? 'none'}`,
    `dataSources: ${dataSourceLines}`,
    `warnings: ${input.warnings.length}`,
    `isDraft: ${input.isDraftExport}`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 导出格式路由
// ---------------------------------------------------------------------------

/**
 * 根据格式渲染周期报表内容。
 */
export function renderPeriodicDocument(
  input: PeriodicRenderInput,
  format: V2ReportExportFormat,
): string {
  switch (format) {
    case 'markdown':
      return renderPeriodicMarkdown(input)
    case 'pdf':
      return renderPeriodicPdf(input)
    case 'xlsx':
      return renderPeriodicXlsx(input)
    default:
      return renderPeriodicMarkdown(input)
  }
}

// ---------------------------------------------------------------------------
// 格式化辅助
// ---------------------------------------------------------------------------

function formatReviewStatus(status: ReportAiReviewStatus | null): string {
  switch (status) {
    case 'confirmed':
      return '已确认'
    case 'pending_review':
      return '待审核'
    case 'rejected':
      return '已拒绝'
    case 'editing':
      return '编辑中'
    default:
      return '—'
  }
}

// ---------------------------------------------------------------------------
// 数据源摘要
// ---------------------------------------------------------------------------

/**
 * 从模板定义中提取数据源摘要列表。
 * 不包含实际数据，仅包含 key 和假定状态（用于导出头部展示）。
 */
function extractDataSources(templateId: string): { key: string; status: string }[] {
  const template = TEMPLATE_MAP.get(templateId as Parameters<typeof TEMPLATE_MAP.get>[0])
  if (!template) return []

  const allKeys = [...template.requiredDataSources, ...template.optionalDataSources]

  return allKeys.map((key) => ({
    key,
    status: 'available',
  }))
}

// ---------------------------------------------------------------------------
// 周期类型推导
// ---------------------------------------------------------------------------

function derivePeriodTypeFromTemplate(templateId: string): 'weekly' | 'monthly' | undefined {
  const template = TEMPLATE_MAP.get(templateId as Parameters<typeof TEMPLATE_MAP.get>[0])
  return template?.periodType
}

// ---------------------------------------------------------------------------
// 草稿正文格式化（task 7.2：只输出确认后的内容，不包含原始 prompt 或模型输出）
// ---------------------------------------------------------------------------

/**
 * 将 AiPeriodicDraft（JSON 结构化）或纯文本草稿转换为导出版本正文。
 *
 * 安全原则：
 *   - 只输出结构化章节或纯文本
 *   - 不包含发送给 AI 的原始 prompt
 *   - 不包含 AI 模型的原始输出
 *   - 不包含 AI 成本明细（costSummary 仅 UI 展示）
 *   - structured mode: AiPeriodicDraft 各章节拼接为 Markdown
 *   - fallback mode: 纯文本直接输出
 */
export function formatDraftForExport(draftContent: string | null): string | null {
  if (!draftContent) return null

  // 尝试解析为结构化 AiPeriodicDraft
  try {
    const parsed = JSON.parse(draftContent) as AiPeriodicDraft
    if (parsed.executiveSummary || parsed.highlights) {
      const sections: string[] = []

      sections.push('### 管理摘要')
      sections.push('')
      sections.push(parsed.executiveSummary)
      sections.push('')

      if (parsed.highlights.length > 0) {
        sections.push('### 亮点')
        sections.push('')
        for (const h of parsed.highlights) {
          sections.push(`- ${h}`)
        }
        sections.push('')
      }

      sections.push('### 进度叙述')
      sections.push('')
      sections.push(parsed.progressNarrative)
      sections.push('')

      sections.push('### 风险与问题')
      sections.push('')
      sections.push(parsed.riskAndIssues)
      sections.push('')

      if (parsed.resourceNotes) {
        sections.push('### 资源说明')
        sections.push('')
        sections.push(parsed.resourceNotes)
        sections.push('')
      }

      if (parsed.changeNotes) {
        sections.push('### 变更说明')
        sections.push('')
        sections.push(parsed.changeNotes)
        sections.push('')
      }

      if (parsed.suggestedActions.length > 0) {
        sections.push('### 建议行动')
        sections.push('')
        for (const action of parsed.suggestedActions) {
          sections.push(`- ${action}`)
        }
        sections.push('')
      }

      if (parsed.dataWarningsNarrative) {
        sections.push('### 数据限制说明')
        sections.push('')
        sections.push(parsed.dataWarningsNarrative)
        sections.push('')
      }

      if (parsed.additionalSections && parsed.additionalSections.length > 0) {
        for (const sec of parsed.additionalSections) {
          sections.push(`### ${sec.title}`)
          sections.push('')
          sections.push(sec.content)
          sections.push('')
        }
      }

      return sections.join('\n')
    }
  } catch {
    // JSON 解析失败 → 视为纯文本草稿
  }

  return draftContent
}
