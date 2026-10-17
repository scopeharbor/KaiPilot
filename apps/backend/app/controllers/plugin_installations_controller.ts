/**
 * v3-skill-as-plugin-adapter —— PluginInstallationsController（W2b 安装生命周期控制器）。
 *
 * 路由：
 *   GET  /api/v1/organizations/:organizationId/plugin-installations
 *   GET  /api/v1/organizations/:organizationId/plugin-installations/:pluginId
 *   POST /api/v1/organizations/:organizationId/plugin-installations/commands/preview
 *   POST /api/v1/organizations/:organizationId/plugin-installations/commands/confirm
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import PluginInstallPolicy from '#policies/plugin_install_policy'
import { PluginInstallService, PluginInstallError } from '#services/plugin_install_service'
import {
  validateInstallConfirmInput,
  validateInstallPreviewInput,
} from '#validators/plugin_install_validator'
import type User from '#models/user'
import type { PluginInstallAction, PluginInstallationStatus } from '@aiproj/types'

@inject()
export default class PluginInstallationsController {
  constructor(
    private policy: PluginInstallPolicy,
    private installService: PluginInstallService,
  ) {}

  /**
   * GET / —— 列出组织内安装的插件
   */
  async index({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const { status } = request.qs()
    const installations = await this.installService.listByOrg(organizationId, {
      status: status as PluginInstallationStatus,
    })

    return response.ok({ data: installations })
  }

  /**
   * GET /:pluginId —— 获取单个插件安装详情（跨组织不可区分，返回 404）
   */
  async show({ params, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const installation = await this.installService.getByPluginId(
      organizationId,
      String(params.pluginId),
    )
    if (!installation) {
      return response.notFound({
        error: {
          code: 'plugin-install-not-found',
          message: '插件安装记录不存在',
        },
      })
    }

    return response.ok({ data: installation })
  }

  /**
   * POST /commands/preview —— 预览安装状态机动作与影响面
   */
  async preview({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)

    const body = request.body() as {
      action?: PluginInstallAction
      pluginId?: string
      releaseId?: number
      expectedDigest?: string
    }

    const validation = validateInstallPreviewInput(body)
    if (!validation.valid) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: validation.errors,
        },
      })
    }

    try {
      const previewResult = await this.installService.preview(organizationId, user.id, {
        action: body.action!,
        pluginId: body.pluginId!,
        releaseId: body.releaseId,
        expectedDigest: body.expectedDigest,
      })

      return response.ok({ data: previewResult })
    } catch (error) {
      if (error instanceof PluginInstallError) {
        if (error.code === 'plugin-install-not-found') {
          return response.notFound({
            error: { code: error.code, message: error.message },
          })
        }
        return response.badRequest({
          error: { code: error.code, message: error.message },
        })
      }
      throw error
    }
  }

  /**
   * POST /commands/confirm —— 确认执行状态转移
   */
  async confirm({ params, request, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeManage(user, organizationId)

    const body = request.body() as {
      previewHandle?: string
      previewDigest?: string
      permissionConfirmed?: boolean
      permissionDigest?: string
    }

    const validation = validateInstallConfirmInput(body)
    if (!validation.valid) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: validation.errors,
        },
      })
    }

    try {
      const result = await this.installService.confirm(organizationId, user.id, {
        previewHandle: body.previewHandle!,
        previewDigest: body.previewDigest!,
        permissionConfirmed: body.permissionConfirmed,
        permissionDigest: body.permissionDigest,
      })

      return response.ok({ data: result })
    } catch (error) {
      if (error instanceof PluginInstallError) {
        if (error.code === 'plugin-install-not-found') {
          return response.notFound({
            error: { code: error.code, message: error.message },
          })
        }
        return response.badRequest({
          error: { code: error.code, message: error.message },
        })
      }
      throw error
    }
  }
}
