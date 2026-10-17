/**
 * v3-organization-private-plugin-directory — PluginDirectoryController（tasks 2.5）。
 *
 * 组织私有插件目录的**只读**产品面：release 列表、详情（兼容性摘要 + 审批摘要 +
 * 影响计数）、有界受影响安装清单。
 *
 * 薄 Controller：只做 HTTP 解析/响应格式化，不含业务逻辑。
 * 判定与派生归纯核心（`services/plugin_registry/directory_projection_core.ts`），
 * 带组织过滤的只读查询归 `DirectoryProjectionRepository`，
 * 权限归既有 `PluginRegistryPolicy`（不新增第二套权限系统）。
 *
 * 路由：
 *   GET  /api/v1/organizations/:organizationId/plugin-directory/releases
 *   GET  /api/v1/organizations/:organizationId/plugin-directory/releases/:releaseId
 *   GET  /api/v1/organizations/:organizationId/plugin-directory/releases/:releaseId/affected-installations
 *   GET  /api/v1/organizations/:organizationId/plugin-directory/releases/:releaseId/rollback-preview
 *   POST /api/v1/organizations/:organizationId/plugin-directory/releases/:releaseId/changes
 *   POST /api/v1/organizations/:organizationId/plugin-directory/changes/:requestUid/confirm
 *
 * 非泄露顺序：**先 404 再 403**——跨组织目标一律先当作「不存在」，
 * 避免用 403 反向确认「该组织存在这个 release」。
 *
 * 写入口边界（任务 1.2 裁决已解除，§3 接入）：上游 `v3-plugin-approval-change-flow`
 * 已落地，approve/disable/restore/rollback **全部**经统一插件变更流
 * （`registry-release-change` kind）；本控制器绝不直接更新 registry release 状态，
 * 也绝不直接改写任何安装行。审批与最终确认严格分离（审批 ≠ 生效）。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import PluginRegistryPolicy from '#policies/plugin_registry_policy'
import { DirectoryProjectionRepository } from '#services/plugin_registry/directory_projection_repository'
import { directoryError } from '#services/plugin_registry/directory_projection_core'
import {
  PluginDirectoryChangeAdapter,
  PluginDirectoryChangeError,
} from '#services/plugin_registry/directory_change_adapter'
import {
  listDirectoryReleasesValidator,
  listAffectedInstallationsValidator,
  createDirectoryChangeRequestValidator,
  rollbackPreviewValidator,
} from '#validators/plugin_directory_validator'
import type User from '#models/user'
import type { DirectoryViewerRole } from '#services/plugin_registry/directory_projection_core'

/** 目录动作 -> 所需权限维度（与 registry controller 的 authorizeForAction 同一映射）。 */
const ACTION_AUTHORIZATION = {
  approve: 'review',
  disable: 'manage',
  restore: 'manage',
  rollback: 'rollback',
} as const

/**
 * 变更流/目录 reason code -> HTTP 状态（未登记者一律 409：状态冲突，绝不 500）。
 * 与 `plugin_change_requests_controller` 的 FLOW_HTTP_STATUS 同语义，
 * 额外覆盖目录前置校验码。
 */
const DIRECTORY_FLOW_HTTP_STATUS: Record<string, number> = {
  'plugin-change-permission-denied': 403,
  'plugin-change-self-approval-denied': 403,
  'plugin-change-permission-elevation-denied': 403,
  'plugin-change-payload-invalid': 400,
  'registry-release-not-found': 404,
}

@inject()
export default class PluginDirectoryController {
  constructor(
    private policy: PluginRegistryPolicy,
    private repository: DirectoryProjectionRepository,
    private changeAdapter: PluginDirectoryChangeAdapter,
  ) {}

  /** GET /releases —— 目录 release 列表（成员只见可分发集合） */
  async index({ params, request, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)
    const viewerRole = await this.resolveViewerRole(user, organizationId)

    const query = await listDirectoryReleasesValidator.validate(request.qs())
    const result = await this.repository.listReleases({
      organizationId,
      viewerRole,
      status: query.status,
      pluginIdentity: query.pluginIdentity,
      fixtureOnly: query.fixtureOnly,
      sort: query.sort,
      page: query.page,
      perPage: query.perPage,
    })

    return response.ok(result)
  }

  /** GET /releases/:releaseId —— 目录 release 详情（跨组织当作不存在） */
  async show({ params, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const releaseId = String(params.releaseId ?? '')
    if (!/^\d+$/.test(releaseId)) {
      return response.badRequest(directoryError('directory-invalid-query'))
    }
    const viewerRole = await this.resolveViewerRole(user, organizationId)

    const detail = await this.repository.getReleaseDetail(organizationId, releaseId, viewerRole)
    if (!detail) {
      return response.notFound(directoryError('directory-release-not-found'))
    }

    return response.ok({ data: detail })
  }

  /**
   * GET /releases/:releaseId/affected-installations —— 有界受影响安装清单。
   * 管理员视图：禁用分发前评估影响面的事实输入；成员不可见（403）。
   */
  async affectedInstallations({ params, request, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const releaseId = String(params.releaseId ?? '')
    if (!/^\d+$/.test(releaseId)) {
      return response.badRequest(directoryError('directory-invalid-query'))
    }

    // 先确认目标在本组织内存在（不存在 → 404），再做管理权限判定（不足 → 403）。
    const exists = await this.repository.getReleaseDetail(organizationId, releaseId, 'manager')
    if (!exists) {
      return response.notFound(directoryError('directory-release-not-found'))
    }
    await this.policy.authorizeManage(user, organizationId)

    const query = await listAffectedInstallationsValidator.validate(request.qs())
    const result = await this.repository.listAffectedInstallations(
      organizationId,
      releaseId,
      query.page,
      query.perPage,
    )

    return response.ok(result)
  }

  // ── 受控管理动作（tasks 3.1–3.6）────────────────────────────────────────
  //
  // 全部写入**只**通过统一插件变更流（design.md D2）：本控制器不直接更新
  // registry release 状态，也不直接改写任何安装行。审批（maker-checker）复用
  // 共享 `/plugin-changes/:uid/approve`；最终确认由下方本控制器 confirm 承接，
  // 因为只有目录侧知道 `registry-release-change` 的 apply delegate。

  /**
   * POST /releases/:releaseId/changes —— 创建目录管理变更请求。
   *
   * body: `{ action: approve|disable|restore|rollback, selectedInstanceIds?: number[] }`
   * 语义（design D3/D4）：
   * - `disable` 只阻断未来分发（release -> withdrawn），**绝不**停用/卸载已安装实例；
   * - `rollback` 只切换推荐指针；显式选中的实例经既有 install lifecycle 降级。
   *
   * 返回 202：请求已进入审批流，尚未生效（审批 ≠ 确认）。
   */
  async createChange({ params, request, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const releaseId = String(params.releaseId ?? '')
    if (!/^\d+$/.test(releaseId)) {
      return response.badRequest(directoryError('directory-invalid-query'))
    }

    // 非泄露顺序：先 404（跨组织/不存在），再按动作判权限（不足 -> 403）。
    const exists = await this.repository.getReleaseDetail(organizationId, releaseId, 'manager')
    if (!exists) {
      return response.notFound(directoryError('directory-release-not-found'))
    }

    const payload = await createDirectoryChangeRequestValidator.validate(request.body())
    await this.authorizeAction(user, organizationId, payload.action)

    try {
      const created = await this.changeAdapter.createReleaseChangeRequest({
        organizationId,
        requestedBy: user.id,
        action: payload.action,
        targetReleaseId: Number(releaseId),
        selectedInstanceIds: payload.selectedInstanceIds,
      })
      return response.accepted({ data: created })
    } catch (error) {
      return this.respondChangeError(response, error)
    }
  }

  /**
   * GET /releases/:releaseId/rollback-preview —— 回滚结构化预览（纯读，task 3.5）。
   *
   * `:releaseId` 即回滚**目标**（历史 release）。返回 manifest/package/permission/
   * compatibility 的 from->to 对照与 blocking findings；存在阻断项时预览仍返回 200
   * 并标记 findings，但 createChange 会拒绝提交（预览与提交判定同源）。
   */
  async rollbackPreview({ params, request, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const releaseId = String(params.releaseId ?? '')
    if (!/^\d+$/.test(releaseId)) {
      return response.badRequest(directoryError('directory-invalid-query'))
    }
    const exists = await this.repository.getReleaseDetail(organizationId, releaseId, 'manager')
    if (!exists) {
      return response.notFound(directoryError('directory-release-not-found'))
    }
    await this.policy.authorizeRollback(user, organizationId)

    const query = await rollbackPreviewValidator.validate(request.qs())
    const plan = await this.changeAdapter.buildRollbackDiff(
      organizationId,
      Number(releaseId),
      query.selectedInstanceIds ?? [],
    )
    if (!plan.ok) {
      // 目标不可回滚属业务前置失败（409），与「不存在」（404）区分开。
      return response.status(409).send({ error: { code: plan.errorCode, message: plan.message } })
    }
    return response.ok({ data: plan.diff })
  }

  /**
   * POST /changes/:requestUid/confirm —— 目录变更最终确认（提交门）。
   *
   * 与 policy-bundle 同范式：扩展 kind 由各自端点承接 confirm，因为 apply delegate
   * 归本领域所有。非 `registry-release-change` 一律 400 fail closed。
   */
  async confirmChange({ params, request, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)

    const body = (request.body() ?? {}) as Record<string, unknown>
    const handle = typeof body.handle === 'string' ? body.handle : ''
    if (handle.length === 0) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'handle: 确认句柄必填' },
      })
    }

    const requestUid = String(params.requestUid ?? '')
    const row = await this.changeAdapter.findDirectoryChangeRequest(organizationId, requestUid)
    if (!row) {
      return response.notFound({
        error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
      })
    }
    if (row.kind !== 'registry-release-change') {
      return response.badRequest({
        error: { code: 'plugin-change-payload-invalid', message: '非目录类变更请求' },
      })
    }

    try {
      const result = await this.changeAdapter.confirmReleaseChange({
        organizationId,
        requestUid: row.requestUid,
        executorId: user.id,
        handle,
      })
      if (result.ok) return response.ok({ data: result.data })
      const status = DIRECTORY_FLOW_HTTP_STATUS[result.code] ?? 409
      return response.status(status).send({ error: { code: result.code, message: result.message } })
    } catch (error) {
      return this.respondChangeError(response, error)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private orgIdOf(params: Record<string, unknown>): number {
    return Number(params.organizationId)
  }

  /**
   * 视图角色：持有 review 或 manage 权限者获得管理员视图（可见草稿/待审/拒绝/撤回）；
   * 其余（member/viewer 等只读角色）为普通成员视图。角色只影响可见性过滤，
   * 授权本身仍由 Policy 逐项判定。
   */
  private async resolveViewerRole(
    user: User,
    organizationId: number,
  ): Promise<DirectoryViewerRole> {
    const elevated =
      (await this.policy.review(user, organizationId)) ||
      (await this.policy.manage(user, organizationId))
    return elevated ? 'manager' : 'member'
  }

  /** 动作 -> Policy 授权（不足即 403，绝不静默降级）。 */
  private async authorizeAction(
    user: User,
    organizationId: number,
    action: keyof typeof ACTION_AUTHORIZATION,
  ): Promise<void> {
    const dimension = ACTION_AUTHORIZATION[action]
    if (dimension === 'review') return this.policy.authorizeReview(user, organizationId)
    if (dimension === 'rollback') return this.policy.authorizeRollback(user, organizationId)
    return this.policy.authorizeManage(user, organizationId)
  }

  /** 目录变更错误 -> 稳定低敏 HTTP 响应（不回显 digest/实例明细）。 */
  private respondChangeError(response: HttpContext['response'], error: unknown) {
    if (error instanceof PluginDirectoryChangeError) {
      const status = DIRECTORY_FLOW_HTTP_STATUS[error.code] ?? 409
      return response.status(status).send({ error: { code: error.code, message: error.message } })
    }
    throw error
  }
}
