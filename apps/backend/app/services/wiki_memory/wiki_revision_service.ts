/**
 * v3-llm-wiki-memory-foundation —— 修订与唯一转正门（design D2/D3/D5/D7）。
 *
 * - proposeRevision：解析校验 → 来源校验 → 撤回墓碑 → 服务端判定簿记/知识 → 落为 proposed；
 * - publish：**唯一**把修订置为 published、写 wiki_pages.published_revision_id 的入口（架构测试守护）；
 *   乐观并发（基线修订必须等于当前已发布修订）、主张双时态同步、链接与检索投影重建、日志、审计；
 * - 簿记修改可由系统直接发布；知识修改必须由有审阅权的人发布；
 * - 目录页由系统按已发布页面确定性生成，以簿记修改刷新。
 */
import { createHash } from 'node:crypto'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import {
  WIKI_SYSTEM_PAGE_TYPES,
  classifyWikiRevision,
  isValidWikiSlug,
  isWikiPageType,
  normalizeWikiClaimStatement,
  parseWikiMarkdown,
  renderWikiIndex,
  renderWikiLogLine,
  renderWikiMarkdown,
  truncateWikiSummary,
  type WikiAuthorKind,
  type WikiLogOp,
  type WikiParsedClaim,
  type WikiParsedDocument,
} from '@aiproj/types'
import WikiClaim from '#models/wiki_claim'
import WikiClaimSource from '#models/wiki_claim_source'
import WikiLink from '#models/wiki_link'
import WikiLogEntry from '#models/wiki_log_entry'
import WikiPage from '#models/wiki_page'
import WikiRetraction from '#models/wiki_retraction'
import WikiRevision from '#models/wiki_revision'
import WikiSearchEntry from '#models/wiki_search_entry'
import type WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from './wiki_access_service.js'
import { WIKI_REGISTERED_GENERATORS } from './wiki_generators.js'
import WikiSourceRegistry from './wiki_source_registry.js'
import WikiSpaceService from './wiki_space_service.js'
import {
  WikiConflictError,
  WikiNotFoundError,
  WikiPermissionError,
  WikiRetractedClaimError,
  WikiValidationError,
} from './errors.js'

export const WIKI_INDEX_SLUG = '_index'

export type WikiReviewer = { kind: 'system' } | { kind: 'user'; actor: WikiActor }

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const claimFingerprint = (statement: string) =>
  sha256(normalizeWikiClaimStatement(statement))

export function parseOrThrow(body: string): WikiParsedDocument {
  const r = parseWikiMarkdown(body)
  if (!r.ok) throw new WikiValidationError('页面内容无法解析', r.errors)
  return r.doc
}

const toDate = (d: string | null) => (d ? DateTime.fromISO(d, { zone: 'utc' }) : null)

function canonicalClaim(c: {
  statement: string
  claimKind: string
  validFrom: DateTime | null
  validTo: DateTime | null
  sources: Array<{ kind: string; id: string; version: string | null }>
}): string {
  return [
    c.statement,
    c.claimKind,
    c.validFrom?.toISODate() ?? '',
    c.validTo?.toISODate() ?? '',
    c.sources
      .map((s) => `${s.kind}#${s.id}@${s.version ?? ''}`)
      .sort()
      .join(','),
  ].join('\u0001')
}

const parsedCanonical = (c: WikiParsedClaim) =>
  canonicalClaim({
    statement: c.statement,
    claimKind: c.kind,
    validFrom: toDate(c.validFrom),
    validTo: toDate(c.validTo),
    sources: c.sources,
  })

export interface ProposeInput {
  page: WikiPage
  space: WikiSpace
  body: string
  authorKind: WikiAuthorKind
  authorUserId: number | null
  baseRevisionId: number | null
  changeSummary: string
}

@inject()
export default class WikiRevisionService {
  constructor(
    private readonly access: WikiAccessService,
    private readonly sources: WikiSourceRegistry,
    private readonly spaces: WikiSpaceService,
    private readonly audit: AuditService,
  ) {}

  // ── 提议 ───────────────────────────────────────────────────────────────

  async proposeRevision(input: ProposeInput): Promise<WikiRevision> {
    const { page, space } = input
    const systemPage = WIKI_SYSTEM_PAGE_TYPES.includes(page.pageType)
    if (systemPage && input.authorKind !== 'system') {
      throw new WikiPermissionError('目录与操作日志由系统生成，不能直接编辑')
    }
    const doc = parseOrThrow(input.body)
    if (!systemPage) this.assertFrontmatter(doc)

    const allSources = doc.claims.flatMap((c) => c.sources)
    const sourceErrors = await this.sources.validateForWrite(page.organizationId, allSources)
    if (sourceErrors.length > 0) {
      throw new WikiValidationError(sourceErrors.join('；'))
    }
    await this.assertNotRetracted(space, doc.claims)

    let base: WikiParsedDocument | null = null
    if (input.baseRevisionId !== null) {
      const baseRevision = await WikiRevision.query()
        .where('organization_id', page.organizationId)
        .where('page_id', page.id)
        .where('id', input.baseRevisionId)
        .first()
      if (!baseRevision) throw new WikiValidationError('基线修订不存在')
      base = parseOrThrow(baseRevision.bodyMarkdown)
    }
    const editClass = classifyWikiRevision(base, doc, {
      authorKind: input.authorKind,
      registeredGenerators: WIKI_REGISTERED_GENERATORS,
      systemPage,
    })

    const revision = await WikiRevision.create({
      organizationId: page.organizationId,
      pageId: page.id,
      baseRevisionId: input.baseRevisionId,
      bodyMarkdown: input.body,
      authorKind: input.authorKind,
      authorUserId: input.authorUserId,
      editClass,
      status: 'proposed',
      changeSummary: input.changeSummary.slice(0, 500),
      contentHash: sha256(input.body),
      reviewedBy: null,
      reviewedAt: null,
      rejectReason: null,
    })
    if (!systemPage) {
      await this.audit.log({
        event: AuditEvent.WIKI_REVISION_PROPOSED,
        userId: input.authorUserId,
        organizationId: page.organizationId,
        entityType: 'wiki_revision',
        entityId: revision.id,
        metadata: { pageId: page.id, editClass, authorKind: input.authorKind },
      })
    }
    return revision
  }

  private assertFrontmatter(doc: WikiParsedDocument) {
    const { type, title } = doc.frontmatter
    if (
      typeof type !== 'string' ||
      !isWikiPageType(type) ||
      WIKI_SYSTEM_PAGE_TYPES.includes(type)
    ) {
      throw new WikiValidationError('frontmatter 的 type 必须是可用的页面类型')
    }
    if (typeof title !== 'string' || !title.trim() || title.length > 200) {
      throw new WikiValidationError('frontmatter 必须包含 1–200 字的 title')
    }
  }

  /** 撤回墓碑：本空间，及（项目/部门空间）所属组织空间的墓碑一并生效。 */
  private async assertNotRetracted(space: WikiSpace, claims: readonly WikiParsedClaim[]) {
    if (claims.length === 0) return
    const spaceIds = [space.id]
    if (space.scopeKind === 'project' || space.scopeKind === 'department') {
      const orgSpaceId = await this.spaces.organizationSpaceId(space.organizationId)
      if (orgSpaceId) spaceIds.push(orgSpaceId)
    }
    const byFingerprint = new Map(claims.map((c) => [claimFingerprint(c.statement), c.key]))
    const hits = await WikiRetraction.query()
      .where('organization_id', space.organizationId)
      .whereIn('space_id', spaceIds)
      .whereIn('claim_fingerprint', [...byFingerprint.keys()])
    if (hits.length > 0) {
      throw new WikiRetractedClaimError(hits.map((h) => byFingerprint.get(h.claimFingerprint)!))
    }
  }

  // ── 唯一转正门 ─────────────────────────────────────────────────────────

  async publish(
    revisionId: number,
    organizationId: number,
    reviewer: WikiReviewer,
  ): Promise<WikiRevision> {
    const revision = await WikiRevision.query()
      .where('organization_id', organizationId)
      .where('id', revisionId)
      .first()
    if (!revision) throw new WikiNotFoundError()
    const page = await WikiPage.query()
      .where('organization_id', organizationId)
      .where('id', revision.pageId)
      .firstOrFail()
    const { default: WikiSpaceModel } = await import('#models/wiki_space')
    const space = await WikiSpaceModel.query()
      .where('organization_id', organizationId)
      .where('id', page.spaceId)
      .firstOrFail()

    if (reviewer.kind === 'system') {
      if (revision.editClass !== 'bookkeeping') {
        throw new WikiPermissionError('知识修改必须由有审阅权的人确认发布')
      }
    } else {
      if (!(await this.access.canReadPage(reviewer.actor, space, page)))
        throw new WikiNotFoundError()
      if (!(await this.access.canReviewSpace(reviewer.actor, space))) {
        throw new WikiPermissionError('只有本空间的审阅者可以发布修订')
      }
    }
    if (revision.status !== 'proposed') throw new WikiConflictError('该修订不在待审状态')
    if ((revision.baseRevisionId ?? null) !== (page.publishedRevisionId ?? null)) {
      throw new WikiConflictError(
        '页面在此提议之后已有新版本发布，请基于最新版本重新提交',
        'WIKI_STALE_BASE',
      )
    }

    const doc = parseOrThrow(revision.bodyMarkdown)
    // 提交后才被撤回的说法：发布时复查墓碑，不让旧提议把它重新带回来（v3-llm-wiki-lint-consolidation）
    await this.assertNotRetracted(space, doc.claims)
    const reviewerUserId = reviewer.kind === 'user' ? reviewer.actor.user.id : null
    const now = DateTime.now()
    const systemPage = WIKI_SYSTEM_PAGE_TYPES.includes(page.pageType)

    await db.transaction(async (trx) => {
      // 并发双发布：只有基线仍匹配的那一次能把指针挪走
      const moved = await trx
        .from('wiki_pages')
        .where('id', page.id)
        .where('organization_id', organizationId)
        .where((q) =>
          page.publishedRevisionId === null
            ? q.whereNull('published_revision_id')
            : q.where('published_revision_id', page.publishedRevisionId),
        )
        .update({
          published_revision_id: revision.id,
          title: systemPage ? page.title : String(doc.frontmatter.title).trim(),
          page_type: systemPage ? page.pageType : String(doc.frontmatter.type),
          summary_line: truncateWikiSummary(String(doc.frontmatter.summary ?? '')),
          sensitivity: systemPage
            ? page.sensitivity
            : doc.frontmatter.restricted === true
              ? 'restricted'
              : 'normal',
          stale_after_days:
            typeof doc.frontmatter.staleAfterDays === 'number'
              ? Math.max(1, Math.floor(doc.frontmatter.staleAfterDays))
              : null,
          last_published_at: now.toSQL(),
          updated_at: now.toSQL(),
        })
      if (Number(moved) === 0) {
        throw new WikiConflictError('页面已被其他修订更新，请刷新后重试', 'WIKI_STALE_BASE')
      }
      if (page.publishedRevisionId !== null) {
        await trx
          .from('wiki_revisions')
          .where('organization_id', organizationId)
          .where('id', page.publishedRevisionId)
          .update({ status: 'superseded', updated_at: now.toSQL() })
      }
      await trx
        .from('wiki_revisions')
        .where('organization_id', organizationId)
        .where('id', revision.id)
        .update({
          status: 'published',
          reviewed_by: reviewerUserId,
          reviewed_at: now.toSQL(),
          updated_at: now.toSQL(),
        })

      await this.syncClaims(trx, page, revision.id, doc, now)
      await this.rebuildLinks(trx, page, doc)
      await this.upsertSearchEntry(trx, page, doc, now)
      if (!systemPage) {
        await this.appendLog(
          trx,
          space,
          'publish',
          `发布「${String(doc.frontmatter.title).trim()}」（${revision.editClass === 'bookkeeping' ? '簿记' : '知识'}修改）`,
          reviewer.kind === 'user' ? 'human' : 'system',
          reviewerUserId,
          page.id,
        )
        await this.audit.log({
          event: AuditEvent.WIKI_REVISION_PUBLISHED,
          userId: reviewerUserId,
          organizationId,
          entityType: 'wiki_revision',
          entityId: revision.id,
          metadata: {
            pageId: page.id,
            editClass: revision.editClass,
            authorKind: revision.authorKind,
          },
          client: trx,
          strict: true,
        })
      }
    })

    if (!systemPage) await this.refreshIndex(space)
    await revision.refresh()
    return revision
  }

  /** 主张双时态同步：不变的保留，变了的旧版关闭有效期并由新版取代，删掉的关闭。 */
  private async syncClaims(
    trx: TransactionClientContract,
    page: WikiPage,
    revisionId: number,
    doc: WikiParsedDocument,
    now: DateTime,
  ) {
    const existing = await WikiClaim.query({ client: trx })
      .where('organization_id', page.organizationId)
      .where('page_id', page.id)
      .where('status', 'active')
    const existingSources = existing.length
      ? await WikiClaimSource.query({ client: trx })
          .where('organization_id', page.organizationId)
          .whereIn(
            'claim_id',
            existing.map((c) => c.id),
          )
      : []
    const sourcesOf = (claimId: number) =>
      existingSources
        .filter((s) => s.claimId === claimId)
        .map((s) => ({ kind: s.sourceKind, id: s.sourceId, version: s.sourceVersion }))
    const byKey = new Map(existing.map((c) => [c.claimKey, c]))
    const nextKeys = new Set(doc.claims.map((c) => c.key))

    const close = async (claim: WikiClaim, validTo: DateTime) => {
      claim.useTransaction(trx)
      claim.status = 'superseded'
      claim.supersededAt = now
      claim.validTo = claim.validTo && claim.validTo < validTo ? claim.validTo : validTo
      await claim.save()
    }

    for (const c of doc.claims) {
      const prior = byKey.get(c.key)
      if (
        prior &&
        canonicalClaim({
          statement: prior.statement,
          claimKind: prior.claimKind,
          validFrom: prior.validFrom,
          validTo: prior.validTo,
          sources: sourcesOf(prior.id),
        }) === parsedCanonical(c) &&
        prior.invalidReason === null
      ) {
        continue
      }
      if (prior) await close(prior, toDate(c.validFrom) ?? now)
      const distinct = new Set(c.sources.map((s) => `${s.kind}#${s.id}`))
      const claim = await WikiClaim.create(
        {
          organizationId: page.organizationId,
          pageId: page.id,
          revisionId,
          claimKey: c.key,
          statement: c.statement,
          fingerprint: claimFingerprint(c.statement),
          claimKind: c.kind,
          status: 'active',
          validFrom: toDate(c.validFrom),
          validTo: toDate(c.validTo),
          recordedAt: now,
          supersededAt: null,
          supersedesClaimId: prior?.id ?? null,
          evidenceCount: distinct.size,
          invalidReason: null,
        },
        { client: trx },
      )
      await WikiClaimSource.createMany(
        c.sources.map((s) => ({
          organizationId: page.organizationId,
          claimId: claim.id,
          sourceKind: s.kind,
          sourceId: s.id,
          sourceVersion: s.version,
        })),
        { client: trx },
      )
    }
    for (const prior of existing) {
      if (!nextKeys.has(prior.claimKey)) await close(prior, now)
    }
  }

  private async rebuildLinks(
    trx: TransactionClientContract,
    page: WikiPage,
    doc: WikiParsedDocument,
  ) {
    await trx
      .from('wiki_links')
      .where('organization_id', page.organizationId)
      .where('from_page_id', page.id)
      .delete()
    const slugs = [...new Set(doc.links.map((l) => l.slug))]
    if (slugs.length === 0) return
    const targets = await WikiPage.query({ client: trx })
      .where('organization_id', page.organizationId)
      .where('space_id', page.spaceId)
      .whereIn('slug', slugs)
      .whereNot('id', page.id)
    if (targets.length === 0) return
    await WikiLink.createMany(
      targets.map((t) => ({
        organizationId: page.organizationId,
        fromPageId: page.id,
        toPageId: t.id,
        linkKind: 'mentions',
      })),
      { client: trx },
    )
  }

  private async upsertSearchEntry(
    trx: TransactionClientContract,
    page: WikiPage,
    doc: WikiParsedDocument,
    now: DateTime,
  ) {
    const values = {
      title: String(doc.frontmatter.title ?? page.title).slice(0, 200),
      summary_line: truncateWikiSummary(String(doc.frontmatter.summary ?? '')),
      headings_text: doc.headings.join('\n').slice(0, 4000),
      updated_at: now.toSQL(),
    }
    const updated = await trx
      .from('wiki_search_entries')
      .where('organization_id', page.organizationId)
      .where('page_id', page.id)
      .update(values)
    if (Number(updated) === 0) {
      await WikiSearchEntry.create(
        {
          organizationId: page.organizationId,
          spaceId: page.spaceId,
          pageId: page.id,
          title: values.title,
          summaryLine: values.summary_line,
          headingsText: values.headings_text,
        },
        { client: trx },
      )
    }
  }

  async appendLog(
    client: TransactionClientContract | null,
    space: WikiSpace,
    op: WikiLogOp,
    summary: string,
    actorKind: WikiAuthorKind,
    actorUserId: number | null,
    refPageId: number | null,
  ) {
    await WikiLogEntry.create(
      {
        organizationId: space.organizationId,
        spaceId: space.id,
        op,
        line: renderWikiLogLine(new Date(), op, summary).slice(0, 600),
        actorKind,
        actorUserId,
        refPageId,
      },
      client ? { client } : undefined,
    )
  }

  // ── 目录（系统页）──────────────────────────────────────────────────────

  /** 按已发布页面确定性重建目录；内容未变时不产生修订。返回是否更新。 */
  async refreshIndex(space: WikiSpace): Promise<boolean> {
    let index = await WikiPage.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .where('slug', WIKI_INDEX_SLUG)
      .first()
    if (!index) {
      try {
        index = await WikiPage.create({
          organizationId: space.organizationId,
          spaceId: space.id,
          slug: WIKI_INDEX_SLUG,
          pageType: 'index',
          title: '目录',
          summaryLine: '本空间全部页面',
          status: 'active',
          ownerUserId: null,
          publishedRevisionId: null,
          sensitivity: 'normal',
          staleAfterDays: null,
          sharedWithProjectIds: null,
          lastPublishedAt: null,
          createdBy: null,
        })
      } catch {
        index = await WikiPage.query()
          .where('organization_id', space.organizationId)
          .where('space_id', space.id)
          .where('slug', WIKI_INDEX_SLUG)
          .firstOrFail()
      }
    }
    const pages = await WikiPage.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .where('status', 'active')
      .where('sensitivity', 'normal')
      .whereNotNull('published_revision_id')
      .whereNotIn('page_type', [...WIKI_SYSTEM_PAGE_TYPES])
    const body = renderWikiMarkdown(
      { type: 'index', title: '目录', summary: '本空间全部页面' },
      renderWikiIndex(
        pages.map((p) => ({
          slug: p.slug,
          title: p.title,
          summaryLine: p.summaryLine,
          pageType: p.pageType,
        })),
      ),
    )
    if (index.publishedRevisionId !== null) {
      const current = await WikiRevision.find(index.publishedRevisionId)
      if (current?.bodyMarkdown === body) return false
    }
    const proposal = await this.proposeRevision({
      page: index,
      space,
      body,
      authorKind: 'system',
      authorUserId: null,
      baseRevisionId: index.publishedRevisionId,
      changeSummary: '目录刷新',
    })
    await this.publish(proposal.id, space.organizationId, { kind: 'system' })
    return true
  }

  // ── 人工修订 ───────────────────────────────────────────────────────────

  /** 新建页面并提交首个修订：审阅者提交即发布，其余成为待审提议。 */
  async createPage(
    actor: WikiActor,
    space: WikiSpace,
    slug: string,
    body: string,
    changeSummary: string,
  ): Promise<{ page: WikiPage; revision: WikiRevision; published: boolean }> {
    if (!(await this.access.canProposeInSpace(actor, space))) {
      throw new WikiPermissionError('没有在本空间提交修订的权限')
    }
    if (!isValidWikiSlug(slug))
      throw new WikiValidationError('页面标识只能包含文字、数字、点、下划线与短横线')
    const doc = parseOrThrow(body)
    this.assertFrontmatter(doc)
    const exists = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .where('slug', slug)
      .first()
    if (exists) throw new WikiConflictError('本空间已有同标识的页面', 'WIKI_SLUG_TAKEN')

    const page = await WikiPage.create({
      organizationId: actor.organizationId,
      spaceId: space.id,
      slug,
      pageType: String(doc.frontmatter.type) as WikiPage['pageType'],
      title: String(doc.frontmatter.title).trim(),
      summaryLine: truncateWikiSummary(String(doc.frontmatter.summary ?? '')),
      status: 'active',
      ownerUserId: actor.user.id,
      publishedRevisionId: null,
      sensitivity: doc.frontmatter.restricted === true ? 'restricted' : 'normal',
      staleAfterDays: null,
      sharedWithProjectIds: null,
      lastPublishedAt: null,
      createdBy: actor.user.id,
    })
    await this.audit.log({
      event: AuditEvent.WIKI_PAGE_CREATED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_page',
      entityId: page.id,
      metadata: { spaceId: space.id, pageType: page.pageType },
    })
    try {
      const result = await this.submitHumanRevision(actor, space, page, body, null, changeSummary)
      return { page, ...result }
    } catch (error) {
      await page.delete()
      throw error
    }
  }

  async submitHumanRevision(
    actor: WikiActor,
    space: WikiSpace,
    page: WikiPage,
    body: string,
    baseRevisionId: number | null,
    changeSummary: string,
  ): Promise<{ revision: WikiRevision; published: boolean }> {
    if (!(await this.access.canReadPage(actor, space, page))) throw new WikiNotFoundError()
    if (!(await this.access.canProposeInSpace(actor, space))) {
      throw new WikiPermissionError('没有在本空间提交修订的权限')
    }
    if ((baseRevisionId ?? null) !== (page.publishedRevisionId ?? null)) {
      throw new WikiConflictError('页面已有更新的版本，请刷新后基于最新版本修改', 'WIKI_STALE_BASE')
    }
    const revision = await this.proposeRevision({
      page,
      space,
      body,
      authorKind: 'human',
      authorUserId: actor.user.id,
      baseRevisionId,
      changeSummary,
    })
    if (await this.access.canReviewSpace(actor, space)) {
      return {
        revision: await this.publish(revision.id, actor.organizationId, { kind: 'user', actor }),
        published: true,
      }
    }
    return { revision, published: false }
  }

  async reject(actor: WikiActor, revisionId: number, reason: string): Promise<WikiRevision> {
    const { revision, page, space } = await this.loadForReview(actor, revisionId)
    if (revision.status !== 'proposed') throw new WikiConflictError('该修订不在待审状态')
    revision.status = 'rejected'
    revision.reviewedBy = actor.user.id
    revision.reviewedAt = DateTime.now()
    revision.rejectReason = reason.slice(0, 500) || null
    await revision.save()
    await this.appendLog(
      null,
      space,
      'reject',
      `驳回对「${page.title}」的修订`,
      'human',
      actor.user.id,
      page.id,
    )
    await this.audit.log({
      event: AuditEvent.WIKI_REVISION_REJECTED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_revision',
      entityId: revision.id,
      metadata: { pageId: page.id },
    })
    return revision
  }

  /** 回滚：以历史已发布内容生成一条新修订并发布，不删除中间修订。 */
  async rollback(
    actor: WikiActor,
    pageId: number,
    targetRevisionId: number,
  ): Promise<WikiRevision> {
    const page = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('id', pageId)
      .first()
    if (!page) throw new WikiNotFoundError()
    const space = await this.spaces.getReadable(actor, page.spaceId)
    if (!(await this.access.canReadPage(actor, space, page))) throw new WikiNotFoundError()
    if (!(await this.access.canReviewSpace(actor, space))) throw new WikiPermissionError()
    if (WIKI_SYSTEM_PAGE_TYPES.includes(page.pageType)) {
      throw new WikiPermissionError('目录与操作日志由系统生成，不能回滚')
    }
    const target = await WikiRevision.query()
      .where('organization_id', actor.organizationId)
      .where('page_id', page.id)
      .where('id', targetRevisionId)
      .whereIn('status', ['published', 'superseded'])
      .first()
    if (!target) throw new WikiNotFoundError('只能回滚到曾经发布过的版本')
    if (target.id === page.publishedRevisionId) throw new WikiConflictError('该版本就是当前版本')
    const proposal = await this.proposeRevision({
      page,
      space,
      body: target.bodyMarkdown,
      authorKind: 'human',
      authorUserId: actor.user.id,
      baseRevisionId: page.publishedRevisionId,
      changeSummary: `回滚到修订 #${target.id}`,
    })
    const published = await this.publish(proposal.id, actor.organizationId, { kind: 'user', actor })
    await this.appendLog(
      null,
      space,
      'rollback',
      `回滚「${page.title}」到修订 #${target.id}`,
      'human',
      actor.user.id,
      page.id,
    )
    await this.audit.log({
      event: AuditEvent.WIKI_PAGE_ROLLED_BACK,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_page',
      entityId: page.id,
      metadata: { targetRevisionId: target.id, newRevisionId: published.id },
    })
    return published
  }

  private async loadForReview(actor: WikiActor, revisionId: number) {
    const revision = await WikiRevision.query()
      .where('organization_id', actor.organizationId)
      .where('id', revisionId)
      .first()
    if (!revision) throw new WikiNotFoundError()
    const page = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('id', revision.pageId)
      .firstOrFail()
    const space = await this.spaces.getReadable(actor, page.spaceId)
    if (!(await this.access.canReadPage(actor, space, page))) throw new WikiNotFoundError()
    if (!(await this.access.canReviewSpace(actor, space))) {
      throw new WikiPermissionError('只有本空间的审阅者可以处理修订')
    }
    return { revision, page, space }
  }
}
