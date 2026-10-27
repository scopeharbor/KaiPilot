/**
 * v3-llm-wiki-memory-foundation —— 空间导出为 Markdown 文件夹（zip）。
 *
 * 只有空间审阅者可导出；内容与读取一致地按导出者权限遮蔽、去除已撤回主张；
 * 含目录 `_index.md` 与操作日志 `_log.md`。导出前经 DLP 预检，写低敏审计与操作日志。
 */
import { inject } from '@adonisjs/core'
import { parseWikiMarkdown, renderWikiMarkdown, WIKI_SYSTEM_PAGE_TYPES } from '@aiproj/types'
import WikiLogEntry from '#models/wiki_log_entry'
import WikiPage from '#models/wiki_page'
import WikiRevision from '#models/wiki_revision'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from './wiki_access_service.js'
import { wikiExportDlp, type WikiExportDlpPort } from './wiki_export_dlp.js'
import WikiReadService from './wiki_read_service.js'
import WikiRevisionService, { WIKI_INDEX_SLUG, sha256 } from './wiki_revision_service.js'
import WikiSpaceService from './wiki_space_service.js'
import { buildStoreZip, type ZipEntry } from './zip_store_writer.js'
import { WikiDlpBlockedError, WikiPermissionError } from './errors.js'

@inject()
export default class WikiExportService {
  /** 测试可替换；生产为企业 DLP 预检。 */
  dlp: WikiExportDlpPort = wikiExportDlp

  constructor(
    private readonly access: WikiAccessService,
    private readonly spaces: WikiSpaceService,
    private readonly reader: WikiReadService,
    private readonly revisions: WikiRevisionService,
    private readonly audit: AuditService,
  ) {}

  async exportSpace(actor: WikiActor, spaceId: number): Promise<{ filename: string; zip: Buffer }> {
    const space = await this.spaces.getReadable(actor, spaceId)
    if (!(await this.access.canReviewSpace(actor, space))) {
      throw new WikiPermissionError('只有本空间的审阅者可以导出')
    }
    const pages = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .where('status', 'active')
      .whereNotNull('published_revision_id')
      .orderBy('slug', 'asc')

    const entries: ZipEntry[] = []
    for (const page of pages) {
      if (!(await this.access.canReadPage(actor, space, page))) continue
      const revision = await WikiRevision.findOrFail(page.publishedRevisionId!)
      if (WIKI_SYSTEM_PAGE_TYPES.includes(page.pageType)) {
        if (page.slug === WIKI_INDEX_SLUG)
          entries.push({ name: '_index.md', content: revision.bodyMarkdown })
        continue
      }
      const claims = await this.reader.claimsFor(actor.organizationId, page.id, null)
      const rendered = await this.reader.render(actor, revision.bodyMarkdown, claims, true)
      const parsed = parseWikiMarkdown(revision.bodyMarkdown)
      const frontmatter = parsed.ok ? parsed.doc.frontmatter : {}
      entries.push({
        name: `${page.slug}.md`,
        content: renderWikiMarkdown(frontmatter, rendered.body),
      })
    }
    const log = await WikiLogEntry.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .orderBy('id', 'asc')
    entries.push({
      name: '_log.md',
      content: ['# 操作日志', '', ...log.map((l) => l.line), ''].join('\n'),
    })

    const text = entries.map((e) => e.content).join('\n\n')
    const allowed = await this.dlp.preflight({
      organizationId: actor.organizationId,
      projectId: space.scopeKind === 'project' ? Number(space.scopeRefId) : null,
      actorId: actor.user.id,
      text: text.slice(0, 200_000),
      sourceHash: sha256(text),
      itemCount: entries.length,
    })
    if (!allowed) throw new WikiDlpBlockedError()

    await this.revisions.appendLog(
      null,
      space,
      'export',
      `导出 ${entries.length - 1} 个文件`,
      'human',
      actor.user.id,
      null,
    )
    await this.audit.log({
      event: AuditEvent.WIKI_SPACE_EXPORTED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_space',
      entityId: space.id,
      metadata: { fileCount: entries.length },
    })
    return { filename: `wiki-space-${space.id}.zip`, zip: buildStoreZip(entries) }
  }
}
