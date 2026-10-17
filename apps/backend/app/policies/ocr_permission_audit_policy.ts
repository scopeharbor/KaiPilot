import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { OCR_PROVIDER_OBSERVABILITY_MANAGE } from '#start/rbac/permissions'

/**
 * OCR 权限与审计 Policy（v3-ocr-permission-and-audit §3.4）。
 *
 * 权限模型（均要求项目成员 + 对应后端权限）：
 * - viewStatus：查看权限状态（ocr_permission_audit:view_status）
 * - sensitiveRead：敏感 OCR 读取（ocr:review）
 * - run：provider 运行（ocr_provider_observability:manage）
 * - confirm：确认/取代（ocr:confirm）
 * - export：复制/导出（ocr_privacy:export）
 * - explain：解释请求（ocr_entity_link:explain）
 * - auditRead：审计摘要读取（ocr_permission_audit:audit_read）
 *
 * READONLY_OBSERVER 仅 viewStatus/auditRead（低敏感）；EXTERNAL_COLLABORATOR
 * 仅 viewStatus（隐藏来源）。跨组织/跨项目越权由 Controller 层二次检查。
 */
export default class OcrPermissionAuditPolicy {
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

  /** 查看权限状态 */
  viewStatus(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr_permission_audit:view_status')
  }

  /** 敏感 OCR 读取 */
  sensitiveRead(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr:review')
  }

  /** provider 运行 */
  run(): boolean {
    return this.isProjectMember() && this.hasPermission(OCR_PROVIDER_OBSERVABILITY_MANAGE)
  }

  /** 确认/取代 */
  confirm(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr:confirm')
  }

  /** 复制/导出 */
  export(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr_privacy:export')
  }

  /** 解释请求 */
  explain(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr_entity_link:explain')
  }

  /** 审计摘要读取 */
  auditRead(): boolean {
    return this.isProjectMember() && this.hasPermission('ocr_permission_audit:audit_read')
  }

  // ─── assert 方法 ──────────────────────────────────────────────────────────

  assertViewStatus(): void {
    if (!this.viewStatus()) {
      throw this.denied('无权查看 OCR 权限状态')
    }
  }

  assertSensitiveRead(): void {
    if (!this.sensitiveRead()) {
      throw this.denied('无权读取敏感 OCR 内容')
    }
  }

  assertRun(): void {
    if (!this.run()) {
      throw this.denied('无权执行 OCR provider 运行')
    }
  }

  assertConfirm(): void {
    if (!this.confirm()) {
      throw this.denied('无权确认 OCR 提取结果')
    }
  }

  assertExport(): void {
    if (!this.export()) {
      throw this.denied('无权执行 OCR 复制/导出')
    }
  }

  assertExplain(): void {
    if (!this.explain()) {
      throw this.denied('无权请求 OCR 解释')
    }
  }

  assertAuditRead(): void {
    if (!this.auditRead()) {
      throw this.denied('无权读取 OCR 审计摘要')
    }
  }

  // ─── 辅助 ──────────────────────────────────────────────────────────────────

  /** 解析对此用户的允许动作（低敏感 UI 层显示用）。 */
  resolveAllowedActions(): string[] {
    const actions: string[] = []
    if (this.viewStatus()) actions.push('view_status')
    if (this.sensitiveRead()) actions.push('view_accepted')
    if (this.run()) actions.push('run_provider')
    if (this.confirm()) actions.push('confirm', 'supersede')
    if (this.export()) actions.push('export_execute')
    if (this.explain()) actions.push('explain')
    if (this.auditRead()) actions.push('view_audit')
    return actions
  }

  private denied(message: string): Error {
    return new PermissionDeniedException(message)
  }
}
