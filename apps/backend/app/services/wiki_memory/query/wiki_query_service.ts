/**
 * v3-llm-wiki-query-navigation —— 查阅服务：AI 同事维基工具（目录 / 读页 / 检索）与上下文包共用的空间选择。
 *
 * 只读取已存在且读者可读的空间（项目 → 读者所在部门 → 组织），不为查阅创建空间；个人空间不参与（M6）。
 * 页面只给已发布版本，遮蔽与撤回沿用 WikiReadService；待审提议永不返回。
 */
import { inject } from '@adonisjs/core'
import {
  WIKI_QUERY_INDEX_MAX_PAGES,
  WIKI_QUERY_NOTICE,
  WIKI_QUERY_READ_MAX_CHARS,
  WIKI_QUERY_SEARCH_MAX,
  WIKI_SYSTEM_PAGE_TYPES,
  extractWikiSection,
  type WikiClaimDto,
  type WikiMaskedClaimDto,
  type WikiQueryIndexDto,
  type WikiQueryPageRow,
  type WikiQueryReadDto,
  type WikiQuerySearchDto,
} from '@aiproj/types'
import WikiPage from '#models/wiki_page'
import WikiSpace from '#models/wiki_space'
import RbacService from '#services/rbac_service'
import { WIKI_VIEW } from '#start/rbac/permissions'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import WikiReadService from '../wiki_read_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import { WikiFeatureDisabledError, WikiNotFoundError, WikiPermissionError } from '../errors.js'

const QUERYABLE_SCOPES = new Set(['project', 'department', 'organization'])
const FOOTNOTE_DEF = /^\s*\[\^c:[^\]]+\]:/

export function isVisibleClaim(c: WikiClaimDto | WikiMaskedClaimDto): c is WikiClaimDto {
  return !('masked' in c && c.masked)
}

function clip(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max
    ? { text: `${text.slice(0, max)}…`, truncated: true }
    : { text, truncated: false }
}

@inject()
export default class WikiQueryService {
  constructor(
    private readonly access: WikiAccessService,
    private readonly read: WikiReadService,
    private readonly settings: WikiSettingsService,
    private readonly rbac: RbacService,
  ) {}

  /** 组织已开启维基且读者有 wiki:view。 */
  async isAvailable(actor: WikiActor): Promise<boolean> {
    if (!(await this.settings.isEnabled(actor.organizationId))) return false
    const view = await this.rbac.check(actor.user, WIKI_VIEW, actor.organizationId)
    return view.allowed
  }

  async assertAvailable(actor: WikiActor): Promise<void> {
    if (!(await this.settings.isEnabled(actor.organizationId))) throw new WikiFeatureDisabledError()
    const view = await this.rbac.check(actor.user, WIKI_VIEW, actor.organizationId)
    if (!view.allowed) throw new WikiPermissionError('没有查看记忆维基的权限')
  }

  /** 已存在且可读的空间，顺序固定：项目 → 读者所在部门 → 组织。 */
  async scopeSpaces(actor: WikiActor, projectId: number | null): Promise<WikiSpace[]> {
    const wanted: Array<{ kind: string; ref: number }> = []
    if (projectId !== null) wanted.push({ kind: 'project', ref: projectId })
    const departmentId = await this.access.departmentOf(actor)
    if (departmentId !== null) wanted.push({ kind: 'department', ref: departmentId })
    wanted.push({ kind: 'organization', ref: actor.organizationId })
    const out: WikiSpace[] = []
    for (const w of wanted) {
      const space = await WikiSpace.query()
        .where('organization_id', actor.organizationId)
        .where('scope_kind', w.kind)
        .where('scope_ref_id', w.ref)
        .first()
      if (space && (await this.access.canReadSpace(actor, space))) out.push(space)
    }
    return out
  }

  /** 空间内可列出的已发布页面（遵守受限页规则，排除目录与日志）。 */
  async publishedPages(actor: WikiActor, space: WikiSpace, includeRestricted: boolean) {
    const canReview = includeRestricted ? await this.access.canReviewSpace(actor, space) : false
    return WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .where('status', 'active')
      .whereNotNull('published_revision_id')
      .whereNotIn('page_type', [...WIKI_SYSTEM_PAGE_TYPES])
      .if(!canReview, (q) => q.where('sensitivity', 'normal'))
      .orderBy('title', 'asc')
      .orderBy('id', 'asc')
  }

  private row(page: WikiPage): WikiQueryPageRow {
    return {
      pageId: page.id,
      slug: page.slug,
      title: page.title,
      type: page.pageType,
      summary: page.summaryLine,
    }
  }

  async index(actor: WikiActor, projectId: number | null): Promise<WikiQueryIndexDto> {
    await this.assertAvailable(actor)
    const spaces = await this.scopeSpaces(actor, projectId)
    let remaining = WIKI_QUERY_INDEX_MAX_PAGES
    let truncated = false
    const out: WikiQueryIndexDto['spaces'] = []
    for (const space of spaces) {
      const pages = await this.publishedPages(actor, space, true)
      if (pages.length > remaining) truncated = true
      const kept = pages.slice(0, Math.max(0, remaining))
      remaining -= kept.length
      out.push({
        spaceId: space.id,
        scopeKind: space.scopeKind,
        scopeRefId: Number(space.scopeRefId),
        title: space.title,
        pages: kept.map((p) => this.row(p)),
      })
    }
    return { notice: WIKI_QUERY_NOTICE, spaces: out, truncated }
  }

  async readPage(
    actor: WikiActor,
    pageId: number,
    section: string | null,
  ): Promise<WikiQueryReadDto> {
    await this.assertAvailable(actor)
    const { page, space } = await this.read.loadReadablePage(actor, pageId)
    if (!QUERYABLE_SCOPES.has(space.scopeKind) || WIKI_SYSTEM_PAGE_TYPES.includes(page.pageType))
      throw new WikiNotFoundError()
    const view = await this.read.getPageView(actor, page.id, null)
    const published = view.revision !== null
    const wanted = section?.trim() ? section.trim() : null
    // 一节不含脚注定义（定义行在全文末尾，属于整页）；主张按正文中的标记归属
    const extracted = wanted ? extractWikiSection(view.body, wanted) : null
    const sectionBody =
      extracted === null
        ? null
        : extracted
            .split('\n')
            .filter((line) => !FOOTNOTE_DEF.test(line))
            .join('\n')
            .trim()
    const scoped = sectionBody ?? view.body
    const body = clip(scoped, WIKI_QUERY_READ_MAX_CHARS)
    const claims = view.claims
      .filter(isVisibleClaim)
      .filter((c) => sectionBody === null || sectionBody.includes(`[^c:${c.claimKey}]`))
      .map((c) => ({
        key: c.claimKey,
        statement: c.statement,
        kind: c.claimKind,
        sources: c.sources.map((s) => ({ kind: s.kind, id: s.id, label: s.label })),
      }))
    return {
      notice: WIKI_QUERY_NOTICE,
      pageId: page.id,
      spaceId: space.id,
      scopeKind: space.scopeKind,
      scopeRefId: Number(space.scopeRefId),
      title: page.title,
      type: page.pageType,
      published,
      section: sectionBody === null ? null : wanted,
      body: published ? body.text : '',
      truncated: published && body.truncated,
      claims,
      hasMaskedContent: view.hasMaskedContent,
      links: view.outgoingLinks
        .filter((l) => l.exists && l.title !== null)
        .map((l) => ({ slug: l.slug, title: l.title! })),
    }
  }

  async search(
    actor: WikiActor,
    keyword: string,
    projectId: number | null,
  ): Promise<WikiQuerySearchDto> {
    await this.assertAvailable(actor)
    const results: WikiQuerySearchDto['results'] = []
    const seen = new Set<number>()
    for (const space of await this.scopeSpaces(actor, projectId)) {
      for (const p of await this.read.search(actor, space.id, keyword)) {
        if (p.publishedRevisionId === null || seen.has(p.id)) continue
        seen.add(p.id)
        results.push({
          pageId: p.id,
          spaceId: p.spaceId,
          scopeKind: space.scopeKind,
          scopeRefId: Number(space.scopeRefId),
          slug: p.slug,
          title: p.title,
          type: p.pageType,
          summary: p.summaryLine,
        })
      }
    }
    return { notice: WIKI_QUERY_NOTICE, results: results.slice(0, WIKI_QUERY_SEARCH_MAX) }
  }
}
