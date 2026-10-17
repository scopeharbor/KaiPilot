/**
 * v3-plugin-scoped-storage —— PluginStorageAdminController（任务 4.1）。
 *
 * 管理面：
 *   GET  /api/v1/organizations/:organizationId/plugin-storage/namespaces                     配额/用量清单
 *   POST /api/v1/organizations/:organizationId/plugin-storage/namespaces/:namespaceId/cleanup-preview  清理预览
 *   POST /api/v1/organizations/:organizationId/plugin-storage/cleanup-confirm                清理确认
 *   POST /api/v1/organizations/:organizationId/plugin-storage/export                         版本化分页导出
 *
 * 授权：view / manage / export 三权分立；跨组织一律 404 非泄露。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import PluginStoragePolicy from '#policies/plugin_storage_policy'
import PluginStorageNamespace from '#models/plugin_storage_namespace'
import StorageCleanupService from '#services/plugin_storage/storage_cleanup_service'
import { storageFailureResponse } from '#services/plugin_storage/failure_http'
import {
  validateStorageCleanupConfirmInput,
  validateStorageExportInput,
} from '#validators/plugin_storage_validator'
import type User from '#models/user'

@inject()
export default class PluginStorageAdminController {
  constructor(
    private policy: PluginStoragePolicy,
    private cleanup: StorageCleanupService,
  ) {}

  /** GET /namespaces —— 组织内 namespace 清单与配额用量（view） */
  async namespaces({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const qs = request.qs() as Record<string, unknown>
    let query = PluginStorageNamespace.forOrganization(organizationId)
    if (typeof qs.pluginId === 'string' && qs.pluginId.trim() !== '') {
      query = query.where('plugin_id', qs.pluginId.trim())
    }
    if (
      qs.status === 'active' ||
      qs.status === 'read-only' ||
      qs.status === 'orphaned' ||
      qs.status === 'pending-deletion'
    ) {
      query = query.where('status', qs.status)
    }
    const rows = await query.orderBy('id', 'asc')
    return response.ok({
      data: rows.map((ns) => ({
        namespaceId: ns.id,
        organizationId: ns.organizationId,
        projectId: ns.projectId,
        pluginId: ns.pluginId,
        pluginVersion: ns.pluginVersion,
        scope: ns.scope,
        status: ns.status,
        quotaBytes: ns.quotaBytes,
        usedBytes: ns.usedBytes,
        quotaEntries: ns.quotaEntries,
        usedEntries: ns.usedEntries,
        retentionUntil: ns.retentionUntil?.toISO() ?? null,
        createdAt: ns.createdAt.toISO(),
      })),
    })
  }

  /** POST /namespaces/:namespaceId/cleanup-preview —— 清理影响面预览 + 一次性句柄（manage） */
  async cleanupPreview({ params, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const namespaceId = Number(params.namespaceId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)

    if (!Number.isInteger(namespaceId) || namespaceId < 1) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'namespaceId 非法' },
      })
    }

    const result = await this.cleanup.previewCleanup({
      organizationId,
      actorId: user.id,
      namespaceId,
    })
    if (!result.ok) {
      const mapped = storageFailureResponse(result)
      return response.status(mapped.status).json(mapped.body)
    }
    return response.ok({ data: result.preview })
  }

  /** POST /cleanup-confirm —— 消费一次性句柄执行清理并写可信审计（manage） */
  async cleanupConfirm({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)

    const validation = validateStorageCleanupConfirmInput(request.body() as Record<string, unknown>)
    if (!validation.valid) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: validation.errors,
        },
      })
    }

    const result = await this.cleanup.confirmCleanup({
      organizationId,
      actorId: user.id,
      request: validation.normalized,
    })
    if (!result.ok) {
      const mapped = storageFailureResponse(result)
      return response.status(mapped.status).json(mapped.body)
    }
    return response.ok({ data: result.result })
  }

  /** POST /export —— 版本化有界导出（export 权限） */
  async export({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeExport(user, organizationId)

    const body = request.body() as Record<string, unknown>
    const validation = validateStorageExportInput(body)
    if (!validation.valid) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: validation.errors,
        },
      })
    }
    const pageRaw = Number(body.page)
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1

    const result = await this.cleanup.exportPage({
      organizationId,
      actorId: user.id,
      filter: validation.normalized,
      page,
      writeFile: true,
    })
    if (!result.ok) {
      const mapped = storageFailureResponse(result)
      return response.status(mapped.status).json(mapped.body)
    }
    return response.ok({
      data: {
        manifest: result.manifest,
        records: result.records,
        filePath: result.filePath,
      },
    })
  }
}
