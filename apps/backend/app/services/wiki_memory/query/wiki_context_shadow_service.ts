/**
 * v3-llm-wiki-query-navigation —— 影子模式：Copilot 回合装配完上下文后，以影子方式构建维基上下文包，只记统计。
 *
 * 影子观测本身不改变交给模型的输入（是否注入由回合注入端口决定，v3-llm-wiki-rag-retirement）；任何失败只记日志。环境变量 WIKI_CONTEXT_SHADOW=off 可关闭；
 * 组织未开启维基或读者无 wiki:view 时不运行。记录只含计数与问题哈希（不存原文与主张内容）。
 */
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { WikiContextPackDto, WikiShadowSummaryDto } from '@aiproj/types'
import User from '#models/user'
import WikiContextShadowRecord from '#models/wiki_context_shadow_record'
import type { WikiActor } from '../wiki_access_service.js'
import { sha256 } from '../wiki_revision_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import { WikiPermissionError } from '../errors.js'
import WikiContextPackBuilder from './wiki_context_pack_builder.js'
import WikiQueryService from './wiki_query_service.js'

export const WIKI_CONTEXT_SHADOW_ENV = 'WIKI_CONTEXT_SHADOW'
export const WIKI_SHADOW_SUMMARY_DAYS = 30

export interface WikiKnowledgeShadowInput {
  organizationId: number
  actorId: number
  projectId: number | null
  query: string
  legacySourcesCount: number
  legacyFactsCount: number
}

export function wikiContextShadowEnabled(): boolean {
  return (process.env[WIKI_CONTEXT_SHADOW_ENV] ?? '').trim().toLowerCase() !== 'off'
}

@inject()
export default class WikiContextShadowService {
  constructor(
    private readonly builder: WikiContextPackBuilder,
    private readonly query: WikiQueryService,
    private readonly settings: WikiSettingsService,
  ) {}

  /**
   * 只记录、不返回；失败吞掉（不影响回合）。返回是否写入了记录（供测试）。
   * `prebuilt`：回合已为注入装配好的包（v3-llm-wiki-rag-retirement），有则复用、不重复装配。
   */
  async observe(
    input: WikiKnowledgeShadowInput,
    prebuilt?: WikiContextPackDto | null,
  ): Promise<boolean> {
    try {
      if (!wikiContextShadowEnabled()) return false
      const user = await User.find(input.actorId)
      if (!user) return false
      const actor: WikiActor = { user, organizationId: input.organizationId }
      if (!(await this.query.isAvailable(actor))) return false
      const started = Date.now()
      const pack =
        prebuilt ??
        (await this.builder.build(actor, {
          projectId: input.projectId,
          query: input.query,
        }))
      await WikiContextShadowRecord.create({
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorUserId: input.actorId,
        queryHash: sha256(input.query.trim()),
        pagesCount: pack.pages.length,
        claimsCount: pack.pages.reduce((n, p) => n + p.claims.length, 0),
        bytes: pack.bytes,
        truncated: pack.truncated,
        legacySourcesCount: input.legacySourcesCount,
        legacyFactsCount: input.legacyFactsCount,
        durationMs: Date.now() - started,
      })
      return true
    } catch (error) {
      logger.warn(
        { organizationId: input.organizationId, err: (error as Error).name },
        'wiki context shadow failed',
      )
      return false
    }
  }

  /** 近 30 天汇总；只有维基开关管理者可看。 */
  async summary(actor: WikiActor): Promise<WikiShadowSummaryDto> {
    await this.settings.assertEnabled(actor.organizationId)
    if (!(await this.settings.canManage(actor.user, actor.organizationId)))
      throw new WikiPermissionError('只有组织管理员可以查看影子对比')
    const since = DateTime.now().minus({ days: WIKI_SHADOW_SUMMARY_DAYS }).toSQL()!
    const [row] = await db
      .from('wiki_context_shadow_records')
      .where('organization_id', actor.organizationId)
      .where('created_at', '>=', since)
      .select(
        db.raw('count(*) as turns'),
        db.raw('sum(case when claims_count > 0 then 1 else 0 end) as with_wiki'),
        db.raw('avg(claims_count) as avg_claims'),
        db.raw('avg(bytes) as avg_bytes'),
        db.raw('sum(case when truncated then 1 else 0 end) as truncated_turns'),
      )
    const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
    return {
      days: WIKI_SHADOW_SUMMARY_DAYS,
      turns: num(row?.turns),
      turnsWithWiki: num(row?.with_wiki),
      avgClaims: Math.round(num(row?.avg_claims) * 10) / 10,
      avgBytes: Math.round(num(row?.avg_bytes)),
      truncatedTurns: num(row?.truncated_turns),
    }
  }
}
