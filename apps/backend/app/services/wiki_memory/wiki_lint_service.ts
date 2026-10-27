/**
 * v3-llm-wiki-memory-foundation —— 确定性簿记体检（不调用任何模型）。
 *
 * 自动修复（簿记修改）：断链改纯文字、目录漂移重建、来源已删除的主张关闭有效期。
 * 只记发现：孤页、过期页。发现按 dedupe_key 去重，问题消失后标为 fixed。
 *
 * v3-llm-wiki-lint-consolidation：墓碑兜底（仍有效但命中墓碑的主张走撤回级联）、矛盾发现复核（任一主张失效即已解决）、
 * 「未再出现即已解决」只作用于确定性发现类型；审阅者可忽略发现（不再重新打开）。
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import {
  WIKI_DEFAULT_STALE_AFTER_DAYS,
  WIKI_LINT_DETERMINISTIC_KINDS,
  WIKI_SYSTEM_PAGE_TYPES,
  parseWikiMarkdown,
  unlinkWikiSlugs,
  type WikiLintFindingDto,
  type WikiLintFindingKind,
} from '@aiproj/types'
import WikiClaim from '#models/wiki_claim'
import WikiClaimSource from '#models/wiki_claim_source'
import WikiLink from '#models/wiki_link'
import WikiLintFinding from '#models/wiki_lint_finding'
import WikiPage from '#models/wiki_page'
import WikiRetraction from '#models/wiki_retraction'
import WikiRevision from '#models/wiki_revision'
import WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from './wiki_access_service.js'
import WikiRetractionService from './wiki_retraction_service.js'
import WikiRevisionService from './wiki_revision_service.js'
import WikiSourceRegistry, { sourceKey } from './wiki_source_registry.js'
import WikiSpaceService from './wiki_space_service.js'
import { WikiError, WikiNotFoundError, WikiPermissionError } from './errors.js'

export interface WikiLintSummary {
  fixedBrokenLinks: number
  closedClaims: number
  indexRefreshed: boolean
  orphanPages: number
  stalePages: number
  /** 仍有效但命中墓碑、本轮置为撤回的主张数。 */
  retractedClaims: number
  /** 本轮因主张失效而解决的矛盾发现数。 */
  resolvedContradictions: number
}

@inject()
export default class WikiLintService {
  constructor(
    private readonly revisions: WikiRevisionService,
    private readonly sources: WikiSourceRegistry,
    private readonly audit: AuditService,
    private readonly retractions: WikiRetractionService,
    private readonly spaces: WikiSpaceService,
    private readonly access: WikiAccessService,
  ) {}

  async run(
    space: WikiSpace,
    actor: WikiActor | null,
    now = DateTime.now(),
  ): Promise<WikiLintSummary> {
    const org = space.organizationId
    const pages = await WikiPage.query()
      .where('organization_id', org)
      .where('space_id', space.id)
      .where('status', 'active')
    const contentPages = pages.filter((p) => !WIKI_SYSTEM_PAGE_TYPES.includes(p.pageType))
    const slugs = new Set(pages.map((p) => p.slug))
    const seenKeys = new Set<string>()
    const summary: WikiLintSummary = {
      fixedBrokenLinks: 0,
      closedClaims: 0,
      indexRefreshed: false,
      orphanPages: 0,
      stalePages: 0,
      retractedClaims: 0,
      resolvedContradictions: 0,
    }

    // 0. 墓碑兜底：仍有效但命中墓碑的主张（墓碑写入前已存在的历史内容）走撤回级联
    summary.retractedClaims = await this.backstopRetractions(space, contentPages, seenKeys)

    // 1. 断链：改为纯文字（语义文本不变 → 簿记修改，系统直接发布）
    for (const page of contentPages) {
      if (!page.publishedRevisionId) continue
      const revision = await WikiRevision.find(page.publishedRevisionId)
      if (!revision) continue
      const parsed = parseWikiMarkdown(revision.bodyMarkdown)
      if (!parsed.ok) continue
      const missing = new Set(parsed.doc.links.map((l) => l.slug).filter((s) => !slugs.has(s)))
      if (missing.size === 0) continue
      try {
        const proposal = await this.revisions.proposeRevision({
          page,
          space,
          body: unlinkWikiSlugs(revision.bodyMarkdown, missing),
          authorKind: 'system',
          authorUserId: null,
          baseRevisionId: page.publishedRevisionId,
          changeSummary: `体检：清理 ${missing.size} 个断链`,
        })
        if (proposal.editClass === 'bookkeeping') {
          await this.revisions.publish(proposal.id, org, { kind: 'system' })
          summary.fixedBrokenLinks += missing.size
          await this.record(
            space,
            page.id,
            'broken_link',
            `broken:${page.id}`,
            'fixed',
            {
              count: missing.size,
            },
            seenKeys,
          )
        }
      } catch (error) {
        // 页面里有来源已删除或命中撤回的主张时，簿记修复无法通过写入校验：留给第 2 步与人工处理
        if (!(error instanceof WikiError)) throw error
      }
      await page.refresh()
    }

    // 2. 来源已删除：关闭主张有效期并标记
    const activeClaims = await WikiClaim.query()
      .where('organization_id', org)
      .whereIn(
        'page_id',
        contentPages.map((p) => p.id),
      )
      .where('status', 'active')
      .whereNull('invalid_reason')
    if (activeClaims.length > 0) {
      const sourceRows = await WikiClaimSource.query()
        .where('organization_id', org)
        .whereIn(
          'claim_id',
          activeClaims.map((c) => c.id),
        )
      const missing = await this.sources.findMissing(
        org,
        sourceRows.map((s) => ({ kind: s.sourceKind, id: s.sourceId, version: s.sourceVersion })),
      )
      for (const claim of activeClaims) {
        const gone = sourceRows.some(
          (s) =>
            s.claimId === claim.id &&
            missing.has(sourceKey({ kind: s.sourceKind, id: s.sourceId })),
        )
        if (!gone) continue
        claim.validTo = claim.validTo && claim.validTo < now ? claim.validTo : now
        claim.invalidReason = 'source_deleted'
        await claim.save()
        summary.closedClaims += 1
        await this.record(
          space,
          claim.pageId,
          'source_deleted',
          `source:${claim.id}`,
          'fixed',
          {
            claimKey: claim.claimKey,
          },
          seenKeys,
        )
      }
    }

    // 3. 目录漂移
    summary.indexRefreshed = await this.revisions.refreshIndex(space)
    if (summary.indexRefreshed) {
      await this.record(space, null, 'index_drift', 'index', 'fixed', {}, seenKeys)
    }

    // 4. 孤页（除目录外没有任何页面链接到它）
    const incoming = await WikiLink.query()
      .where('organization_id', org)
      .whereIn(
        'to_page_id',
        contentPages.map((p) => p.id),
      )
      .whereIn(
        'from_page_id',
        contentPages.map((p) => p.id),
      )
    const linked = new Set(incoming.map((l) => l.toPageId))
    for (const page of contentPages) {
      if (!page.publishedRevisionId) continue
      const key = `orphan:${page.id}`
      if (!linked.has(page.id) && contentPages.length > 1) {
        summary.orphanPages += 1
        await this.record(space, page.id, 'orphan_page', key, 'open', { slug: page.slug }, seenKeys)
      }
    }

    // 5. 过期页
    for (const page of contentPages) {
      if (!page.lastPublishedAt) continue
      const days = page.staleAfterDays ?? WIKI_DEFAULT_STALE_AFTER_DAYS
      if (page.lastPublishedAt.plus({ days }) < now) {
        summary.stalePages += 1
        await this.record(
          space,
          page.id,
          'stale_page',
          `stale:${page.id}`,
          'open',
          { days },
          seenKeys,
        )
      }
    }

    // 6. 矛盾发现复核：任一主张已不存在或不再有效 → 已解决
    summary.resolvedContradictions = await this.reviewContradictions(space, now)

    // 本轮未再出现的确定性 open 发现视为已解决（AI 矛盾发现不在此列）
    await WikiLintFinding.query()
      .where('organization_id', org)
      .where('space_id', space.id)
      .where('status', 'open')
      .whereIn('finding_kind', [...WIKI_LINT_DETERMINISTIC_KINDS])
      .if(seenKeys.size > 0, (q) => q.whereNotIn('dedupe_key', [...seenKeys]))
      .update({ status: 'fixed', updated_at: now.toSQL() })

    await this.revisions.appendLog(
      null,
      space,
      'lint',
      `体检：断链 ${summary.fixedBrokenLinks}，关闭主张 ${summary.closedClaims}，孤页 ${summary.orphanPages}，过期 ${summary.stalePages}，墓碑兜底 ${summary.retractedClaims}，矛盾已解决 ${summary.resolvedContradictions}`,
      actor ? 'human' : 'system',
      actor?.user.id ?? null,
      null,
    )
    if (actor) {
      await this.audit.log({
        event: AuditEvent.WIKI_LINT_RUN,
        userId: actor.user.id,
        organizationId: org,
        entityType: 'wiki_space',
        entityId: space.id,
        metadata: { ...summary },
      })
    }
    return summary
  }

  private async backstopRetractions(
    space: WikiSpace,
    contentPages: readonly WikiPage[],
    seen: Set<string>,
  ): Promise<number> {
    if (contentPages.length === 0) return 0
    const tombstoneSpaces = [space.id]
    if (space.scopeKind === 'project' || space.scopeKind === 'department') {
      const orgSpaceId = await this.spaces.organizationSpaceId(space.organizationId)
      if (orgSpaceId) tombstoneSpaces.push(orgSpaceId)
    }
    const live = await WikiClaim.query()
      .where('organization_id', space.organizationId)
      .whereIn(
        'page_id',
        contentPages.map((p) => p.id),
      )
      .where('status', 'active')
      .whereIn(
        'fingerprint',
        WikiRetraction.query()
          .where('organization_id', space.organizationId)
          .whereIn('space_id', tombstoneSpaces)
          .select('claim_fingerprint'),
      )
    let total = 0
    for (const fingerprint of new Set(live.map((c) => c.fingerprint))) {
      const result = await this.retractions.cascade(space, fingerprint, '体检：移除已撤回的说法')
      total += result.claims
    }
    for (const claim of live) {
      await this.record(
        space,
        claim.pageId,
        'retracted_claim',
        `retracted:${claim.id}`,
        'fixed',
        { claimKey: claim.claimKey },
        seen,
      )
    }
    return total
  }

  private async reviewContradictions(space: WikiSpace, now: DateTime): Promise<number> {
    const open = await WikiLintFinding.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .where('finding_kind', 'contradiction')
      .where('status', 'open')
    if (open.length === 0) return 0
    const ids = open.flatMap((f) => [Number(f.detail?.claimA), Number(f.detail?.claimB)])
    const validRows = await WikiClaim.query()
      .where('organization_id', space.organizationId)
      .whereIn('id', ids.filter(Number.isFinite))
      .where('status', 'active')
      .whereNull('invalid_reason')
      .select('id')
    const valid = new Set(validRows.map((c) => c.id))
    let resolved = 0
    for (const f of open) {
      if (valid.has(Number(f.detail?.claimA)) && valid.has(Number(f.detail?.claimB))) continue
      f.status = 'fixed'
      f.updatedAt = now
      await f.save()
      resolved++
    }
    return resolved
  }

  /** 记录 AI 矛盾体检的发现（已忽略的不重新打开）。 */
  async recordContradiction(
    space: WikiSpace,
    pageId: number,
    dedupeKey: string,
    detail: Record<string, string | number>,
  ): Promise<void> {
    await this.record(space, pageId, 'contradiction', dedupeKey, 'open', detail, new Set())
  }

  /** 审阅者忽略一条发现；之后的体检不会重新打开它。 */
  async dismiss(actor: WikiActor, findingId: number): Promise<WikiLintFindingDto> {
    const finding = await WikiLintFinding.query()
      .where('organization_id', actor.organizationId)
      .where('id', findingId)
      .first()
    if (!finding) throw new WikiNotFoundError()
    const space = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('id', finding.spaceId)
      .first()
    if (!space || !(await this.access.canReadSpace(actor, space))) throw new WikiNotFoundError()
    if (!(await this.access.canReviewSpace(actor, space)))
      throw new WikiPermissionError('只有本空间的审阅者可以忽略体检发现')
    finding.status = 'dismissed'
    await finding.save()
    await this.audit.log({
      event: AuditEvent.WIKI_LINT_FINDING_DISMISSED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_lint_finding',
      entityId: finding.id,
      metadata: { spaceId: space.id, findingKind: finding.findingKind },
    })
    return findingDto(finding)
  }

  private async record(
    space: WikiSpace,
    pageId: number | null,
    kind: WikiLintFindingKind,
    dedupeKey: string,
    status: 'open' | 'fixed',
    detail: Record<string, string | number>,
    seen: Set<string>,
  ) {
    if (status === 'open') seen.add(dedupeKey)
    const existing = await WikiLintFinding.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .where('dedupe_key', dedupeKey)
      .first()
    if (existing) {
      if (existing.status === 'dismissed' && status === 'open') return
      existing.merge({ status, detail, findingKind: kind, pageId })
      await existing.save()
      return
    }
    await WikiLintFinding.create({
      organizationId: space.organizationId,
      spaceId: space.id,
      pageId,
      findingKind: kind,
      status,
      dedupeKey,
      detail,
    })
  }

  async list(space: WikiSpace, status: 'open' | 'all'): Promise<WikiLintFindingDto[]> {
    const rows = await WikiLintFinding.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .if(status === 'open', (q) => q.where('status', 'open'))
      .orderBy('id', 'desc')
      .limit(500)
    return rows.map(findingDto)
  }
}

function findingDto(f: WikiLintFinding): WikiLintFindingDto {
  return {
    id: f.id,
    pageId: f.pageId,
    findingKind: f.findingKind,
    status: f.status,
    detail: f.detail ?? {},
    createdAt: f.createdAt.toUTC().toISO()!,
  }
}
