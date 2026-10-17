import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { COPILOT_WEB_SEARCH_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * Copilot 网页搜索工具权限（v3-copilot-optional-web-search-configuration）。
 *
 * - manage（设置读写）：需要 `copilot:web_search:manage`（org_admin / project_manager）。
 * - 使用侧：回合入口已强制 `ai:trigger`；tool gate 在调用 provider 前再校验
 *   场景开关（allowForAiCreate / allowForGeneralCopilot）与按次同意。
 */
@inject()
export default class CopilotWebSearchPolicy {
  constructor(private rbac: RbacService) {}

  async manage(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, COPILOT_WEB_SEARCH_MANAGE, organizationId)
    return result.allowed
  }
}
