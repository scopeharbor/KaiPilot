/**
 * v3-llm-wiki-planning-dossier —— 计划档案：参照类页与打法页的确定性刷新，以及草案生成读取。
 *
 * 刷新：统计复用 planning_memory（已完成任务实际工作日、同类已转正草案的删补任务与阶段），
 * 写页交给共用的派生页写入器：新建纯派生页与只替换派生段的修订都按簿记由系统发布；人写的「解读」原样保留；统计不变不提交。
 * 读取：组织已开启维基时取已发布档案页（本类优先，没有则全组织），解析派生段，并附页面中读者可见的非派生主张。
 */
import { inject } from '@adonisjs/core'
import {
  WIKI_DOSSIER_CLASSES,
  WIKI_PLAYBOOK_GENERATOR,
  WIKI_REFERENCE_CLASS_GENERATOR,
  computeWikiReferenceClass,
  parseWikiMarkdown,
  parseWikiPlaybookBlock,
  parseWikiReferenceClassBlock,
  renderWikiPlaybookBlock,
  renderWikiReferenceClassBlock,
  wikiDossierClassFor,
  wikiDossierPageBody,
  wikiDossierSlug,
  wikiPlaybookHasContent,
  type ProjectType,
  type WikiDerivedBlockRender,
  type WikiDossierClass,
  type WikiDossierKind,
  type WikiDossierRefreshSummary,
  type WikiReferenceClassForDraft,
} from '@aiproj/types'
import WikiPage from '#models/wiki_page'
import WikiRevision from '#models/wiki_revision'
import WikiSpace from '#models/wiki_space'
import {
  clampFactor,
  collectExecutionSamples,
  recallEdits,
} from '#services/ai_draft/planning_memory'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import WikiReadService from '../wiki_read_service.js'
import WikiDerivedPageWriter from '../wiki_derived_page_writer.js'
import WikiSettingsService from '../wiki_settings_service.js'
import WikiSpaceService from '../wiki_space_service.js'
import { WikiPermissionError } from '../errors.js'
import { isVisibleClaim } from '../query/wiki_query_service.js'

const GENERATOR: Record<WikiDossierKind, string> = {
  'reference-class': WIKI_REFERENCE_CLASS_GENERATOR,
  playbook: WIKI_PLAYBOOK_GENERATOR,
}
const KEY_PREFIX: Record<WikiDossierKind, string> = { 'reference-class': 'rc-', playbook: 'pb-' }
const MAX_EXPERIENCE_CLAIMS = 5

export interface WikiDraftDossier {
  facts: string[]
  durationFactor: { factor: number; basis: string } | null
  referenceClass: WikiReferenceClassForDraft | null
}

@inject()
export default class WikiPlanningDossierService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly spaces: WikiSpaceService,
    private readonly access: WikiAccessService,
    private readonly writer: WikiDerivedPageWriter,
    private readonly read: WikiReadService,
    private readonly audit: AuditService,
  ) {}

  // ── 刷新 ───────────────────────────────────────────────────────────────

  async refresh(actor: WikiActor): Promise<WikiDossierRefreshSummary> {
    await this.settings.assertEnabled(actor.organizationId)
    const space = await this.spaces.resolve(actor, 'organization', actor.organizationId)
    if (!(await this.access.canReviewSpace(actor, space)))
      throw new WikiPermissionError('只有组织维基的审阅者可以刷新计划档案')

    const summary: WikiDossierRefreshSummary = { created: 0, updated: 0, unchanged: 0, skipped: 0 }
    for (const cls of WIKI_DOSSIER_CLASSES) {
      const projectType = cls === 'all' ? null : cls
      const rc = computeWikiReferenceClass(
        await collectExecutionSamples(actor.organizationId, projectType),
      )
      if (rc)
        await this.upsert(
          actor,
          space,
          'reference-class',
          cls,
          renderWikiReferenceClassBlock(rc),
          summary,
        )
      else summary.skipped++

      const edits = await recallEdits(actor.organizationId, projectType)
      const playbook = {
        drafts: edits.confirmedDrafts,
        removed: edits.removedTasks,
        added: edits.addedTasks,
        phases: edits.preferredPhases,
      }
      if (playbook.drafts > 0 && wikiPlaybookHasContent(playbook))
        await this.upsert(actor, space, 'playbook', cls, renderWikiPlaybookBlock(playbook), summary)
      else summary.skipped++
    }

    await this.audit.log({
      event: AuditEvent.WIKI_DOSSIER_REFRESHED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_space',
      entityId: space.id,
      metadata: { ...summary },
    })
    return summary
  }

  private async upsert(
    actor: WikiActor,
    space: WikiSpace,
    kind: WikiDossierKind,
    cls: WikiDossierClass,
    block: WikiDerivedBlockRender,
    summary: WikiDossierRefreshSummary,
  ): Promise<void> {
    await this.writer.upsert(
      actor,
      space,
      {
        slug: wikiDossierSlug(kind, cls),
        pageType: kind,
        generatorId: GENERATOR[kind],
        keyPrefix: KEY_PREFIX[kind],
        block,
        fullBody: () => wikiDossierPageBody(kind, cls, block),
        label: '计划档案',
      },
      summary,
    )
  }

  // ── 草案读取 ───────────────────────────────────────────────────────────

  async dossierForDraft(
    actor: WikiActor,
    projectType: ProjectType | null,
  ): Promise<WikiDraftDossier | null> {
    if (!(await this.settings.isEnabled(actor.organizationId))) return null
    const spaceId = await this.spaces.organizationSpaceId(actor.organizationId)
    if (spaceId === null) return null
    const space = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('id', spaceId)
      .firstOrFail()
    if (!(await this.access.canReadSpace(actor, space))) return null

    const cls = wikiDossierClassFor(projectType)
    const rcPage = await this.pickPage(space, 'reference-class', cls)
    const pbPage = await this.pickPage(space, 'playbook', cls)
    if (!rcPage && !pbPage) return null

    const facts: string[] = []
    let durationFactor: WikiDraftDossier['durationFactor'] = null
    let referenceClass: WikiReferenceClassForDraft | null = null
    const experience: string[] = []

    if (rcPage) {
      const rc = parseWikiReferenceClassBlock(
        this.blockOf(rcPage.revision, WIKI_REFERENCE_CLASS_GENERATOR),
      )
      if (rc) {
        const title = rcPage.page.title
        facts.push(
          `本组织同类已完成任务的实际用时约为计划的 ${rc.bias} 倍，实际用时中位数 ${rc.actualP50Days} 个工作日、P80 ${rc.actualP80Days} 个工作日（组织维基「${title}」，${rc.samples} 个样本），估算工作量时考虑这一偏差`,
        )
        const factor = clampFactor(rc.bias)
        if (Math.abs(factor - 1) >= 0.05)
          durationFactor = { factor, basis: `依据：参照类「${title}」· ${rc.samples} 个样本` }
        referenceClass = {
          label: title,
          samples: rc.samples,
          p50Days: rc.actualP50Days,
          p80Days: rc.actualP80Days,
        }
      }
      experience.push(...(await this.experienceClaims(actor, rcPage.page, rcPage.revision)))
    }
    if (pbPage) {
      const pb = parseWikiPlaybookBlock(this.blockOf(pbPage.revision, WIKI_PLAYBOOK_GENERATOR))
      const source = `（组织维基「${pbPage.page.title}」，${pb?.drafts ?? 0} 份已转正草案）`
      if (pb?.removed.length)
        facts.push(
          `用户过去转正同类计划时删掉过这些 AI 生成的任务（没有明确理由就不要默认加入）：${pb.removed.join('、')}${source}`,
        )
      if (pb?.added.length)
        facts.push(
          `用户过去在项目里自己补上过这些任务（AI 当时漏了，这次判断是否同样需要）：${pb.added.join('、')}${source}`,
        )
      if (pb?.phases.length)
        facts.push(`同类已转正项目常用的一级阶段：${pb.phases.join('、')}${source}`)
      experience.push(...(await this.experienceClaims(actor, pbPage.page, pbPage.revision)))
    }
    for (const statement of experience.slice(0, MAX_EXPERIENCE_CLAIMS))
      facts.push(`本组织经验（组织维基，经审阅）：${statement}`)

    if (facts.length === 0 && !durationFactor && !referenceClass) return null
    return { facts, durationFactor, referenceClass }
  }

  private async pickPage(space: WikiSpace, kind: WikiDossierKind, cls: WikiDossierClass) {
    for (const c of cls === 'all' ? (['all'] as const) : ([cls, 'all'] as const)) {
      const page = await WikiPage.query()
        .where('organization_id', space.organizationId)
        .where('space_id', space.id)
        .where('slug', wikiDossierSlug(kind, c))
        .where('status', 'active')
        .where('sensitivity', 'normal')
        .whereNotNull('published_revision_id')
        .first()
      if (!page) continue
      const revision = await WikiRevision.find(page.publishedRevisionId!)
      if (revision) return { page, revision }
    }
    return null
  }

  private blockOf(revision: WikiRevision, generatorId: string): string {
    const doc = parseWikiMarkdown(revision.bodyMarkdown)
    if (!doc.ok) return ''
    return doc.doc.derivedBlocks.find((b) => b.generatorId === generatorId)?.content ?? ''
  }

  /** 页面里已发布、读者可见、非派生的主张（人写或经审阅的解读）。 */
  private async experienceClaims(
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
