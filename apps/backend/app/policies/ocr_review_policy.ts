import RbacService from '#services/rbac_service'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import { inject } from '@adonisjs/core'

/**
 * OCR 审查策略（v3-ocr-review-confirmation-flow §4.2）。
 *
 * ocr:review = 查看 OCR 候选和已接受提取（等价于 file:view）
 * ocr:confirm = 确认/超集 OCR 提取（等价于 file:manage + ai:confirm）
 */
@inject()
export default class OcrReviewPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const ocrReview = await this.rbac.check(user, 'ocr:review', organizationId, projectId)
    if (ocrReview.allowed) return true
    const fileView = await this.rbac.check(user, 'file:view', organizationId, projectId)
    return fileView.allowed
  }

  async confirm(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const result = await this.rbac.check(user, 'ocr:confirm', organizationId, projectId)
    return result.allowed
  }

  async assertView(user: User, organizationId: number, projectId?: number): Promise<void> {
    const allowed = await this.view(user, organizationId, projectId)
    if (!allowed) {
      throw new PermissionDeniedException('无权查看 OCR 审查数据')
    }
  }

  async assertConfirm(user: User, organizationId: number, projectId?: number): Promise<void> {
    const allowed = await this.confirm(user, organizationId, projectId)
    if (!allowed) {
      throw new PermissionDeniedException('无权确认 OCR 提取')
    }
  }
}
