/**
 * v3-llm-wiki-retrospective-lessons —— 教训晋升到组织教训库（design D4）与教训召回（design D5）。
 *
 * 晋升：只能晋升项目复盘页「教训」章节的有效人写 / AI 主张，结果是组织空间的待审修订（由组织审阅者确认）。
 * 召回：只读组织教训库已发布、读者可见的有效主张，按关键词与项目类型打分；只提示，不改任何业务数据。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import {
  WIKI_LESSONS_SLUG,
  WIKI_RETROSPECTIVE_LESSONS_HEADING,
  WIKI_RETROSPECTIVE_SLUG,
  parseWikiMarkdown,
  planWikiLessonPromotion,
  recallWikiLessons,
  truncateWikiSummary,
  wikiLessonSectionOf,
  wikiLessonsSkeleton,
  wikiSectionOfLine,
  type ProjectType,
  type WikiLessonForDraft,
  type WikiLessonRecallItem,
} from '@aiproj/types'
import WikiClaim from '#models/wiki_claim'
import WikiPage from '#models/wiki_page'
import WikiRevision from '#models/wiki_revision'
import WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import WikiReadService from '../wiki_read_service.js'
import WikiRevisionService from '../wiki_revision_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import WikiSpaceService from '../wiki_space_service.js'
import { isVisibleClaim } from '../query/wiki_query_service.js'
import {
  WikiConflictError,
  WikiNotFoundError,
  WikiPermissionError,
  WikiValidationError,
} from '../errors.js'

/** 草案生成最多附带的教训条数。 */
export const WIKI_LESSONS_FOR_DRAFT = 3

export interface WikiLessonPromotionResult {
  pageId: number
  revisionId: number
}

export interface WikiLessonRecallResult extends WikiLessonRecallItem {
  pageId: number
}

@inject()
export default class WikiLessonService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly spaces: WikiSpaceService,
    private readonly access: WikiAccessService,
    private readonly read: WikiReadService,
    private readonly revisions: WikiRevisionService,
    private readonly audit: AuditService,
  ) {}

  /** 项目类型 = 该项目转正来源草案的类型（没有则 null）。 */
  async projectTypeOf(organizationId: number, projectId: number): Promise<ProjectType | null> {
    const row = await db
      .from('ai_project_drafts')
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNotNull('project_type')
      .orderBy('id', 'desc')
      .first()
    return (row?.project_type as ProjectType | undefined) ?? null
  }

  // ── 晋升 ───────────────────────────────────────────────────────────────

  async promote(actor: WikiActor, claimId: number): Promise<WikiLessonPromotionResult> {
    await this.settings.assertEnabled(actor.organizationId)
    const claim = await WikiClaim.query()
      .where('organization_id', actor.organizationId)
      .where('id', claimId)
      .first()
    if (!claim) throw new WikiNotFoundError()
    const page = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('id', claim.pageId)
      .first()
    const space = page
      ? await WikiSpace.query()
          .where('organization_id', actor.organizationId)
          .where('id', page.spaceId)
          .first()
      : null
    if (!page || !space || !(await this.access.canReadPage(actor, space, page)))
      throw new WikiNotFoundError()
    if (!(await this.access.canReviewSpace(actor, space)))
      throw new WikiPermissionError('只有本项目维基的审阅者可以晋升教训')

    const revision = page.publishedRevisionId
      ? await WikiRevision.find(page.publishedRevisionId)
      : null
    const parsed = revision ? parseWikiMarkdown(revision.bodyMarkdown) : null
    const inBody =
      parsed?.ok === true ? parsed.doc.claims.find((c) => c.key === claim.claimKey) : undefined
    if (
      space.scopeKind !== 'project' ||
      page.slug !== WIKI_RETROSPECTIVE_SLUG ||
      page.status !== 'active' ||
      claim.status !== 'active' ||
      claim.invalidReason !== null ||
      claim.claimKind === 'derived' ||
      !revision ||
      !inBody ||
      inBody.derived ||
      wikiSectionOfLine(revision.bodyMarkdown, inBody.line) !== WIKI_RETROSPECTIVE_LESSONS_HEADING
    )
      throw new WikiValidationError('只能晋升项目复盘页「教训」章节中有效的教训')

    const projectId = Number(space.scopeRefId)
    const project = await db
      .from('projects')
      .where('organization_id', actor.organizationId)
      .where('id', projectId)
      .first()
    const orgSpace = await this.spaces.resolve(actor, 'organization', actor.organizationId)
    const existing = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', orgSpace.id)
      .where('slug', WIKI_LESSONS_SLUG)
      .first()
    if (existing && existing.status !== 'active')
      throw new WikiConflictError('组织教训库页面已归档，无法晋升')
    const published = existing?.publishedRevisionId
      ? await WikiRevision.find(existing.publishedRevisionId)
      : null
    const baseSource = published?.bodyMarkdown ?? wikiLessonsSkeleton()
    const body = planWikiLessonPromotion({
      baseSource,
      statement: claim.statement,
      promotedBy: actor.user.id,
      projectName: String(project?.name ?? `项目 ${projectId}`),
      section: wikiLessonSectionOf(await this.projectTypeOf(actor.organizationId, projectId)),
    })
    if (!body) throw new WikiConflictError('组织教训库已有这条教训')

    const target = existing ?? (await this.createLessonsPage(actor, orgSpace))
    let proposal: WikiRevision
    try {
      proposal = await this.revisions.proposeRevision({
        page: target,
        space: orgSpace,
        body,
        authorKind: 'human',
        authorUserId: actor.user.id,
        baseRevisionId: published?.id ?? null,
        changeSummary: `晋升教训（来自「${String(project?.name ?? projectId)}」复盘）`.slice(
          0,
          500,
        ),
      })
    } catch (error) {
      if (!existing) await target.delete()
      throw error
    }
    await this.audit.log({
      event: AuditEvent.WIKI_LESSON_PROMOTED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      projectId,
      entityType: 'wiki_claim',
      entityId: claim.id,
      metadata: { lessonsPageId: target.id, revisionId: proposal.id },
    })
    return { pageId: target.id, revisionId: proposal.id }
  }

  private async createLessonsPage(actor: WikiActor, space: WikiSpace) {
    const doc = parseWikiMarkdown(wikiLessonsSkeleton())
    return WikiPage.create({
      organizationId: actor.organizationId,
      spaceId: space.id,
      slug: WIKI_LESSONS_SLUG,
      pageType: 'lesson',
      title: doc.ok ? String(doc.doc.frontmatter.title) : '组织教训库',
      summaryLine: truncateWikiSummary(doc.ok ? String(doc.doc.frontmatter.summary ?? '') : ''),
      status: 'active',
      ownerUserId: null,
      publishedRevisionId: null,
      sensitivity: 'normal',
      staleAfterDays: null,
      sharedWithProjectIds: null,
      lastPublishedAt: null,
      createdBy: actor.user.id,
    })
  }

  // ── 召回 ───────────────────────────────────────────────────────────────

  async recall(
    actor: WikiActor,
    args: { q: string; projectId?: number; projectType?: ProjectType | null; limit?: number },
  ): Promise<WikiLessonRecallResult[]> {
    await this.settings.assertEnabled(actor.organizationId)
    const orgSpaceId = await this.spaces.organizationSpaceId(actor.organizationId)
    if (!orgSpaceId || !args.q.trim()) return []
    const space = await WikiSpace.find(orgSpaceId)
    if (!space || !(await this.access.canReadSpace(actor, space))) return []
    const page = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .where('slug', WIKI_LESSONS_SLUG)
      .where('status', 'active')
      .whereNotNull('published_revision_id')
      .first()
    if (!page || !(await this.access.canReadPage(actor, space, page))) return []
    const revision = await WikiRevision.find(page.publishedRevisionId!)
    if (!revision) return []
    const claims = await this.read.claimsFor(actor.organizationId, page.id, null)
    const rendered = await this.read.render(actor, revision.bodyMarkdown, claims, true)
    const parsed = parseWikiMarkdown(revision.bodyMarkdown)
    const lineOf = new Map(parsed.ok ? parsed.doc.claims.map((c) => [c.key, c.line]) : [])
    const candidates = rendered.claims
      .filter(isVisibleClaim)
      .filter((c) => c.status === 'active' && c.claimKind !== 'derived')
      .map((c) => {
        const line = lineOf.get(c.claimKey)
        return {
          claimId: c.id,
          statement: c.statement,
          section: line === undefined ? null : wikiSectionOfLine(revision.bodyMarkdown, line),
        }
      })
    let projectType = args.projectType ?? null
    if (args.projectId !== undefined) {
      const project = await db
        .from('projects')
        .where('organization_id', actor.organizationId)
        .where('id', args.projectId)
        .first()
      if (!project) throw new WikiNotFoundError()
      projectType = await this.projectTypeOf(actor.organizationId, args.projectId)
    }
    return recallWikiLessons(candidates, {
      query: args.q,
      section: wikiLessonSectionOf(projectType),
      limit: args.limit,
    }).map((item) => ({ ...item, pageId: page.id }))
  }

  /** 草案生成：未开启维基或没有相关教训时返回 null；否则给出事实句与计划体检用的教训列表。 */
  async lessonsForDraft(
    actor: WikiActor,
    projectType: ProjectType | null,
    text: string,
  ): Promise<{ facts: string[]; lessons: WikiLessonForDraft[] } | null> {
    if (!(await this.settings.isEnabled(actor.organizationId))) return null
    const hits = await this.recall(actor, { q: text, projectType, limit: WIKI_LESSONS_FOR_DRAFT })
    if (hits.length === 0) return null
    return {
      facts: hits.map(
        (h) => `历史教训（组织教训库${h.section ? `·${h.section}` : ''}）：${h.statement}`,
      ),
      lessons: hits.map((h) => ({ statement: h.statement, section: h.section })),
    }
  }
}
