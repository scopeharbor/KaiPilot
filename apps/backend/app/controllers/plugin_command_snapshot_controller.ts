/**
 * v3-command-palette-plugin-action-pack —— PluginCommandSnapshotController（任务 3.1）。
 *
 * 路由：
 *   GET /api/v1/organizations/:organizationId/plugin-command-snapshots
 *
 * 只读资格快照投影：组织隔离 + PluginInstallPolicy.authorizeView；
 * 无插件组织返回 { data: [], meta: { total: 0, findings: [] } }（零行为变化）。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import PluginInstallPolicy from '#policies/plugin_install_policy'
import PluginCommandSnapshotService from '#services/plugin_command_snapshot_service'
import type User from '#models/user'

@inject()
export default class PluginCommandSnapshotController {
  constructor(
    private policy: PluginInstallPolicy,
    private snapshotService: PluginCommandSnapshotService,
  ) {}

  /**
   * GET / —— 当前组织已启用官方命令包的资格快照列表
   */
  async index({ params, response, auth }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId)

    const { snapshots, findings } = await this.snapshotService.listSnapshots(
      organizationId,
      user.id,
    )

    return response.ok({
      data: snapshots,
      meta: { total: snapshots.length, findings },
    })
  }
}
