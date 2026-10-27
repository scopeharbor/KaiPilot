/**
 * v3-llm-wiki-query-navigation —— 确定性维基上下文包。
 *
 * 候选：读者可读空间（项目 → 部门 → 组织）中已发布、未停用、非受限、非系统页面的未遮蔽主张；待审提议不进入。
 * 预选用标题/摘要/有效主张打分取前 24 页，再用读者可见内容复算（被遮蔽内容不影响入选），按整条主张截断到字节预算。
 * 相同输入两次结果全等：无时间戳、无随机，排序键为（分数降序、空间顺序、页面 ID）。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import {
  WIKI_CONTEXT_PACK_DEFAULT_BYTES,
  parseWikiMarkdown,
  scoreWikiPageForQuery,
  wikiQueryTerms,
  type WikiContextPackDto,
  type WikiContextPackPage,
} from '@aiproj/types'
import WikiRevision from '#models/wiki_revision'
import type { WikiActor } from '../wiki_access_service.js'
import WikiReadService from '../wiki_read_service.js'
import { sourceKey } from '../wiki_source_registry.js'
import WikiQueryService, { isVisibleClaim } from './wiki_query_service.js'

const PRESELECT_PAGES = 24

export interface WikiContextPackInput {
  projectId: number | null
  query: string
  byteBudget?: number
}

const bytesOf = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')

@inject()
export default class WikiContextPackBuilder {
  constructor(
    private readonly query: WikiQueryService,
    private readonly read: WikiReadService,
  ) {}

  async build(actor: WikiActor, input: WikiContextPackInput): Promise<WikiContextPackDto> {
    const budget = input.byteBudget ?? WIKI_CONTEXT_PACK_DEFAULT_BYTES
    const empty: WikiContextPackDto = { pages: [], bytes: 0, truncated: false }
    const terms = wikiQueryTerms(input.query)
    if (terms.length === 0 || budget <= 0) return empty

    const spaces = await this.query.scopeSpaces(actor, input.projectId)
    const candidates = []
    for (const [order, space] of spaces.entries()) {
      for (const page of await this.query.publishedPages(actor, space, false))
        candidates.push({ page, space, order })
    }
    if (candidates.length === 0) return empty

    const claimRows = await db
      .from('wiki_claims')
      .where('organization_id', actor.organizationId)
      .whereIn(
        'page_id',
        candidates.map((c) => c.page.id),
      )
      .where('status', 'active')
      .select('page_id', 'statement')
    const statementsOf = new Map<number, string[]>()
    for (const r of claimRows) {
      const id = Number(r.page_id)
      statementsOf.set(id, [...(statementsOf.get(id) ?? []), String(r.statement)])
    }
    const byRank = <T extends { score: number; order: number; page: { id: number } }>(a: T, b: T) =>
      b.score - a.score || a.order - b.order || a.page.id - b.page.id
    const preselected = candidates
      .map((c) => ({
        ...c,
        score: scoreWikiPageForQuery(
          terms,
          {
            title: c.page.title,
            summary: c.page.summaryLine,
            headings: [],
            claims: statementsOf.get(c.page.id) ?? [],
          },
          { projectBrief: c.page.pageType === 'project-brief' },
        ),
      }))
      .filter((c) => c.score > 0)
      .sort(byRank)
      .slice(0, PRESELECT_PAGES)

    const ranked: Array<{
      score: number
      order: number
      page: { id: number }
      entry: WikiContextPackPage
    }> = []
    for (const c of preselected) {
      const revision = await WikiRevision.find(c.page.publishedRevisionId!)
      if (!revision) continue
      const claims = await this.read.claimsFor(actor.organizationId, c.page.id, null)
      const rendered = await this.read.render(actor, revision.bodyMarkdown, claims, true)
      const visible = rendered.claims.filter(isVisibleClaim)
      if (visible.length === 0) continue
      const parsed = parseWikiMarkdown(rendered.body)
      const score = scoreWikiPageForQuery(
        terms,
        {
          title: c.page.title,
          summary: c.page.summaryLine,
          headings: parsed.ok ? parsed.doc.headings : [],
          claims: visible.map((v) => v.statement),
        },
        { projectBrief: c.page.pageType === 'project-brief' },
      )
      if (score <= 0) continue
      ranked.push({
        score,
        order: c.order,
        page: c.page,
        entry: {
          pageId: c.page.id,
          spaceKind: c.space.scopeKind,
          title: c.page.title,
          type: c.page.pageType,
          claims: visible.map((v) => ({
            key: v.claimKey,
            statement: v.statement,
            kind: v.claimKind,
            sources: v.sources.map((s) => sourceKey(s)),
          })),
        },
      })
    }
    ranked.sort(byRank)

    const pages: WikiContextPackPage[] = []
    let bytes = 0
    let truncated = false
    outer: for (const r of ranked) {
      const header = bytesOf({ ...r.entry, claims: [] })
      if (bytes + header > budget) {
        truncated = true
        break
      }
      const kept: WikiContextPackPage['claims'] = []
      let used = header
      for (const claim of r.entry.claims) {
        const size = bytesOf(claim)
        if (bytes + used + size > budget) {
          truncated = true
          if (kept.length > 0) {
            pages.push({ ...r.entry, claims: kept })
            bytes += used
          }
          break outer
        }
        kept.push(claim)
        used += size
      }
      pages.push({ ...r.entry, claims: kept })
      bytes += used
    }
    return { pages, bytes, truncated }
  }
}
