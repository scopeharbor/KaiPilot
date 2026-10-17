import type { HttpContext } from '@adonisjs/core/http'

/**
 * OCR 文档搜索索引 Policy（v3-ocr-document-search-indexing §4.2）。
 *
 * 权限模型：
 * - view：读取索引状态/列表（项目成员 + ocr:review 或 file:view）
 * - preview：预览索引计划（项目成员 + file:manage 或 ocr:confirm）
 * - execute：执行索引/重新索引/取消索引（项目成员 + file:manage 或 ocr:confirm）
 * - reindex：重新索引（项目成员 + file:manage 或 ocr:confirm）
 * - unindex：取消索引（项目成员 + file:manage 或 ocr:confirm）
 *
 * read-only 降级：无 view 权限返回 null；越权操作抛出 PermissionDeniedException。
 * 跨组织/跨项目越权操作由 Controller 层二次检查。
 */
export default class OcrDocumentSearchIndexPolicy {
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

  /** 查看索引状态：需要 ocr_search_index:view 或 ocr:review */
  view(): boolean {
    if (!this.isProjectMember()) return false
    return this.hasPermission('ocr_search_index:view') || this.hasPermission('ocr:review')
  }

  /** 预览索引计划：需要 ocr_search_index:manage 或 file:manage */
  preview(): boolean {
    if (!this.isProjectMember()) return false
    return this.hasPermission('ocr_search_index:manage') || this.hasPermission('file:manage')
  }

  /** 执行索引：需要 ocr_search_index:manage 或 file:manage */
  execute(): boolean {
    if (!this.isProjectMember()) return false
    return this.hasPermission('ocr_search_index:manage') || this.hasPermission('file:manage')
  }

  /** 重新索引：需要 ocr_search_index:manage 或 file:manage */
  reindex(): boolean {
    return this.execute()
  }

  /** 取消索引：需要 ocr_search_index:manage 或 file:manage */
  unindex(): boolean {
    return this.execute()
  }

  /** 断言查看 */
  assertView(): void {
    if (!this.view()) {
      throw this.denied('无权查看 OCR 搜索索引状态')
    }
  }

  /** 断言预览 */
  assertPreview(): void {
    if (!this.preview()) {
      throw this.denied('无权预览 OCR 搜索索引计划')
    }
  }

  /** 断言执行 */
  assertExecute(): void {
    if (!this.execute()) {
      throw this.denied('无权执行 OCR 搜索索引操作')
    }
  }

  /** 断言重新索引 */
  assertReindex(): void {
    if (!this.reindex()) {
      throw this.denied('无权重新索引 OCR 搜索条目')
    }
  }

  /** 断言取消索引 */
  assertUnindex(): void {
    if (!this.unindex()) {
      throw this.denied('无权取消索引 OCR 搜索条目')
    }
  }

  private denied(message: string): Error {
    const { PermissionDeniedException } = require('#exceptions/api_exception')
    return new PermissionDeniedException(message)
  }
}
