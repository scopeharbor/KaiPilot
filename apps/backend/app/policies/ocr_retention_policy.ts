import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'

/**
 * OCR 保留治理 Policy（v3-ocr-result-persistence-and-retention §3.7）。
 *
 * 权限模型（判定链复用 RbacService，与 rbac_middleware 同一条，超管放行在其内部处理）：
 * - view：读取保留状态/策略/状态（ocr_retention:view，或 file:view 兜底）
 * - manage：更新保留策略、预览 cleanup、执行 cleanup（ocr_retention:manage，或 file:manage 兜底）
 * - hold：设置/释放 hold（ocr_retention:hold，或 file:manage 兜底）
 *
 * 越权操作抛出 PermissionDeniedException；跨组织/跨项目越权由 Controller 层二次隔离。
 */
@inject()
export default class OcrRetentionPolicy {
  constructor(private rbac: RbacService) {}

  /** 查看保留状态/策略：ocr_retention:view 或 file:view。 */
  async view(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const r = await this.rbac.check(user, 'ocr_retention:view', organizationId, projectId)
    if (r.allowed) return true
    const fv = await this.rbac.check(user, 'file:view', organizationId, projectId)
    return fv.allowed
  }

  /** 管理保留策略/执行 cleanup：ocr_retention:manage 或 file:manage。 */
  async manage(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const r = await this.rbac.check(user, 'ocr_retention:manage', organizationId, projectId)
    if (r.allowed) return true
    const fm = await this.rbac.check(user, 'file:manage', organizationId, projectId)
    return fm.allowed
  }

  /** 设置/释放 hold：ocr_retention:hold 或 file:manage。 */
  async hold(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const r = await this.rbac.check(user, 'ocr_retention:hold', organizationId, projectId)
    if (r.allowed) return true
    const fm = await this.rbac.check(user, 'file:manage', organizationId, projectId)
    return fm.allowed
  }

  /** 断言查看 */
  async assertView(user: User, organizationId: number, projectId?: number): Promise<void> {
    if (!(await this.view(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看 OCR 保留治理信息')
    }
  }

  /** 断言管理 */
  async assertManage(user: User, organizationId: number, projectId?: number): Promise<void> {
    if (!(await this.manage(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权管理 OCR 保留策略或执行清理')
    }
  }

  /** 断言 hold */
  async assertHold(user: User, organizationId: number, projectId?: number): Promise<void> {
    if (!(await this.hold(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权设置或释放 OCR 保留 hold')
    }
  }
}
