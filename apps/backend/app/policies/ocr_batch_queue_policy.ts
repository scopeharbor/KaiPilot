import type { HttpContext } from '@adonisjs/core/http'
import type { ProjectRoleName as ProjectMemberRoleName } from '#rbac/roles'

/**
 * OCR 批量/队列 Policy：按项目角色 + AI trigger 权限判定 batch/queue 操作。
 *
 * - view：需要 project membership + `file:view`
 * - create：需要 project membership + `file:manage` + `ai:trigger`
 * - manage（retry/cancel/resume）：需要 `file:manage` + `ai:trigger`
 * - inspect-queue：需要 `file:view`
 *
 * 外部协作者若无 AI trigger 权限则只读降级。
 */
export default class OcrBatchQueuePolicy {
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

  /** 查看 batch/queue 列表/详情 */
  view(): boolean {
    return this.isProjectMember() && this.hasPermission('file:view')
  }

  /** 创建 OCR batch */
  create(): boolean {
    return (
      this.isProjectMember() &&
      this.hasPermission('file:manage') &&
      this.hasPermission('ai:trigger')
    )
  }

  /** 管理 batch（retry/cancel/resume） */
  manage(): boolean {
    return this.create()
  }

  /** 重试 batch 或 queue item */
  retry(): boolean {
    return this.manage()
  }

  /** 取消 batch */
  cancel(): boolean {
    return this.manage()
  }

  /** 恢复 paused batch */
  resume(): boolean {
    return this.manage()
  }

  /** 查看 queue 摘要 */
  inspectQueue(): boolean {
    return this.view()
  }

  // ── Assertions ──

  assertView(): void {
    if (!this.view()) {
      throw (globalThis as any).PermissionDeniedException
        ? new (globalThis as any).PermissionDeniedException('无权查看 OCR 批量/队列')
        : new Error('无权查看 OCR 批量/队列')
    }
  }

  assertCreate(): void {
    if (!this.create()) {
      throw (globalThis as any).PermissionDeniedException
        ? new (globalThis as any).PermissionDeniedException('无权创建 OCR 批量操作')
        : new Error('无权创建 OCR 批量操作')
    }
  }

  assertRetry(): void {
    if (!this.retry()) {
      throw (globalThis as any).PermissionDeniedException
        ? new (globalThis as any).PermissionDeniedException('无权重试 OCR 批量/队列')
        : new Error('无权重试 OCR 批量/队列')
    }
  }

  assertCancel(): void {
    if (!this.cancel()) {
      throw (globalThis as any).PermissionDeniedException
        ? new (globalThis as any).PermissionDeniedException('无权取消 OCR 批量操作')
        : new Error('无权取消 OCR 批量操作')
    }
  }

  assertResume(): void {
    if (!this.resume()) {
      throw (globalThis as any).PermissionDeniedException
        ? new (globalThis as any).PermissionDeniedException('无权恢复 OCR 批量操作')
        : new Error('无权恢复 OCR 批量操作')
    }
  }

  assertInspectQueue(): void {
    if (!this.inspectQueue()) {
      throw (globalThis as any).PermissionDeniedException
        ? new (globalThis as any).PermissionDeniedException('无权检查 OCR 队列状态')
        : new Error('无权检查 OCR 队列状态')
    }
  }
}
