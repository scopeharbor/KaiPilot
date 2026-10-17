import Attachment from '#models/attachment'
import AuditService, { AuditEvent } from '#services/audit_service'
import TrashService from '#services/file_v2/trash_service'
import FileTagService from '#services/file_v2/file_tag_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import DatabaseTenantBoundary from '#services/database_tenant_boundary'
import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'

/**
 * 批量操作结果类型。
 */
export interface BatchItemResult {
  fileType: string
  fileId: number
  success: boolean
  error?: string
}

export interface BatchResult {
  success: BatchItemResult[]
  failed: BatchItemResult[]
}

export interface BatchOperationItem {
  fileType: string
  fileId: number
}

/**
 * 文件批量操作服务（V2 D6）。
 * 支持批量删除、恢复、永久删除、标签分配、移动。
 * 所有操作先执行 preflight 权限/存在性检查，再逐项执行。
 */
@inject()
export default class FileBatchService {
  /** 数据库层租户边界（v3-multitenant-database-isolation §6.1），无状态、无 DI 依赖。 */
  private boundary = new DatabaseTenantBoundary()

  constructor(
    private audit: AuditService,
    private trashService: TrashService,
    private fileTagService: FileTagService,
  ) {}

  /**
   * 单租户批量校验（v3-multitenant-database-isolation §6.1）。
   *
   * spec「Batch database operations MUST reject mixed-tenant inputs」要求：
   * 在**任何行变更、预览、导出句柄或作业记录产生之前**，把整批 ID 放进同一个
   * 有效租户 scope 里解析，数量不符即整批拒绝；且响应不得指明是哪个 ID 属于他租。
   *
   * 因此这里：
   * - 先确认 projectId 本身属于当前组织（原实现只按 project_id 过滤，组织层完全
   *   依赖 Controller 的 Policy）；
   * - 再按文件类型分组，经 catalog 父级链（attachments/documents → projects.organization_id）
   *   一次性解析全部 ID；
   * - 跨租 ID 与不存在 ID 走同一条 `RESOURCE_NOT_FOUND`，错误消息不含 ID、类型或计数。
   */
  async assertSingleTenantBatch(
    items: BatchOperationItem[],
    projectId: number,
    organizationId: number,
  ): Promise<void> {
    if (items.length === 0) {
      throw new ValidationException('批量操作列表为空')
    }

    await this.boundary.assertIdsInTenant('projects', [projectId], { organizationId })

    const byType = new Map<string, number[]>()
    for (const item of items) {
      const bucket = byType.get(item.fileType) ?? []
      bucket.push(item.fileId)
      byType.set(item.fileType, bucket)
    }

    const tableOf: Record<string, string> = {
      attachment: 'attachments',
      document: 'documents',
    }
    for (const [fileType, ids] of byType) {
      const table = tableOf[fileType]
      if (!table) {
        throw new ValidationException('批量操作包含不支持的文件类型')
      }
      const scoped = await this.boundary.assertIdsInTenant(table, ids, { organizationId })
      // 同租户但不属于该项目的 ID 同样整批拒绝（不区分原因，避免侧信道）
      const inProject = await this.boundary
        .scopedQuery(db.from(table), table, { organizationId }, 'batch')
        .where('project_id', projectId)
        .whereIn('id', scoped)
        .select('id')
      if (inProject.length !== scoped.length) {
        throw new ResourceNotFoundException('资源不存在')
      }
    }
  }

  /**
   * Preflight 检查：校验所有项目存在性、项目归属和权限。
   * 任何一项不通过即整批拒绝。
   */
  async preflightCheck(
    items: BatchOperationItem[],
    projectId: number,
    organizationId: number,
    permissionFn?: () => Promise<void>,
  ): Promise<void> {
    // 权限检查
    if (permissionFn) {
      await permissionFn()
    }

    // 单租户批量校验（含空列表判定）
    // 原实现逐项抛 `文件不存在或不属于该项目: attachment:123`，错误消息直接点名 ID，
    // 违反 spec「MUST NOT identify which ID belonged to another tenant」。
    await this.assertSingleTenantBatch(items, projectId, organizationId)
  }

  /**
   * 批量软删除（移到回收站）。
   */
  async batchDelete(
    items: BatchOperationItem[],
    projectId: number,
    userId: number,
    organizationId: number,
    requestId?: string | null,
  ): Promise<BatchResult> {
    // v3-multitenant-database-isolation §6.1：整批必须先落在同一有效租户 scope 内，
    // 混租或跨项目输入在任何行变更之前整体拒绝（不指明是哪个 ID 越界）。
    await this.assertSingleTenantBatch(items, projectId, organizationId)

    const result: BatchResult = { success: [], failed: [] }

    for (const item of items) {
      try {
        if (item.fileType === 'attachment') {
          await this.trashService.trash(
            item.fileId,
            projectId,
            userId,
            organizationId,
            '批量删除',
            requestId,
          )
        }
        result.success.push({ fileType: item.fileType, fileId: item.fileId, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        result.failed.push({
          fileType: item.fileType,
          fileId: item.fileId,
          success: false,
          error: message,
        })
      }
    }

    // 审计：批量删除
    await this.audit.log({
      event: AuditEvent.FILE_BATCH_DELETED,
      userId,
      organizationId,
      projectId,
      entityType: 'batch',
      requestId,
      metadata: {
        total: items.length,
        successCount: result.success.length,
        failedCount: result.failed.length,
        failedItems: result.failed.map((f) => `${f.fileType}:${f.fileId}`),
      },
    })

    return result
  }

  /**
   * 批量从回收站恢复。
   */
  async batchRestore(
    items: BatchOperationItem[],
    projectId: number,
    userId: number,
    organizationId: number,
    requestId?: string | null,
  ): Promise<BatchResult> {
    // v3-multitenant-database-isolation §6.1：整批必须先落在同一有效租户 scope 内，
    // 混租或跨项目输入在任何行变更之前整体拒绝（不指明是哪个 ID 越界）。
    await this.assertSingleTenantBatch(items, projectId, organizationId)

    const result: BatchResult = { success: [], failed: [] }

    for (const item of items) {
      try {
        if (item.fileType === 'attachment') {
          await this.trashService.restore(item.fileId, projectId, userId, organizationId, requestId)
        }
        result.success.push({ fileType: item.fileType, fileId: item.fileId, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        result.failed.push({
          fileType: item.fileType,
          fileId: item.fileId,
          success: false,
          error: message,
        })
      }
    }

    // 审计：批量恢复
    await this.audit.log({
      event: AuditEvent.FILE_BATCH_RESTORED,
      userId,
      organizationId,
      projectId,
      entityType: 'batch',
      requestId,
      metadata: {
        total: items.length,
        successCount: result.success.length,
        failedCount: result.failed.length,
      },
    })

    return result
  }

  /**
   * 批量永久删除（物理删除 + 数据库记录删除）。
   * 需要 file:manage 权限。
   */
  async batchPermanentDelete(
    items: BatchOperationItem[],
    projectId: number,
    userId: number,
    organizationId: number,
    requestId?: string | null,
  ): Promise<BatchResult> {
    // v3-multitenant-database-isolation §6.1：整批必须先落在同一有效租户 scope 内，
    // 混租或跨项目输入在任何行变更之前整体拒绝（不指明是哪个 ID 越界）。
    await this.assertSingleTenantBatch(items, projectId, organizationId)

    const result: BatchResult = { success: [], failed: [] }

    for (const item of items) {
      try {
        if (item.fileType === 'attachment') {
          await this.trashService.permanentDelete(
            item.fileId,
            projectId,
            userId,
            organizationId,
            requestId,
          )
        }
        result.success.push({ fileType: item.fileType, fileId: item.fileId, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        result.failed.push({
          fileType: item.fileType,
          fileId: item.fileId,
          success: false,
          error: message,
        })
      }
    }

    // 审计：批量永久删除
    await this.audit.log({
      event: AuditEvent.FILE_BATCH_PERMANENT_DELETED,
      userId,
      organizationId,
      projectId,
      entityType: 'batch',
      requestId,
      metadata: {
        total: items.length,
        successCount: result.success.length,
        failedCount: result.failed.length,
      },
    })

    return result
  }

  /**
   * 批量分配标签。
   */
  async batchTag(
    items: BatchOperationItem[],
    projectId: number,
    tagIds: number[],
    userId: number,
    organizationId: number,
    requestId?: string | null,
  ): Promise<BatchResult> {
    // v3-multitenant-database-isolation §6.1：整批必须先落在同一有效租户 scope 内，
    // 混租或跨项目输入在任何行变更之前整体拒绝（不指明是哪个 ID 越界）。
    await this.assertSingleTenantBatch(items, projectId, organizationId)

    const result: BatchResult = { success: [], failed: [] }

    for (const item of items) {
      try {
        await this.fileTagService.assignTags(projectId, item.fileType, item.fileId, tagIds, userId)
        result.success.push({ fileType: item.fileType, fileId: item.fileId, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        result.failed.push({
          fileType: item.fileType,
          fileId: item.fileId,
          success: false,
          error: message,
        })
      }
    }

    // 审计：批量标签
    await this.audit.log({
      event: AuditEvent.FILE_BATCH_TAGGED,
      userId,
      organizationId,
      projectId,
      entityType: 'batch',
      requestId,
      metadata: {
        total: items.length,
        tagIds,
        successCount: result.success.length,
        failedCount: result.failed.length,
      },
    })

    return result
  }

  /**
   * 批量移动文件到其他项目。
   * 默认禁止跨项目移动，除非显式允许。
   */
  async batchMove(
    items: BatchOperationItem[],
    projectId: number,
    targetProjectId: number,
    _userId: number,
    organizationId: number,
    _requestId?: string | null,
  ): Promise<BatchResult> {
    // 默认拒绝跨项目移动
    if (projectId !== targetProjectId) {
      throw new ValidationException('默认不允许跨项目移动文件')
    }

    // v3-multitenant-database-isolation §6.1：整批必须先落在同一有效租户 scope 内，
    // 混租或跨项目输入在任何行变更之前整体拒绝（不指明是哪个 ID 越界）。
    await this.assertSingleTenantBatch(items, projectId, organizationId)

    const result: BatchResult = { success: [], failed: [] }

    for (const item of items) {
      try {
        if (item.fileType === 'attachment') {
          const attachment = await Attachment.query()
            .where('id', item.fileId)
            .where('project_id', projectId)
            .first()

          if (!attachment) {
            throw new ResourceNotFoundException('附件不存在')
          }

          attachment.projectId = targetProjectId
          await attachment.save()
        }
        result.success.push({ fileType: item.fileType, fileId: item.fileId, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        result.failed.push({
          fileType: item.fileType,
          fileId: item.fileId,
          success: false,
          error: message,
        })
      }
    }

    return result
  }
}
// 原 `itemExistsInProject` 已删除：它只按 project_id 判存在性、且逐项抛出带 ID 的
// 错误消息，两点都被 `assertSingleTenantBatch` 取代
//（v3-multitenant-database-isolation §6.1：一次性组织 scope 解析 + 非泄露拒绝）。
