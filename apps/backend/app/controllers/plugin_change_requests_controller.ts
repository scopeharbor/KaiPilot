/**
 * v3-plugin-approval-change-flow —— 统一变更请求 API Controller。
 *
 * 路由（见 start/routes.ts）：
 *   GET    /api/v1/organizations/:organizationId/plugin-change-requests
 *   POST   /api/v1/organizations/:organizationId/plugin-change-requests
 *   GET    /api/v1/organizations/:organizationId/plugin-change-requests/:requestUid
 *   POST   /api/v1/organizations/:organizationId/plugin-change-requests/:requestUid/preview
 *   POST   /api/v1/organizations/:organizationId/plugin-change-requests/:requestUid/approve
 *   POST   /api/v1/organizations/:organizationId/plugin-change-requests/:requestUid/reject
 *   POST   /api/v1/organizations/:organizationId/plugin-change-requests/:requestUid/withdraw
 *   POST   /api/v1/organizations/:organizationId/plugin-change-requests/:requestUid/confirm-handle
 *   POST   /api/v1/organizations/:organizationId/plugin-change-requests/:requestUid/confirm
 *
 * 错误 envelope：{ error: { code, message, details? } }；
 * 未找到统一 404 非泄露；状态冲突族 409；权限族 403。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import PluginChangeRequestPolicy from '#policies/plugin_change_request_policy'
import PluginChangeRequestService, {
  PluginChangeRequestError,
  type ChangeFlowResult,
} from '#services/plugin_change_request_service'
import PluginChangeAdapters from '#services/plugin_change_adapters'
import type User from '#models/user'
import { isPluginChangeErrorCode } from '@aiproj/types'
import {
  validateCreateChangeRequestInput,
  validateDecisionInput,
  validateConfirmHandleInput,
  validateListQuery,
} from '#validators/plugin_change_request_validator'

const FLOW_HTTP_STATUS: Record<string, number> = {
  'plugin-change-permission-denied': 403,
  'plugin-change-self-approval-denied': 403,
  'plugin-change-permission-elevation-denied': 403,
  'plugin-change-payload-invalid': 400,
}

/** 读 unknown 异常上的 code/name，两者都可能缺席（Lucid 抛的是带 code 的 Error 子类）。 */
function errorTag(error: unknown): { code?: unknown; name?: unknown } {
  return !!error && typeof error === 'object' ? (error as { code?: unknown; name?: unknown }) : {}
}

/** 异常上的 `code` 字符串（非字符串或缺席一律 undefined）。 */
function errorCode(error: unknown): string | undefined {
  const code = errorTag(error).code
  return typeof code === 'string' ? code : undefined
}

function isNotFound(error: unknown): boolean {
  const tag = errorTag(error)
  return tag.code === 'E_ROW_NOT_FOUND' || tag.name === 'ModelNotFoundException'
}

@inject()
export default class PluginChangeRequestsController {
  constructor(
    private policy: PluginChangeRequestPolicy,
    private changeService: PluginChangeRequestService,
    private adapters: PluginChangeAdapters,
  ) {}

  /** 统一 Flow 结果 → HTTP 响应。 */
  private respondFlow<T>(response: HttpContext['response'], result: ChangeFlowResult<T>): void {
    if (result.ok) {
      response.ok({ data: (result as { data: T }).data })
      return
    }
    const status = FLOW_HTTP_STATUS[result.code] ?? 409
    response.status(status).send({
      error: { code: result.code, message: result.message },
    })
  }

  /** GET / —— 组织隔离分页列表 */
  async index({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const q = validateListQuery(request.qs() as Record<string, unknown>)
    if (!q.valid) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: q.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: q.errors,
        },
      })
    }
    const { data, meta } = await this.changeService.list(organizationId, q.value ?? {})
    return response.ok({
      data: data.map((row) => this.changeService.toRecordDTO(row)),
      meta,
    })
  }

  /** POST / —— 创建变更请求（install / permission-upgrade / version-upgrade） */
  async store({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)

    const body = request.body() as Record<string, unknown>
    const v = validateCreateChangeRequestInput(body)
    if (!v.valid) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: v.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: v.errors,
        },
      })
    }
    const input = v.value!
    try {
      // policy-bundle-change 等兄弟 change 扩展的 kind 由各自端点承接；本控制器只受理三类核心 kind
      if (
        input.kind !== 'install' &&
        input.kind !== 'permission-upgrade' &&
        input.kind !== 'version-upgrade'
      ) {
        return response.badRequest({
          error: {
            code: 'plugin-change-payload-invalid',
            message: `kind ${input.kind} 不由本端点受理`,
          },
        })
      }
      let row
      if (input.kind === 'permission-upgrade') {
        if (!input.releaseId) {
          return response.badRequest({
            error: {
              code: 'plugin-change-payload-invalid',
              message: 'permission-upgrade 需要 releaseId',
            },
          })
        }
        row = await this.adapters.createPermissionUpgradeRequestFromRelease({
          organizationId,
          projectId: null,
          requestedBy: user.id,
          pluginId: input.pluginId,
          targetReleaseId: input.releaseId,
        })
      } else {
        // policy-bundle-change 等扩展 kind 由各自端点承接（见上方守卫）；此处仅类型收窄兜底
        if (input.kind !== 'install' && input.kind !== 'version-upgrade') {
          return response.badRequest({
            error: {
              code: 'plugin-change-payload-invalid',
              message: `kind ${input.kind} 不由本端点受理`,
            },
          })
        }
        row = await this.adapters.createInstallLifecycleRequest({
          organizationId,
          projectId: null,
          requestedBy: user.id,
          kind: input.kind,
          pluginId: input.pluginId,
          releaseId: input.releaseId,
          approvalRequired: input.approvalRequired ?? true,
        })
      }
      return response.created({ data: this.changeService.toRecordDTO(row) })
    } catch (error) {
      if (isNotFound(error)) {
        return response.notFound({
          error: { code: 'plugin-change-request-not-found', message: '目标资源不存在' },
        })
      }
      const code = errorCode(error)
      if (code && code.startsWith('plugin-change-')) {
        const status = FLOW_HTTP_STATUS[code] ?? 409
        return response.status(status).send({
          error: { code, message: (error as Error).message },
        })
      }
      throw error
    }
  }

  /** GET /:requestUid —— 详情 + 决策流水 */
  async show({ params, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const row = await this.changeService.tryGetByUid(organizationId, String(params.requestUid))
    if (!row) {
      return response.notFound({
        error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
      })
    }
    try {
      const decisions = await this.changeService.listDecisions(organizationId, row.id)
      return response.ok({
        data: {
          request: this.changeService.toRecordDTO(row),
          decisions: decisions.map((d) => ({
            id: d.decisionUid,
            event: d.event,
            actorRef: d.actorRef,
            fromState: d.fromState,
            toState: d.toState,
            reasonCode: d.reasonCode,
            auditLogId: d.auditLogId,
            createdAt: d.createdAt.toISO(),
          })),
        },
      })
    } catch (error) {
      if (isNotFound(error)) {
        return response.notFound({
          error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
        })
      }
      throw error
    }
  }

  /** POST /:requestUid/preview —— 推进预览阶段 */
  async preview({ params, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)
    const changeRow = await this.changeService.tryGetByUid(
      organizationId,
      String(params.requestUid),
    )
    if (!changeRow) {
      return response.notFound({
        error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
      })
    }
    try {
      const result = await this.changeService.attachPreview(
        organizationId,
        String(params.requestUid),
      )
      if (!result.ok) {
        const status = FLOW_HTTP_STATUS[result.code] ?? 409
        return response.status(status).send({
          error: { code: result.code, message: result.message },
        })
      }
      return response.ok({ data: this.changeService.toRecordDTO(result.data) })
    } catch (error) {
      if (isNotFound(error)) {
        return response.notFound({
          error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
        })
      }
      throw error
    }
  }

  /** POST /:requestUid/approve —— maker-checker 审批 */
  async approve({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeApprove(user, organizationId)

    const v = validateDecisionInput(request.body() as Record<string, unknown>)
    if (!v.valid) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: v.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: v.errors,
        },
      })
    }
    const changeRow = await this.changeService.tryGetByUid(
      organizationId,
      String(params.requestUid),
    )
    if (!changeRow) {
      return response.notFound({
        error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
      })
    }
    try {
      const result = await this.changeService.approve(
        organizationId,
        String(params.requestUid),
        String(user.id),
        v.value!.idempotencyKey,
      )
      if (!result.ok) {
        const status = FLOW_HTTP_STATUS[result.code] ?? 409
        return response.status(status).send({
          error: { code: result.code, message: result.message },
        })
      }
      return response.ok({ data: this.changeService.toRecordDTO(result.data) })
    } catch (error) {
      if (isNotFound(error)) {
        return response.notFound({
          error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
        })
      }
      throw error
    }
  }

  /** POST /:requestUid/reject —— 拒绝（终态幂等） */
  async reject({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeApprove(user, organizationId)

    const body = request.body() as Record<string, unknown>
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length > 0
        ? body.idempotencyKey.trim()
        : `reject:${params.requestUid}:${user.id}`
    // 只接受目录内的错误码；拼错/伪造一律落回 service 默认值（不透传任意字符串）
    const reasonCode = isPluginChangeErrorCode(body.reasonCode) ? body.reasonCode : undefined

    const changeRow = await this.changeService.tryGetByUid(
      organizationId,
      String(params.requestUid),
    )
    if (!changeRow) {
      return response.notFound({
        error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
      })
    }
    try {
      const result = await this.changeService.reject(
        organizationId,
        String(params.requestUid),
        String(user.id),
        idempotencyKey,
        reasonCode,
      )
      this.respondFlow(response, result)
      if (result.ok) response.ok({ data: this.changeService.toRecordDTO(result.data) })
    } catch (error) {
      if (isNotFound(error)) {
        return response.notFound({
          error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
        })
      }
      throw error
    }
  }

  /** POST /:requestUid/withdraw —— 发起人撤回（管理员可代为） */
  async withdraw({ params, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)

    const row = await this.changeService.tryGetByUid(organizationId, String(params.requestUid))
    if (!row) {
      return response.notFound({
        error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
      })
    }
    try {
      const isRequester = row.requestedBy === String(user.id)
      const force = !isRequester // 已过 manage 策略的管理员可强制撤回
      const result = await this.changeService.withdraw(
        organizationId,
        row.requestUid,
        String(user.id),
        {
          forceByPolicy: force,
        },
      )
      this.respondFlow(response, result)
      if (result.ok) response.ok({ data: this.changeService.toRecordDTO(result.data) })
    } catch (error) {
      if (isNotFound(error)) {
        return response.notFound({
          error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
        })
      }
      throw error
    }
  }

  /** POST /:requestUid/confirm-handle —— 签发一次性确认句柄 */
  async confirmHandle({ params, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)
    const changeRow = await this.changeService.tryGetByUid(
      organizationId,
      String(params.requestUid),
    )
    if (!changeRow) {
      return response.notFound({
        error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
      })
    }
    try {
      const result = await this.changeService.issueConfirmHandle(
        organizationId,
        String(params.requestUid),
        String(user.id),
      )
      this.respondFlow(response, result)
    } catch (error) {
      if (isNotFound(error)) {
        return response.notFound({
          error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
        })
      }
      throw error
    }
  }

  /** POST /:requestUid/confirm —— 最终显式确认并应用（提交门） */
  async confirm({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)

    const v = validateConfirmHandleInput(request.body() as Record<string, unknown>)
    if (!v.valid) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: v.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: v.errors,
        },
      })
    }

    const row = await this.changeService.tryGetByUid(organizationId, String(params.requestUid))
    if (!row) {
      return response.notFound({
        error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
      })
    }
    // 扩展 kind（policy-bundle-change / registry-release-change …）的 apply delegate
    // 归各自领域所有，本端点只持有三类核心 kind 的 delegate。缺此守卫时兜底分支会把
    // 扩展 kind 误套 install lifecycle delegate 并写错领域 —— 一律 fail closed。
    if (
      row.kind !== 'install' &&
      row.kind !== 'permission-upgrade' &&
      row.kind !== 'version-upgrade'
    ) {
      return response.badRequest({
        error: {
          code: 'plugin-change-payload-invalid',
          message: `kind ${row.kind} 的确认由其领域端点承接`,
        },
      })
    }
    try {
      const delegate =
        row.kind === 'permission-upgrade'
          ? this.adapters.buildPermissionUpgradeApplyDelegate({
              organizationId,
              requestedKeys: [
                ...(row.diffJson.permissionDelta?.unchanged ?? []),
                ...(row.diffJson.permissionDelta?.added ?? []),
              ],
            })
          : this.adapters.buildInstallLifecycleApplyDelegate({
              organizationId,
              executorId: user.id,
            })

      const result = await this.changeService.confirmAndApply({
        organizationId,
        requestUid: row.requestUid,
        executorRef: String(user.id),
        handle: v.value!.handle,
        applyDelegate: delegate,
      })
      if (result.ok) {
        return response.ok({ data: this.changeService.toRecordDTO(result.data.request) })
      }
      const status = FLOW_HTTP_STATUS[result.code] ?? 409
      return response.status(status).send({
        error: { code: result.code, message: result.message },
      })
    } catch (error) {
      if (isNotFound(error)) {
        return response.notFound({
          error: { code: 'plugin-change-request-not-found', message: '变更请求不存在' },
        })
      }
      if (error instanceof PluginChangeRequestError) {
        return response.status(409).send({
          error: { code: error.code, message: error.message },
        })
      }
      throw error
    }
  }
}
