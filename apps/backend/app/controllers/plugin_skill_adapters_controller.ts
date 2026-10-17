/**
 * v3-skill-as-plugin-adapter —— PluginSkillAdaptersController（W4a 只读 Controller）。
 *
 * 路由：
 *   GET /api/v1/organizations/:organizationId/plugin-skill-adapters
 *   GET /api/v1/organizations/:organizationId/plugin-skill-adapters/:pluginId
 *
 * 权限：受 auth + PluginInstallPolicy.authorizeView + 组织隔离门控。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import PluginInstallPolicy from '#policies/plugin_install_policy'
import PluginSkillAdapterService from '#services/plugin_skill_adapter_service'
import type User from '#models/user'

@inject()
export default class PluginSkillAdaptersController {
  constructor(
    private policy: PluginInstallPolicy,
    private adapterService: PluginSkillAdapterService,
  ) {}

  /**
   * GET / —— 查询组织内所有插件 Skill Adapter 解析与生效状态
   */
  async index({ params, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const result = await this.adapterService.resolvePluginSkillContributions(organizationId)
    return response.ok({ data: result })
  }

  /**
   * GET /:pluginId —— 查询单个插件 Skill Adapter 解析与生效状态
   */
  async show({ params, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const pluginId = String(params.pluginId)
    const result = await this.adapterService.resolvePluginSkillContributions(
      organizationId,
      pluginId,
    )

    if (result.skillBundles.length === 0 && result.contextContributions.length === 0) {
      return response.notFound({
        error: {
          code: 'plugin-adapter-not-found',
          message: '未找到指定插件的 Adapter 贡献信息',
        },
      })
    }

    return response.ok({ data: result })
  }
}
