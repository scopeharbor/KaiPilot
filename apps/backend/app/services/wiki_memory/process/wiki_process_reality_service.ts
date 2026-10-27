/**
 * v3-llm-wiki-process-reality —— 流程页「实际的流程」派生段刷新，以及草案生成读取。
 *
 * 刷新：从本组织审计流统计任务流转与变更审批，经共用派生页写入器按簿记由系统发布；声明段与解读段原样保留；统计不变不提交。
 * 读取：组织已开启维基时取已发布流程页，解析派生段，并附页面中读者可见的非派生主张（人写声明、经审阅的解读）。
 */
import { inject } from '@adonisjs/core'
import {
  WIKI_PROCESS_GENERATORS,
  WIKI_PROCESS_KEY_PREFIX,
  WIKI_PROCESS_KINDS,
  computeWikiChangeApproval,
  computeWikiTaskFlow,
  parseWikiChangeApprovalBlock,
  parseWikiMarkdown,
  parseWikiTaskFlowBlock,
  renderWikiChangeApprovalBlock,
  renderWikiTaskFlowBlock,
  wikiProcessPageBody,
  wikiProcessSlug,
  type WikiDerivedBlockRender,
  type WikiDossierRefreshSummary,
  type WikiProcessKind,
  type WikiProcessRealityForDraft,
} from '@aiproj/types'
import WikiPage from '#models/wiki_page'
import WikiRevision from '#models/wiki_revision'
import WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import WikiDerivedPageWriter from '../wiki_derived_page_writer.js'
import WikiReadService from '../wiki_read_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import WikiSpaceService from '../wiki_space_service.js'
import { WikiPermissionError } from '../errors.js'
import { isVisibleClaim } from '../query/wiki_query_service.js'
import WikiProcessEventCollector from './wiki_process_event_collector.js'

const MAX_PROCESS_CLAIMS = 4

export interface WikiDraftProcessReality {
  facts: string[]
  processReality: WikiProcessRealityForDraft
}

@inject()
export default class WikiProcessRealityService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly spaces: WikiSpaceService,
    private readonly access: WikiAccessService,
    private readonly writer: WikiDerivedPageWriter,
    private readonly read: WikiReadService,
    private readonly collector: WikiProcessEventCollector,
    private readonly audit: AuditService,
  ) {}

  // ── 刷新 ───────────────────────────────────────────────────────────────

  async refresh(actor: WikiActor): Promise<WikiDossierRefreshSummary> {
    await this.settings.assertEnabled(actor.organizationId)
    const space = await this.spaces.resolve(actor, 'organization', actor.organizationId)
    if (!(await this.access.canReviewSpace(actor, space)))
      throw new WikiPermissionError('只有组织维基的审阅者可以刷新流程实况')

    const summary: WikiDossierRefreshSummary = { created: 0, updated: 0, unchanged: 0, skipped: 0 }
    for (const kind of WIKI_PROCESS_KINDS) {
      const block = await this.blockFor(actor.organizationId, kind)
      if (!block) {
        summary.skipped++
        continue
      }
      await this.writer.upsert(
        actor,
        space,
        {
          slug: wikiProcessSlug(kind),
          pageType: 'process',
          generatorId: WIKI_PROCESS_GENERATORS[kind],
          keyPrefix: WIKI_PROCESS_KEY_PREFIX[kind],
          block,
          fullBody: () => wikiProcessPageBody(kind, block),
          label: '流程实况',
        },
        summary,
      )
    }

    await this.audit.log({
      event: AuditEvent.WIKI_PROCESS_REFRESHED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_space',
      entityId: space.id,
      metadata: { ...summary },
    })
    return summary
  }

  private async blockFor(
    organizationId: number,
    kind: WikiProcessKind,
  ): Promise<WikiDerivedBlockRender | null> {
    const events = await this.collector.collect(organizationId, kind)
    if (kind === 'task-flow') {
      const stats = computeWikiTaskFlow(events)
      return stats ? renderWikiTaskFlowBlock(stats) : null
    }
    const stats = computeWikiChangeApproval(events)
    return stats ? renderWikiChangeApprovalBlock(stats) : null
  }

  // ── 草案读取 ───────────────────────────────────────────────────────────

  async processForDraft(actor: WikiActor): Promise<WikiDraftProcessReality | null> {
    if (!(await this.settings.isEnabled(actor.organizationId))) return null
    const spaceId = await this.spaces.organizationSpaceId(actor.organizationId)
    if (spaceId === null) return null
    const space = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('id', spaceId)
      .firstOrFail()
    if (!(await this.access.canReadSpace(actor, space))) return null

    const facts: string[] = []
    const processReality: WikiProcessRealityForDraft = {}
    const claims: string[] = []

    const taskPage = await this.publishedPage(space, 'task-flow')
    if (taskPage) {
      const stats = parseWikiTaskFlowBlock(
        this.blockOf(taskPage.revision, WIKI_PROCESS_GENERATORS['task-flow']),
      )
      if (stats) {
        const title = taskPage.page.title
        facts.push(
          `本组织任务的实际流转：约 ${stats.reworkRate}% 的任务完成后被重新打开或退回，平均完成 ${stats.rounds} 轮；${stats.blockedRate}% 受阻或暂停过（组织维基「${title}」，${stats.samples} 个样本）。安排评审、验收与返工缓冲时参考这一点`,
        )
        processReality.taskFlow = {
          label: title,
          samples: stats.samples,
          reworkRate: stats.reworkRate,
          blockedRate: stats.blockedRate,
        }
      }
      claims.push(...(await this.visibleClaims(actor, taskPage.page, taskPage.revision)))
    }

    const changePage = await this.publishedPage(space, 'change-approval')
    if (changePage) {
      const stats = parseWikiChangeApprovalBlock(
        this.blockOf(changePage.revision, WIKI_PROCESS_GENERATORS['change-approval']),
      )
      if (stats) {
        const title = changePage.page.title
        facts.push(
          `本组织变更审批从提交到结论实际等待 P50 ${stats.waitP50Days} 天、P80 ${stats.waitP80Days} 天，${stats.returnRate}% 被退回补充过（组织维基「${title}」，${stats.samples} 个样本）。计划里有审批节点时留出等待时间`,
        )
        processReality.changeApproval = {
          label: title,
          samples: stats.samples,
          waitP50Days: stats.waitP50Days,
          waitP80Days: stats.waitP80Days,
          returnRate: stats.returnRate,
        }
      }
      claims.push(...(await this.visibleClaims(actor, changePage.page, changePage.revision)))
    }

    for (const statement of claims.slice(0, MAX_PROCESS_CLAIMS))
      facts.push(`本组织流程（组织维基，经审阅）：${statement}`)
    if (facts.length === 0) return null
    return { facts, processReality }
  }

  private async publishedPage(space: WikiSpace, kind: WikiProcessKind) {
    const page = await WikiPage.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .where('slug', wikiProcessSlug(kind))
      .where('page_type', 'process')
      .where('status', 'active')
      .where('sensitivity', 'normal')
      .whereNotNull('published_revision_id')
      .first()
    if (!page) return null
    const revision = await WikiRevision.find(page.publishedRevisionId!)
    return revision ? { page, revision } : null
  }

  private blockOf(revision: WikiRevision, generatorId: string): string {
    const doc = parseWikiMarkdown(revision.bodyMarkdown)
    if (!doc.ok) return ''
    return doc.doc.derivedBlocks.find((b) => b.generatorId === generatorId)?.content ?? ''
  }

  /** 页面里已发布、读者可见、非派生的主张（人写声明或经审阅的解读）。 */
  private async visibleClaims(
    actor: WikiActor,
    page: WikiPage,
    revision: WikiRevision,
  ): Promise<string[]> {
    const claims = await this.read.claimsFor(actor.organizationId, page.id, null)
    const rendered = await this.read.render(actor, revision.bodyMarkdown, claims, true)
    return rendered.claims
      .filter(isVisibleClaim)
      .filter((c) => c.claimKind !== 'derived')
      .map((c) => c.statement)
  }
}
