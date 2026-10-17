import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'

/**
 * OCR 隐私策略控制 Policy（v3-ocr-privacy-policy-controls §3.8）。
 *
 * 权限模型：
 * - view：读取隐私策略与状态（ocr_privacy:view + 项目成员）
 * - manage：更新项目/组织级隐私策略覆盖（ocr_privacy:manage + 项目成员）
 * - copy：预览/执行 OCR 复制（ocr_privacy:copy + 项目成员）
 * - export：预览/执行 OCR 导出（ocr_privacy:export + 项目成员）
 * - auditStatus：查看隐私审计状态（ocr_privacy:audit_status + 项目成员）
 *
 * READONLY_OBSERVER 只能 view/auditStatus，不含 copy/export。
 * 跨组织/跨项目越权操作由 Controller 层二次检查（orgIdOf/projectIdOf）。
 */
export default class OcrPrivacyPolicy {
  #ctx: HttpContext

  constructor(ctx: HttpContext) {
    this.#ctx = ctx
  }

  private get member(): { role: string } | null {
    return (this.#ctx as any).projectMember ?? null
  }

  private hasPermission(perm: string): boolean {
    return this.#ctx.rbac?.hasPermission(perm) ?? false
  }

  private isProjectMember(): boolean {
    return this.member !== null
  }

  /** 读取隐私策略与状态 */
  view(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr_privacy:view')
  }

  /** 管理隐私策略覆盖 */
  manage(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr_privacy:manage')
  }

  /** 预览/执行复制 */
  copy(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr_privacy:copy')
  }

  /** 预览/执行导出 */
  export(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr_privacy:export')
  }

  /** 查看审计状态 */
  auditStatus(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr_privacy:audit_status')
  }

  // ─── assert 方法 ──────────────────────────────────────────────────────────

  assertView(): void {
    if (!this.view()) {
      throw this.denied('无权查看 OCR 隐私策略或状态')
    }
  }

  assertManage(): void {
    if (!this.manage()) {
      throw this.denied('无权管理 OCR 隐私策略')
    }
  }

  assertCopy(): void {
    if (!this.copy()) {
      throw this.denied('无权执行 OCR 复制')
    }
  }

  assertExport(): void {
    if (!this.export()) {
      throw this.denied('无权执行 OCR 导出')
    }
  }

  assertAuditStatus(): void {
    if (!this.auditStatus()) {
      throw this.denied('无权查看 OCR 隐私审计状态')
    }
  }

  // ─── 辅助 ──────────────────────────────────────────────────────────────────

  /** 解析对此用户的允许动作 */
  resolveAllowedActions(): string[] {
    const actions: string[] = []
    if (this.view()) actions.push('view_status', 'view_policy', 'view_audit')
    if (this.manage()) actions.push('update_policy')
    if (this.copy()) actions.push('preview_export') // copy 走 export preview 管道
    if (this.export()) actions.push('preview_export', 'execute_export')
    return actions
  }

  private denied(message: string): Error {
    return new PermissionDeniedException(message)
  }
}
