import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'

/**
 * OCR 结构化提取 Policy（v3-ocr-structured-extraction §4.2）。
 *
 * 权限模型：
 * - view：读取提取配置/运行/候选/快照（项目成员 + ocr_structured_extraction:view 或 ocr:review）
 * - manage：管理提取配置（创建/更新/归档）（项目成员 + ocr_structured_extraction:manage 或 file:manage）
 * - run：创建提取运行（项目成员 + ocr_structured_extraction:run 或 ocr:review）
 * - confirm：确认提取结果（预览/保存/覆盖）（项目成员 + ocr_structured_extraction:confirm 或 file:manage）
 *
 * read-only 降级：无 view 权限返回 null；越权操作抛出 PermissionDeniedException。
 * 跨组织/跨项目越权操作由 Controller 层二次检查。
 */
export default class OcrStructuredExtractionPolicy {
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

  /** 查看提取配置/运行/候选/快照：需要 ocr_structured_extraction:view 或 ocr:review */
  view(): boolean {
    if (!this.isProjectMember()) return false
    return this.hasPermission('ocr_structured_extraction:view') || this.hasPermission('ocr:review')
  }

  /** 管理提取配置（创建/更新/归档）：需要 ocr_structured_extraction:manage 或 file:manage */
  manage(): boolean {
    if (!this.isProjectMember()) return false
    return (
      this.hasPermission('ocr_structured_extraction:manage') || this.hasPermission('file:manage')
    )
  }

  /** 创建提取运行：需要 ocr_structured_extraction:run 或 ocr:review */
  run(): boolean {
    if (!this.isProjectMember()) return false
    return this.hasPermission('ocr_structured_extraction:run') || this.hasPermission('ocr:review')
  }

  /** 确认提取结果（预览/保存/覆盖）：需要 ocr_structured_extraction:confirm 或 file:manage */
  confirm(): boolean {
    if (!this.isProjectMember()) return false
    return (
      this.hasPermission('ocr_structured_extraction:confirm') || this.hasPermission('file:manage')
    )
  }

  /** 断言查看 */
  assertView(): void {
    if (!this.view()) {
      throw this.denied('无权查看 OCR 结构化提取配置')
    }
  }

  /** 断言管理 */
  assertManage(): void {
    if (!this.manage()) {
      throw this.denied('无权管理 OCR 结构化提取配置')
    }
  }

  /** 断言运行 */
  assertRun(): void {
    if (!this.run()) {
      throw this.denied('无权执行 OCR 结构化提取运行')
    }
  }

  /** 断言确认 */
  assertConfirm(): void {
    if (!this.confirm()) {
      throw this.denied('无权确认 OCR 结构化提取结果')
    }
  }

  private denied(message: string): Error {
    return new PermissionDeniedException(message)
  }
}
