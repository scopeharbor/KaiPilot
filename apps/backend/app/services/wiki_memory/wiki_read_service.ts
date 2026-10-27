/**
 * v3-llm-wiki-memory-foundation —— 维基读取：页面视图（读时遮蔽、时点查询）、列表、修订、审阅队列、日志、检索。
 *
 * 遮蔽在本服务完成：主张任一来源对读者不可见 → 该主张整行替换为占位、脚注删除，
 * 响应只给布尔值 hasMaskedContent，不给条数、来源标题、来源数量或哈希。
 * 已撤回主张不在正文中显示。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  WIKI_SYSTEM_PAGE_TYPES,
  maskWikiBody,
  parseWikiMarkdown,
  removeWikiClaim,
  type WikiClaimDto,
  type WikiLogEntryDto,
  type WikiMaskedClaimDto,
  type WikiPageSummaryDto,
  type WikiPageViewDto,
  type WikiReviewQueueItemDto,
  type WikiRevisionDetailDto,
  type WikiRevisionDto,
  type WikiSourceRef,
} from '@aiproj/types'
import WikiClaim from '#models/wiki_claim'
import WikiClaimSource from '#models/wiki_claim_source'
import WikiLogEntry from '#models/wiki_log_entry'
import WikiPage from '#models/wiki_page'
import WikiRevision from '#models/wiki_revision'
import WikiSpace from '#models/wiki_space'
import WikiAccessService, { type WikiActor } from './wiki_access_service.js'
import WikiSourceRegistry, { sourceKey } from './wiki_source_registry.js'
import WikiSpaceService from './wiki_space_service.js'
import { WikiNotFoundError, WikiPermissionError } from './errors.js'

const iso = (d: DateTime | null | undefined) => (d ? d.toUTC().toISO() : null)

export function revisionDto(r: WikiRevision): WikiRevisionDto {
  return {
    id: r.id,
    pageId: r.pageId,
    baseRevisionId: r.baseRevisionId,
    authorKind: r.authorKind,
    authorUserId: r.authorUserId,
    editClass: r.editClass,
    status: r.status,
    changeSummary: r.changeSummary,
    reviewedBy: r.reviewedBy,
    reviewedAt: iso(r.reviewedAt),
    rejectReason: r.rejectReason,
    createdAt: iso(r.createdAt)!,
  }
}

interface Paged<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

function paged<T>(all: T[], page: number, perPage: number): Paged<T> {
  const start = (page - 1) * perPage
  return {
    data: all.slice(start, start + perPage),
    meta: {
      total: all.length,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(all.length / perPage)),
    },
  }
}

@inject()
export default class WikiReadService {
  constructor(
    private readonly access: WikiAccessService,
    private readonly spaces: WikiSpaceService,
    private readonly sources: WikiSourceRegistry,
  ) {}

  /** 读取页面及其空间；不可读 → 404。 */
  async loadReadablePage(
    actor: WikiActor,
    pageId: number,
  ): Promise<{ page: WikiPage; space: WikiSpace }> {
    const page = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('id', pageId)
      .first()
    if (!page) throw new WikiNotFoundError()
    const space = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('id', page.spaceId)
      .first()
    if (!space || !(await this.access.canReadPage(actor, space, page)))
      throw new WikiNotFoundError()
    return { page, space }
  }

  private async pendingPageIds(organizationId: number, pageIds: number[]): Promise<Set<number>> {
    if (pageIds.length === 0) return new Set()
    const rows = await db
      .from('wiki_revisions')
      .where('organization_id', organizationId)
      .whereIn('page_id', pageIds)
      .where('status', 'proposed')
      .distinct('page_id')
    return new Set(rows.map((r) => Number(r.page_id)))
  }

  summaryDto(page: WikiPage, pending: boolean): WikiPageSummaryDto {
    return {
      id: page.id,
      spaceId: page.spaceId,
      slug: page.slug,
      title: page.title,
      pageType: page.pageType,
      summaryLine: page.summaryLine,
      status: page.status,
      publishedRevisionId: page.publishedRevisionId,
      hasPendingProposal: pending,
      updatedAt: iso(page.updatedAt)!,
    }
  }

  async listPages(actor: WikiActor, spaceId: number, pageNo: number, perPage: number) {
    const space = await this.spaces.getReadable(actor, spaceId)
    const canReview = await this.access.canReviewSpace(actor, space)
    const pages = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .where('status', 'active')
      .if(!canReview, (q) => q.where('sensitivity', 'normal'))
      .orderBy('title', 'asc')
      .orderBy('id', 'asc')
    const pending = canReview
      ? await this.pendingPageIds(
          actor.organizationId,
          pages.map((p) => p.id),
        )
      : new Set<number>()
    return paged(
      pages.map((p) => this.summaryDto(p, pending.has(p.id))),
      pageNo,
      perPage,
    )
  }

  /** 页面视图；asOf 给出时返回该时间点已发布的版本与当时有效的主张。 */
  async getPageView(
    actor: WikiActor,
    pageId: number,
    asOf: DateTime | null,
  ): Promise<WikiPageViewDto> {
    const { page, space } = await this.loadReadablePage(actor, pageId)
    const canReview = await this.access.canReviewSpace(actor, space)
    const canPropose = await this.access.canProposeInSpace(actor, space)

    const revision = asOf
      ? await WikiRevision.query()
          .where('organization_id', actor.organizationId)
          .where('page_id', page.id)
          .whereIn('status', ['published', 'superseded'])
          .where('reviewed_at', '<=', asOf.toSQL()!)
          .orderBy('reviewed_at', 'desc')
          .orderBy('id', 'desc')
          .first()
      : page.publishedRevisionId
        ? await WikiRevision.find(page.publishedRevisionId)
        : null

    const claims = await this.claimsFor(actor.organizationId, page.id, asOf)
    const masked = await this.render(actor, revision?.bodyMarkdown ?? null, claims, asOf === null)

    const pendingSet = canReview
      ? await this.pendingPageIds(actor.organizationId, [page.id])
      : new Set<number>()
    const pendingSelf = pendingSet.has(page.id)
    const isOwner = space.scopeKind === 'user' && Number(space.scopeRefId) === Number(actor.user.id)
    return {
      page: this.summaryDto(page, pendingSelf),
      revision: revision
        ? {
            id: revision.id,
            authorKind: revision.authorKind,
            editClass: revision.editClass,
            createdAt: iso(revision.createdAt)!,
            reviewedAt: iso(revision.reviewedAt),
          }
        : null,
      body: masked.body,
      claims: masked.claims,
      hasMaskedContent: masked.hasMaskedContent,
      outgoingLinks: await this.linksFor(actor, space, masked.linkSlugs),
      canReview,
      canEdit: canPropose && !WIKI_SYSTEM_PAGE_TYPES.includes(page.pageType),
      sharedWithProjectIds: isOwner ? (page.sharedWithProjectIds ?? []) : null,
      asOf: asOf ? iso(asOf) : null,
    }
  }

  /** 当前（asOf=null）：有效主张；时点：当时已记录且尚未被取代的主张。 */
  async claimsFor(
    organizationId: number,
    pageId: number,
    asOf: DateTime | null,
  ): Promise<WikiClaim[]> {
    const q = WikiClaim.query().where('organization_id', organizationId).where('page_id', pageId)
    if (asOf) {
      q.where('recorded_at', '<=', asOf.toSQL()!).where((w) =>
        w.whereNull('superseded_at').orWhere('superseded_at', '>', asOf.toSQL()!),
      )
    } else {
      q.whereIn('status', ['active', 'retracted'])
    }
    return q.orderBy('id', 'asc')
  }

  /** 遮蔽 + 去除已撤回主张 + 去 frontmatter。 */
  async render(
    actor: WikiActor,
    source: string | null,
    claims: WikiClaim[],
    current: boolean,
  ): Promise<{
    body: string
    claims: Array<WikiClaimDto | WikiMaskedClaimDto>
    hasMaskedContent: boolean
    linkSlugs: string[]
  }> {
    if (source === null) return { body: '', claims: [], hasMaskedContent: false, linkSlugs: [] }
    const sourceRows = claims.length
      ? await WikiClaimSource.query()
          .where('organization_id', actor.organizationId)
          .whereIn(
            'claim_id',
            claims.map((c) => c.id),
          )
      : []
    const refsOf = (claimId: number): WikiSourceRef[] =>
      sourceRows
        .filter((s) => s.claimId === claimId)
        .map((s) => ({ kind: s.sourceKind, id: s.sourceId, version: s.sourceVersion }))
    const visibility = await this.sources.resolveVisibility(
      actor,
      sourceRows.map((s) => ({ kind: s.sourceKind, id: s.sourceId, version: s.sourceVersion })),
    )

    // 正文里出现、但没有对应主张行可判权的标记一律遮蔽（fail closed）
    const parsed = parseWikiMarkdown(source)
    const keysInBody = parsed.ok ? parsed.doc.claims.map((c) => c.key) : []
    const claimByKey = new Map(claims.map((c) => [c.claimKey, c]))
    const maskedKeys = new Set<string>()
    const retractedKeys = new Set<string>()
    for (const key of keysInBody) {
      const claim = claimByKey.get(key)
      if (!claim) {
        maskedKeys.add(key)
        continue
      }
      if (current && claim.status === 'retracted') {
        retractedKeys.add(key)
        continue
      }
      const refs = refsOf(claim.id)
      if (refs.length === 0 || refs.some((r) => !visibility.get(sourceKey(r))?.visible))
        maskedKeys.add(key)
    }

    let text = source
    for (const key of retractedKeys) text = removeWikiClaim(text, key)
    text = maskWikiBody(text, maskedKeys)
    const reparsed = parseWikiMarkdown(text)
    const body = reparsed.ok ? reparsed.doc.body : text.replace(/^---\n[\s\S]*?\n---\n?/, '')

    const dtos: Array<WikiClaimDto | WikiMaskedClaimDto> = []
    for (const key of keysInBody) {
      if (retractedKeys.has(key)) continue
      if (maskedKeys.has(key)) {
        dtos.push({ claimKey: key, masked: true })
        continue
      }
      const c = claimByKey.get(key)!
      dtos.push({
        id: c.id,
        claimKey: c.claimKey,
        statement: c.statement,
        claimKind: c.claimKind,
        status: c.status,
        validFrom: iso(c.validFrom),
        validTo: iso(c.validTo),
        recordedAt: iso(c.recordedAt)!,
        supersededAt: iso(c.supersededAt),
        evidenceCount: c.evidenceCount,
        invalidReason: c.invalidReason,
        sources: refsOf(c.id).map((r) => ({
          kind: r.kind,
          id: r.id,
          version: r.version,
          label: visibility.get(sourceKey(r))!.label,
        })),
      })
    }
    return {
      body,
      claims: dtos,
      hasMaskedContent: maskedKeys.size > 0,
      linkSlugs: reparsed.ok ? [...new Set(reparsed.doc.links.map((l) => l.slug))] : [],
    }
  }

  private async linksFor(actor: WikiActor, space: WikiSpace, slugs: string[]) {
    if (slugs.length === 0) return []
    const targets = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .whereIn('slug', slugs)
    const out: WikiPageViewDto['outgoingLinks'] = []
    for (const slug of slugs) {
      const t = targets.find((p) => p.slug === slug)
      const readable = t ? await this.access.canReadPage(actor, space, t) : false
      out.push({ slug, title: readable ? t!.title : null, exists: readable })
    }
    return out
  }

  async listRevisions(actor: WikiActor, pageId: number, pageNo: number, perPage: number) {
    const { page, space } = await this.loadReadablePage(actor, pageId)
    const canReview = await this.access.canReviewSpace(actor, space)
    const rows = await WikiRevision.query()
      .where('organization_id', actor.organizationId)
      .where('page_id', page.id)
      .if(!canReview, (q) => q.whereIn('status', ['published', 'superseded']))
      .orderBy('id', 'desc')
    return paged(rows.map(revisionDto), pageNo, perPage)
  }

  /** 修订详情：审阅者可看全部状态；其余读者只能看已发布过的版本。正文同样遮蔽。 */
  async getRevisionDetail(actor: WikiActor, revisionId: number): Promise<WikiRevisionDetailDto> {
    const revision = await WikiRevision.query()
      .where('organization_id', actor.organizationId)
      .where('id', revisionId)
      .first()
    if (!revision) throw new WikiNotFoundError()
    const { page, space } = await this.loadReadablePage(actor, revision.pageId)
    const canReview = await this.access.canReviewSpace(actor, space)
    const isAuthor =
      revision.authorUserId !== null && Number(revision.authorUserId) === Number(actor.user.id)
    if (!canReview && !isAuthor && !['published', 'superseded'].includes(revision.status)) {
      throw new WikiNotFoundError()
    }
    const base = revision.baseRevisionId
      ? await WikiRevision.query()
          .where('organization_id', actor.organizationId)
          .where('page_id', page.id)
          .where('id', revision.baseRevisionId)
          .first()
      : null
    const maskedBody = await this.maskProposal(actor, revision.bodyMarkdown)
    const maskedBase = base ? await this.maskProposal(actor, base.bodyMarkdown) : null
    return {
      ...revisionDto(revision),
      body: maskedBody.text,
      baseBody: maskedBase?.text ?? null,
      hasMaskedContent: maskedBody.masked || (maskedBase?.masked ?? false),
    }
  }

  /** 提议还没有主张行：直接按正文脚注里的来源判权并遮蔽（保留 frontmatter 便于 diff）。 */
  private async maskProposal(actor: WikiActor, source: string) {
    const parsed = parseWikiMarkdown(source)
    if (!parsed.ok) return { text: source, masked: false }
    const visibility = await this.sources.resolveVisibility(
      actor,
      parsed.doc.claims.flatMap((c) => c.sources),
    )
    const maskedKeys = new Set(
      parsed.doc.claims
        .filter((c) => c.sources.some((s) => !visibility.get(sourceKey(s))?.visible))
        .map((c) => c.key),
    )
    return { text: maskWikiBody(source, maskedKeys), masked: maskedKeys.size > 0 }
  }

  /** 审阅队列：读者能审阅的空间里的待审提议，按页面聚合。 */
  async reviewQueue(actor: WikiActor, spaceId: number | null): Promise<WikiReviewQueueItemDto[]> {
    const proposals = await WikiRevision.query()
      .where('organization_id', actor.organizationId)
      .where('status', 'proposed')
      .orderBy('id', 'asc')
    if (proposals.length === 0) return []
    const pages = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .whereIn('id', [...new Set(proposals.map((p) => p.pageId))])
      .if(spaceId !== null, (q) => q.where('space_id', spaceId!))
    const spaceRows = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .whereIn('id', [...new Set(pages.map((p) => p.spaceId))])
    const reviewable = new Map<number, boolean>()
    for (const s of spaceRows) reviewable.set(s.id, await this.access.canReviewSpace(actor, s))
    const items: WikiReviewQueueItemDto[] = []
    for (const page of pages.sort((a, b) => a.id - b.id)) {
      if (!reviewable.get(page.spaceId)) continue
      items.push({
        page: this.summaryDto(page, true),
        proposals: proposals.filter((p) => p.pageId === page.id).map(revisionDto),
      })
    }
    return items
  }

  async listLog(actor: WikiActor, spaceId: number, pageNo: number, perPage: number) {
    const space = await this.spaces.getReadable(actor, spaceId)
    const query = WikiLogEntry.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .orderBy('id', 'desc')
    const result = await query.paginate(pageNo, perPage)
    const data: WikiLogEntryDto[] = result.all().map((e) => ({
      id: e.id,
      op: e.op,
      line: e.line,
      createdAt: iso(e.createdAt)!,
    }))
    return {
      data,
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: Math.max(1, result.lastPage),
      },
    }
  }

  /** 有界投影检索：标题 > 小标题 > 摘要，不检索正文全文。 */
  async search(actor: WikiActor, spaceId: number, q: string): Promise<WikiPageSummaryDto[]> {
    const space = await this.spaces.getReadable(actor, spaceId)
    const canReview = await this.access.canReviewSpace(actor, space)
    const term = q.trim().slice(0, 100)
    if (!term) return []
    const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    const rows = await db
      .from('wiki_search_entries as e')
      .join('wiki_pages as p', 'p.id', 'e.page_id')
      .where('e.organization_id', actor.organizationId)
      .where('e.space_id', space.id)
      .where('p.status', 'active')
      .if(!canReview, (b) => b.where('p.sensitivity', 'normal'))
      .where((w) =>
        w
          .whereRaw("e.title LIKE ? ESCAPE '\\'", [like])
          .orWhereRaw("e.headings_text LIKE ? ESCAPE '\\'", [like])
          .orWhereRaw("e.summary_line LIKE ? ESCAPE '\\'", [like]),
      )
      .select('e.page_id', 'e.title', 'e.headings_text', 'e.summary_line')
      .limit(200)
    const lower = term.toLowerCase()
    const score = (r: { title: string; headings_text: string; summary_line: string }) =>
      (r.title.toLowerCase().includes(lower) ? 3 : 0) +
      (r.headings_text.toLowerCase().includes(lower) ? 2 : 0) +
      (r.summary_line.toLowerCase().includes(lower) ? 1 : 0)
    const ranked = rows
      .map((r) => ({ id: Number(r.page_id), s: score(r) }))
      .sort((a, b) => b.s - a.s || a.id - b.id)
      .slice(0, 20)
    const pages = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .whereIn(
        'id',
        ranked.map((r) => r.id),
      )
    return ranked
      .map((r) => pages.find((p) => p.id === r.id))
      .filter((p): p is WikiPage => !!p && !WIKI_SYSTEM_PAGE_TYPES.includes(p.pageType))
      .map((p) => this.summaryDto(p, false))
  }

  async assertReviewer(actor: WikiActor, space: WikiSpace) {
    if (!(await this.access.canReviewSpace(actor, space))) throw new WikiPermissionError()
  }
}
