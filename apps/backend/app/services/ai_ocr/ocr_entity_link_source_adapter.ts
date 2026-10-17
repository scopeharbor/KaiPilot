import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import type { OcrEntityLinkSourceExtractionRef } from '@aiproj/types'

/**
 * OCR 实体链接来源适配器（v3-ocr-entity-linking §3.2）。
 *
 * 从 OcrReviewAcceptedExtraction 表读取可用于实体链接的已接受提取。
 * 仅返回 status='current'、未超集、同组织/项目且保留生命周期允许的提取。
 *
 * 红/线：永不暴露完整 OCR 文本——仅返回哈希引用。
 */
export default class OcrEntityLinkSourceAdapter {
  /**
   * 获取可用于实体链接的已接受提取列表。
   *
   * @param organizationId 组织隔离
   * @param projectId      项目隔离
   * @param extractionIds  可选，限定提取 ID 列表；不传则返回该组织+项目下的全部可用提取
   * @returns 脱敏的来源提取引用数组
   */
  async getAvailableExtractions(
    organizationId: number,
    projectId: number,
    extractionIds?: number[],
  ): Promise<OcrEntityLinkSourceExtractionRef[]> {
    let query = OcrReviewAcceptedExtraction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('status', 'current')
      .whereNull('superseded_at')
      .orderBy('confirmed_at', 'desc')

    if (extractionIds && extractionIds.length > 0) {
      query = query.whereIn('id', extractionIds)
    }

    const rows = await query

    return rows
      .filter((row) => this.isRetentionAvailable(row.retentionLifecycle))
      .map((row) => ({
        extractionId: row.id,
        sourceHash: row.sourceHash,
        selectedTextHash: row.selectedTextHash,
        pageRefs: row.pageRefsJson,
        status: row.status,
        // luxon toISO() 在 DateTime 非法时返回 null，契约要求必填字符串
        confirmedAt: row.confirmedAt.toISO() ?? '',
      }))
  }

  /**
   * 判断保留生命周期是否允许该提取参与实体链接。
   *
   * null = 未分配保留策略 → 可用
   * 'expired' / 'purge_pending' / 'purged' / 'hold' = 不可用
   * 其余状态（如 'active'、'protected'）默认可用
   */
  private isRetentionAvailable(lifecycle: string | null): boolean {
    if (lifecycle === null) return true
    const blocked: string[] = ['expired', 'purge_pending', 'purged', 'hold']
    return !blocked.includes(lifecycle)
  }

  /**
   * 获取单条已接受提取的 full selectedText。
   * 仅在 rule engine 生成 mention 时使用，不通过公开接口暴露。
   */
  async getExtractionText(
    extractionId: number,
    organizationId: number,
    projectId: number,
  ): Promise<string | null> {
    const row = await OcrReviewAcceptedExtraction.query()
      .where('id', extractionId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!row) return null

    // 保留生命周期检查
    if (!this.isRetentionAvailable(row.retentionLifecycle)) return null

    return row.selectedText
  }
}
