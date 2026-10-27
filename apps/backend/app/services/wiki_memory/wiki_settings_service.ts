/**
 * v3-llm-wiki-memory-foundation —— 组织级开关 `wikiMemoryEnabled`。
 * v3-llm-wiki-default-on：所有版本默认开启——未设置视为开启，只有组织管理员显式关闭（false）才关闭。
 *
 * 存于 organizations.settings JSON；只有 org:manage 可改。关闭时全部维基接口返回 FEATURE_DISABLED。
 */
import { inject } from '@adonisjs/core'
import Organization from '#models/organization'
import type User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import RbacService from '#services/rbac_service'
import { ORG_MANAGE } from '#start/rbac/permissions'
import { WikiFeatureDisabledError, WikiPermissionError } from './errors.js'

export const WIKI_SETTINGS_KEY = 'wikiMemoryEnabled'

/** 组织设置里的维基开关：未设置视为开启（服务与 wiki:* 命令共用）。 */
export function isWikiEnabledInSettings(settings: Record<string, unknown> | null | undefined) {
  return settings?.[WIKI_SETTINGS_KEY] !== false
}

@inject()
export default class WikiSettingsService {
  constructor(
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  async isEnabled(organizationId: number): Promise<boolean> {
    const org = await Organization.find(organizationId)
    return org ? isWikiEnabledInSettings(org.settings) : false
  }

  async assertEnabled(organizationId: number): Promise<void> {
    if (!(await this.isEnabled(organizationId))) throw new WikiFeatureDisabledError()
  }

  async canManage(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, ORG_MANAGE, organizationId)
    return result.allowed
  }

  async setEnabled(user: User, organizationId: number, enabled: boolean): Promise<void> {
    if (!(await this.canManage(user, organizationId))) throw new WikiPermissionError()
    const org = await Organization.findOrFail(organizationId)
    org.settings = { ...(org.settings ?? {}), [WIKI_SETTINGS_KEY]: enabled }
    await org.save()
    await this.audit.log({
      event: AuditEvent.WIKI_SETTINGS_UPDATED,
      userId: user.id,
      organizationId,
      entityType: 'organization',
      entityId: organizationId,
      metadata: { enabled },
    })
  }
}
