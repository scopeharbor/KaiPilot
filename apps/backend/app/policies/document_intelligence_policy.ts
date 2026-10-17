import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type { WorkbenchAccessDecisions } from '#services/document_intelligence/workbench_service'

/**
 * DocumentIntelligencePolicy —— 文档智能工作台权限守卫。
 *
 * 分层：
 * 1. 项目准入：复用 OCR/文件同款语义——项目成员 + `file:view` 才可读工作台；
 *    非成员 / 跨租由上游组织上下文与项目归属校验统一返回 RESOURCE_NOT_FOUND /
 *    PERMISSION_DENIED，不泄露来源存在性。
 * 2. 字段级裁决：owning 写入面板入口需 `file:manage`；审计明细需要既有
 *    `ocr_permission_audit:audit_read`——不足者治理视图降级为 restricted，而非整页拒绝。
 */
export default class DocumentIntelligencePolicy {
  #ctx: HttpContext

  constructor(ctx: HttpContext) {
    this.#ctx = ctx
  }

  private get member(): { role: string } | null {
    return this.#ctx.projectMember ?? null
  }

  private hasPermission(perm: string): boolean {
    return this.#ctx.rbac?.hasPermission(perm) ?? false
  }

  /** 查看工作台列表/详情 */
  view(): boolean {
    return this.member !== null && this.hasPermission('file:view')
  }

  assertView(): void {
    if (!this.view()) {
      throw new PermissionDeniedException('无权查看文档智能工作台')
    }
  }

  /** 服务端字段级访问裁决（client 声明不可覆盖） */
  resolveAccess(): WorkbenchAccessDecisions {
    const canManageFiles = this.member !== null && this.hasPermission('file:manage')
    const canReadAudit =
      this.member !== null && this.hasPermission('ocr_permission_audit:audit_read')
    return {
      readOnly: !canManageFiles,
      canManageFiles,
      canReadAudit,
    }
  }
}
