/**
 * 系统派生页写入器（v3-llm-wiki-planning-dossier 抽出，v3-llm-wiki-process-reality 共用）。
 *
 * 新建纯派生页、或只替换某生成器的派生段，都以系统作者提交，只有判为簿记的修订才发布；
 * 正文不变不提交；派生段被人删掉时不擅自加回（留给审阅者）；单页失败只计为跳过、不影响其他页。
 */
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import {
  parseWikiMarkdown,
  replaceWikiDerivedBlock,
  truncateWikiSummary,
  type WikiDerivedBlockRender,
  type WikiDossierRefreshSummary,
  type WikiPageType,
} from '@aiproj/types'
import WikiPage from '#models/wiki_page'
import WikiRevision from '#models/wiki_revision'
import type WikiSpace from '#models/wiki_space'
import type { WikiActor } from './wiki_access_service.js'
import WikiRevisionService from './wiki_revision_service.js'

export interface WikiDerivedPageSpec {
  slug: string
  pageType: WikiPageType
  generatorId: string
  /** 本生成器脚注键前缀（重建脚注定义用）。 */
  keyPrefix: string
  block: WikiDerivedBlockRender
  /** 新建或重建时的完整正文。 */
  fullBody: () => string
  /** 修订说明前缀，如「计划档案」「流程实况」。 */
  label: string
  /** 新建页面的所有者（个人空间为本人；组织空间缺省为 null）。 */
  ownerUserId?: number | null
}

@inject()
export default class WikiDerivedPageWriter {
  constructor(private readonly revisions: WikiRevisionService) {}

  async upsert(
    actor: WikiActor,
    space: WikiSpace,
    spec: WikiDerivedPageSpec,
    summary: WikiDossierRefreshSummary,
  ): Promise<void> {
    try {
      const page = await WikiPage.query()
        .where('organization_id', space.organizationId)
        .where('space_id', space.id)
        .where('slug', spec.slug)
        .first()
      if (!page) {
        const body = spec.fullBody()
        const doc = parseWikiMarkdown(body)
        const created = await WikiPage.create({
          organizationId: space.organizationId,
          spaceId: space.id,
          slug: spec.slug,
          pageType: spec.pageType,
          title: doc.ok ? String(doc.doc.frontmatter.title) : spec.slug,
          summaryLine: truncateWikiSummary(doc.ok ? String(doc.doc.frontmatter.summary ?? '') : ''),
          status: 'active',
          ownerUserId: spec.ownerUserId ?? null,
          publishedRevisionId: null,
          sensitivity: 'normal',
          staleAfterDays: null,
          sharedWithProjectIds: null,
          lastPublishedAt: null,
          createdBy: actor.user.id,
        })
        await this.publishSystem(space, created, body, null, `${spec.label}：新建`)
        summary.created++
        return
      }
      if (page.status !== 'active') {
        summary.skipped++
        return
      }
      const current = page.publishedRevisionId
        ? await WikiRevision.find(page.publishedRevisionId)
        : null
      if (!current) {
        await this.publishSystem(space, page, spec.fullBody(), null, `${spec.label}：重建`)
        summary.updated++
        return
      }
      const next = replaceWikiDerivedBlock(
        current.bodyMarkdown,
        spec.generatorId,
        spec.block,
        spec.keyPrefix,
      )
      if (next === null) {
        // 派生段被人删掉了：不擅自加回，留给审阅者处理
        summary.skipped++
        return
      }
      if (next === current.bodyMarkdown) {
        summary.unchanged++
        return
      }
      const published = await this.publishSystem(
        space,
        page,
        next,
        current.id,
        `${spec.label}：刷新统计`,
      )
      if (published) summary.updated++
      else summary.skipped++
    } catch (error) {
      logger.warn(
        { organizationId: space.organizationId, slug: spec.slug, err: (error as Error).name },
        'wiki derived page refresh skipped',
      )
      summary.skipped++
    }
  }

  /** 系统提交；只有判为簿记的修订才发布（否则留在审阅队列，返回 false）。 */
  private async publishSystem(
    space: WikiSpace,
    page: WikiPage,
    body: string,
    baseRevisionId: number | null,
    changeSummary: string,
  ): Promise<boolean> {
    const revision = await this.revisions.proposeRevision({
      page,
      space,
      body,
      authorKind: 'system',
      authorUserId: null,
      baseRevisionId,
      changeSummary,
    })
    if (revision.editClass !== 'bookkeeping') return false
    await this.revisions.publish(revision.id, space.organizationId, { kind: 'system' })
    return true
  }
}
