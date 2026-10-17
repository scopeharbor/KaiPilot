/**
 * v3-plugin-private-registry-lifecycle — PluginRegistryController（task 7.3）。
 *
 * 薄 Controller：只做 HTTP 解析/响应格式化，不含业务逻辑。
 * 判定与派生归纯核心（`services/plugin_registry/*_core.ts`），
 * 带组织过滤的读写归 `PluginRegistryRepository`，权限归 `PluginRegistryPolicy`。
 *
 * 路由：
 *   GET    /api/v1/organizations/:organizationId/plugin-registry
 *   GET    /api/v1/organizations/:organizationId/plugin-registry/review-queue
 *   GET    /api/v1/organizations/:organizationId/plugin-registry/resolve
 *   GET    /api/v1/organizations/:organizationId/plugin-registry/:entryId
 *   POST   /api/v1/organizations/:organizationId/plugin-registry/commands/preview
 *   POST   /api/v1/organizations/:organizationId/plugin-registry/commands/:handle/confirm
 *
 * 非泄露顺序：**先 404 再 403**——跨组织目标一律先当作「不存在」，
 * 避免用 403 反向确认「该组织存在这个条目」。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import PluginRegistryPolicy from '#policies/plugin_registry_policy'
import { PluginRegistryRepository } from '#services/plugin_registry/registry_repository'
import { generatePreview } from '#services/plugin_registry/preview_confirm_core'
import type User from '#models/user'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import type { RegistryCommandAction, RegistryReleaseStatus } from '@aiproj/types'
import { evaluateCurrentReleaseApproval } from '#services/plugin_compatibility_service'

@inject()
export default class PluginRegistryController {
  constructor(
    private policy: PluginRegistryPolicy,
    private repository: PluginRegistryRepository,
  ) {}

  /** GET / —— 组织私有目录列表 */
  async index({ params, request, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    await this.policy.authorizeView(auth.getUserOrFail() as User, organizationId)

    const { page, perPage, status, pluginIdentity, sort } = request.qs()
    const result = await this.repository.listDirectory({
      organizationId,
      page,
      perPage,
      status,
      pluginIdentity,
      sort,
    })

    return response.ok(result)
  }

  /** GET /review-queue —— 待审队列 */
  async reviewQueue({ params, request, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    await this.policy.authorizeReview(auth.getUserOrFail() as User, organizationId)

    const { page, perPage } = request.qs()
    const { data, ...meta } = await this.repository.listReviewQueue(
      organizationId,
      Number(page ?? 1),
      Number(perPage ?? 20),
    )

    return response.ok({ data, meta })
  }

  /** GET /resolve —— 版本解析（deprecated/withdrawn 不参与解析） */
  async resolve({ params, request, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    await this.policy.authorizeView(auth.getUserOrFail() as User, organizationId)

    const { pluginIdentity } = request.qs()
    if (!pluginIdentity) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'pluginIdentity 必填' },
      })
    }

    const resolved = await this.repository.resolveVersion(organizationId, String(pluginIdentity))
    if (!resolved) {
      return response.notFound({
        error: {
          code: 'registry-no-compatible-version',
          message: '组织私有目录中没有可解析的版本',
        },
      })
    }

    return response.ok({ data: resolved })
  }

  /** GET /:entryId —— 目录条目详情（跨组织当作不存在） */
  async show({ params, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    await this.policy.authorizeView(auth.getUserOrFail() as User, organizationId)

    const entry = await this.repository.findEntry(organizationId, String(params.entryId))
    if (!entry) {
      return response.notFound({
        error: { code: 'registry-release-not-found', message: '目录条目不存在' },
      })
    }

    return response.ok({ data: entry })
  }

  /** POST /commands/preview —— 生成低敏 diff 预览（不写正式数据） */
  async preview({ params, request, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    const user = auth.getUserOrFail() as User
    const body = request.body() as {
      action?: RegistryCommandAction
      targetReleaseId?: string | number
      affectedInstanceIds?: string[]
    }

    if (!body.action || !body.targetReleaseId) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'action 与 targetReleaseId 必填' },
      })
    }

    // 先 404 再 403：跨组织目标不得靠错误码被反推存在性
    const release = await PluginPrivateRegistryRelease.query()
      .where('organization_id', organizationId)
      .where('id', body.targetReleaseId)
      .first()
    if (!release) {
      return response.notFound({
        error: { code: 'registry-release-not-found', message: '目标 release 不存在' },
      })
    }

    await this.authorizeForAction(user, organizationId, body.action)

    const result = generatePreview({
      action: body.action,
      release: {
        id: String(release.id),
        organizationId: String(release.organizationId),
        pluginIdentity: release.pluginIdentity,
        version: release.version,
        packageDigest: release.packageDigest,
        manifestDigest: release.manifestDigest,
        compatibilityDigest: release.compatibilityDigest,
        upstreamReceiptRef: release.upstreamReceiptRef,
        status: release.status as RegistryReleaseStatus,
        metadata: release.metadata,
        rowVersion: release.rowVersion,
        createdAt: release.createdAt?.toISO() ?? '',
        updatedAt: release.updatedAt?.toISO() ?? release.createdAt?.toISO() ?? '',
      },
      actorRef: String(user.id),
      organizationId: String(organizationId),
      stateVersion: release.rowVersion,
      affectedInstanceIds: body.affectedInstanceIds,
    })

    if (!result.ok) {
      return response.badRequest({
        error: { code: result.errorCode, message: result.message },
      })
    }

    // Approval is the earliest authoritative gate.  Missing host ranges,
    // incompatible seams/migrations, and unhandled breaking changes are
    // rejected before a confirm handle can be issued.
    const approvalCompatibility =
      body.action === 'approve' ? evaluateCurrentReleaseApproval(release.metadata) : null
    if (approvalCompatibility && !approvalCompatibility.allowed) {
      return response.badRequest({
        error: {
          code: 'registry-release-incompatible',
          message: 'release compatibility review failed',
          details: {
            compatibilityDigest: approvalCompatibility.digest,
            reasonCodes: approvalCompatibility.reasonCodes,
          },
        },
      })
    }

    return response.ok({
      data: {
        ...result.preview,
        diff: result.diff,
        impactSummary: result.impactSummary,
        ...(approvalCompatibility
          ? {
              compatibilityDigest: approvalCompatibility.digest,
              compatibilityReasonCodes: approvalCompatibility.reasonCodes,
            }
          : {}),
      },
    })
  }

  /**
   * POST /commands/:handle/confirm —— 确认执行。
   *
   * 真实 apply 事务归 confirm service（W5 依赖），当前阶段返回 409 明确未接线，
   * **不做任何静默写入**——一个「看起来成功但什么都没做」的确认比失败更危险。
   */
  async confirm({ params, response, auth }: HttpContext) {
    const organizationId = this.orgIdOf(params)
    await this.policy.authorizeManage(auth.getUserOrFail() as User, organizationId)

    const operation = await this.repository.findOperation(organizationId, String(params.handle))
    if (!operation) {
      return response.notFound({
        error: {
          code: 'registry-preview-handle-invalid',
          message: 'preview handle 不存在或已消费',
        },
      })
    }

    return response.conflict({
      error: {
        code: 'registry-confirm-channel-unavailable',
        message: '确认通道尚未接入，本次未执行任何写入',
      },
    })
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private orgIdOf(params: Record<string, unknown>): number {
    return Number(params.organizationId)
  }

  /** 动作 → 所需权限：审批类归 review，回滚归 rollback，其余归 manage/submit。 */
  private async authorizeForAction(
    user: User,
    organizationId: number,
    action: RegistryCommandAction,
  ): Promise<void> {
    if (action === 'approve' || action === 'reject') {
      return this.policy.authorizeReview(user, organizationId)
    }
    if (action === 'rollback') {
      return this.policy.authorizeRollback(user, organizationId)
    }
    if (action === 'submit-for-review') {
      return this.policy.authorizeSubmit(user, organizationId)
    }
    return this.policy.authorizeManage(user, organizationId)
  }
}
