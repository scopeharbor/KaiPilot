import type { HttpContext } from '@adonisjs/core/http'
import type { ProjectRoleName as ProjectMemberRoleName } from '#rbac/roles'

/**
 * OCR 文档作业 Policy：按项目角色 + AI trigger 权限判定 read/run/retry/confirm。
 *
 * - view/read：需要 project membership + `file:view`
 * - run (create/retry)：需要 `file:manage` + AI trigger（通过 `ai:trigger` 权限）
 * - confirm：需要 `file:manage` + AI trigger
 *
 * 外部协作者若无 AI trigger 权限，只读降级；跨项目源文件返回 RESOURCE_NOT_FOUND/PERMISSION_DENIED。
 */
export default class OcrDocumentPolicy {
  #ctx: HttpContext

  constructor(ctx: HttpContext) {
    this.#ctx = ctx
  }

  private get member(): { role: ProjectMemberRoleName } | null {
    return (this.#ctx as any).projectMember ?? null
  }

  private hasPermission(perm: string): boolean {
    return this.#ctx.rbac?.hasPermission(perm) ?? false
  }

  private isProjectMember(): boolean {
    return this.member !== null
  }

  /** 查看 OCR 作业列表/详情/候选 */
  view(): boolean {
    return this.isProjectMember() && this.hasPermission('file:view')
  }

  /** 创建 OCR 作业（含上传） */
  run(): boolean {
    return (
      this.isProjectMember() &&
      this.hasPermission('file:manage') &&
      this.hasPermission('ai:trigger')
    )
  }

  /** 重试 OCR 作业 */
  retry(): boolean {
    return this.run()
  }

  /** 确认 OCR 候选文本 */
  confirm(): boolean {
    return this.run()
  }

  /** 断言查看 */
  assertView(): void {
    if (!this.view()) {
      throw (globalThis as any).PermissionDeniedException
        ? new (globalThis as any).PermissionDeniedException('无权查看 OCR 文档作业')
        : new Error('无权查看 OCR 文档作业')
    }
  }

  /** 断言运行 */
  assertRun(): void {
    if (!this.run()) {
      throw (globalThis as any).PermissionDeniedException
        ? new (globalThis as any).PermissionDeniedException('无权创建或运行 OCR 文档作业')
        : new Error('无权创建或运行 OCR 文档作业')
    }
  }

  /** 断言确认 */
  assertConfirm(): void {
    if (!this.confirm()) {
      throw (globalThis as any).PermissionDeniedException
        ? new (globalThis as any).PermissionDeniedException('无权确认 OCR 提取结果')
        : new Error('无权确认 OCR 提取结果')
    }
  }
}
