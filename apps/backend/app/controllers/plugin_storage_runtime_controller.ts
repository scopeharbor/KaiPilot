/**
 * v3-plugin-scoped-storage —— PluginStorageRuntimeController（任务 4.1）。
 *
 * runtime 存储面（宿主/插件贡献在用户会话下调用）：
 *   GET    /api/v1/organizations/:organizationId/plugin-storage/runtime/:pluginId/entries        列举
 *   GET    /api/v1/organizations/:organizationId/plugin-storage/runtime/:pluginId/entries/:key   读取
 *   PUT    /api/v1/organizations/:organizationId/plugin-storage/runtime/:pluginId/entries/:key   写入（CAS）
 *   DELETE /api/v1/organizations/:organizationId/plugin-storage/runtime/:pluginId/entries/:key   删除（CAS）
 *
 * 授权：RBAC view（读）/ manage（写删）+ Service 合取门（enabled 安装 ∧ scope ∧ project Policy
 * ∧ lifecycle ∧ revision）。客户端提供的 scope/projectId 只是寻址参数，不是 authority。
 * 隔离失败统一 404 非泄露。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import PluginStoragePolicy from '#policies/plugin_storage_policy'
import PluginStorageService from '#services/plugin_storage/storage_service'
import { storageFailureResponse } from '#services/plugin_storage/failure_http'
import {
  validateStoragePutInput,
  validateStorageListQuery,
} from '#validators/plugin_storage_validator'
import type User from '#models/user'

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,199}$/

@inject()
export default class PluginStorageRuntimeController {
  constructor(
    private policy: PluginStoragePolicy,
    private storage: PluginStorageService,
  ) {}

  /** GET /entries —— 有界分页列举 */
  async index({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const pluginId = String(params.pluginId ?? '')
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const validation = validateStorageListQuery(request.qs() as Record<string, unknown>)
    if (!validation.valid) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: validation.errors,
        },
      })
    }

    const result = await this.storage.list({
      organizationId,
      actorId: user.id,
      pluginId,
      ...validation.normalized,
    })
    if (!result.ok) {
      const mapped = storageFailureResponse(result)
      return response.status(mapped.status).json(mapped.body)
    }
    return response.ok({ data: result.result.data, meta: result.result.meta })
  }

  /** GET /entries/:key —— 读取单条 */
  async show({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const pluginId = String(params.pluginId ?? '')
    const key = String(params.key ?? '')
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    if (!KEY_PATTERN.test(key)) {
      return response.badRequest({
        error: { code: 'storage-key-invalid', message: 'key 格式非法' },
      })
    }
    const qs = request.qs() as Record<string, unknown>
    const scope = qs.scope
    if (scope !== 'organization' && scope !== 'project') {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'scope 必须为 organization 或 project' },
      })
    }
    let projectId: number | null = null
    if (scope === 'project') {
      projectId = Number(qs.projectId)
      if (!Number.isInteger(projectId) || projectId < 1) {
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: 'project scope 必须提供正整数 projectId' },
        })
      }
    }

    const result = await this.storage.get({
      organizationId,
      actorId: user.id,
      pluginId,
      scope,
      projectId,
      key,
    })
    if (!result.ok) {
      const mapped = storageFailureResponse(result)
      return response.status(mapped.status).json(mapped.body)
    }
    return response.ok({ data: result.entry })
  }

  /** PUT /entries/:key —— 写入（insert 或 CAS overwrite） */
  async put({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const pluginId = String(params.pluginId ?? '')
    const key = String(params.key ?? '')
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)

    if (!KEY_PATTERN.test(key)) {
      return response.badRequest({
        error: { code: 'storage-key-invalid', message: 'key 格式非法' },
      })
    }

    const body = request.body() as Record<string, unknown>
    const validation = validateStoragePutInput(body)
    if (!validation.valid) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: validation.errors,
        },
      })
    }

    const result = await this.storage.put({
      organizationId,
      actorId: user.id,
      pluginId,
      key,
      ...validation.normalized,
    })
    if (!result.ok) {
      const mapped = storageFailureResponse(result)
      return response.status(mapped.status).json(mapped.body)
    }
    return response.ok({
      data: result.entry,
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    })
  }

  /** DELETE /entries/:key —— 删除（需匹配 expectedRevision） */
  async destroy({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const pluginId = String(params.pluginId ?? '')
    const key = String(params.key ?? '')
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)

    if (!KEY_PATTERN.test(key)) {
      return response.badRequest({
        error: { code: 'storage-key-invalid', message: 'key 格式非法' },
      })
    }
    const input = { ...(request.body() as Record<string, unknown>), ...request.qs() } as Record<
      string,
      unknown
    >
    const scope = input.scope
    if (scope !== 'organization' && scope !== 'project') {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'scope 必须为 organization 或 project' },
      })
    }
    let projectId: number | null = null
    if (scope === 'project') {
      projectId = Number(input.projectId)
      if (!Number.isInteger(projectId) || projectId < 1) {
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: 'project scope 必须提供正整数 projectId' },
        })
      }
    }
    let expectedRevision: number | undefined
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== null &&
      input.expectedRevision !== ''
    ) {
      expectedRevision = Number(input.expectedRevision)
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: 'expectedRevision 必须为正整数' },
        })
      }
    }

    const result = await this.storage.deleteEntry({
      organizationId,
      actorId: user.id,
      pluginId,
      scope,
      projectId,
      key,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    })
    if (!result.ok) {
      const mapped = storageFailureResponse(result)
      return response.status(mapped.status).json(mapped.body)
    }
    return response.ok({ data: { deleted: true } })
  }
}
