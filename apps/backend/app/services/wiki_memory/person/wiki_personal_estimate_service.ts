/**
 * v3-llm-wiki-person-space —— 个人估算校准（design D2）。
 *
 * 只作用于调用者本人：统计本人负责并已完成的最近任务，写入本人个人空间的「我的估算校准」页（系统作者、按簿记发布）。
 * 页面只在本人主动刷新时创建；默认不授权给任何人；不含他人数据、排名或比较。没有管理员入口与批量命令。
 */
import { inject } from '@adonisjs/core'
import {
  WIKI_PERSON_ESTIMATE_GENERATOR,
  WIKI_PERSON_ESTIMATE_KEY_PREFIX,
  WIKI_PERSON_ESTIMATE_RECENT_LIMIT,
  WIKI_PERSON_ESTIMATE_SLUG,
  computeWikiPersonEstimate,
  renderWikiPersonEstimateBlock,
  wikiPersonEstimatePageBody,
  type WikiPersonEstimateRefreshSummary,
} from '@aiproj/types'
import { collectExecutionSamples } from '#services/ai_draft/planning_memory'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { WikiActor } from '../wiki_access_service.js'
import WikiDerivedPageWriter from '../wiki_derived_page_writer.js'
import WikiSettingsService from '../wiki_settings_service.js'
import WikiSpaceService from '../wiki_space_service.js'

@inject()
export default class WikiPersonalEstimateService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly spaces: WikiSpaceService,
    private readonly writer: WikiDerivedPageWriter,
    private readonly audit: AuditService,
  ) {}

  async refresh(actor: WikiActor): Promise<WikiPersonEstimateRefreshSummary> {
    await this.settings.assertEnabled(actor.organizationId)
    const space = await this.spaces.resolve(actor, 'user', actor.user.id)
    const summary: WikiPersonEstimateRefreshSummary = {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
    }
    const stats = computeWikiPersonEstimate(
      await collectExecutionSamples(actor.organizationId, null, {
        assigneeId: actor.user.id,
        limit: WIKI_PERSON_ESTIMATE_RECENT_LIMIT,
      }),
    )
    if (!stats) summary.skipped++
    else {
      const block = renderWikiPersonEstimateBlock(stats)
      await this.writer.upsert(
        actor,
        space,
        {
          slug: WIKI_PERSON_ESTIMATE_SLUG,
          pageType: 'person',
          generatorId: WIKI_PERSON_ESTIMATE_GENERATOR,
          keyPrefix: WIKI_PERSON_ESTIMATE_KEY_PREFIX,
          block,
          fullBody: () => wikiPersonEstimatePageBody(block),
          label: '估算校准',
          ownerUserId: actor.user.id,
        },
        summary,
      )
    }
    await this.audit.log({
      event: AuditEvent.WIKI_PERSON_ESTIMATE_REFRESHED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_space',
      entityId: space.id,
      metadata: { ...summary },
    })
    return summary
  }
}
