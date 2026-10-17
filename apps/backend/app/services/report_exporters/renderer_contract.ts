import type { ReportSnapshot, ReportExportFormat } from '@aiproj/types'

/**
 * ReportRenderer —— 快照 → 导出文件的纯函数式渲染器合约（design D5）。
 *
 * 每个渲染器：
 *   - 只读快照，不做二次 DB 查询；
 *   - 输出 UTF-8 字节 + 建议的 MIME + 建议的文件后缀名；
 *   - 不负责落盘，落盘和权限由 ReportExportService 兜底。
 */
export interface RenderedReport {
  format: ReportExportFormat
  mimeType: string
  extension: 'md' | 'csv'
  /** UTF-8 编码字节流 */
  content: Buffer
}

export interface ReportRenderer {
  readonly format: ReportExportFormat
  render(snapshot: ReportSnapshot, reportMeta: RenderReportMeta): RenderedReport
}

/**
 * 渲染时的补充元数据：由 Service 从 Report 记录传入，用于填 header/水印。
 */
export interface RenderReportMeta {
  reportId: number
  title: string
  projectName: string
  generatedAt: string
  generatedByName?: string | null
}
