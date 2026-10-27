/**
 * v3-llm-wiki-person-space —— 从 AI 记忆导入偏好（design D3）。
 *
 * 只读调用者本人的用户级 Copilot 记忆（未失效），确定性转换为本人「工作偏好」页的偏好主张，
 * 以 AI 作者提交为待审知识修订（本人在审阅队列确认后才生效）；不调用模型，不改动 Copilot 记忆。
 */
import { inject } from '@adonisjs/core'
import {
  WIKI_PERSON_IMPORT_MAX,
  WIKI_PERSON_PREFERENCES_SLUG,
  parseWikiMarkdown,
  planWikiPreferenceImport,
  truncateWikiSummary,
  wikiPersonPreferencesSkeleton,
} from '@aiproj/types'
import CopilotMemoryEntry from '#models/copilot_memory_entry'
import WikiPage from '#models/wiki_page'
import WikiRetraction from '#models/wiki_retraction'
import WikiRevision from '#models/wiki_revision'
import type WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { WikiActor } from '../wiki_access_service.js'
import WikiRevisionService, { claimFingerprint } from '../wiki_revision_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import WikiSpaceService from '../wiki_space_service.js'

const IMPORTABLE_STATUSES = ['candidate', 'confirmed', 'edited'] as const

export interface WikiMemoryImportResult {
  imported: number
  skipped: number
  pageId: number | null
  revisionId: number | null
}

@inject()
export default class WikiPersonalMemoryImportService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly spaces: WikiSpaceService,
    private readonly revisions: WikiRevisionService,
    private readonly audit: AuditService,
  ) {}

  async importFromCopilotMemory(actor: WikiActor): Promise<WikiMemoryImportResult> {
    await this.settings.assertEnabled(actor.organizationId)
    const space = await this.spaces.resolve(actor, 'user', actor.user.id)
    const entries = await CopilotMemoryEntry.query()
      .where('organization_id', actor.organizationId)
      .where('actor_id', actor.user.id)
      .where('memory_scope', 'user')
      .whereIn('status', [...IMPORTABLE_STATUSES])
      .orderBy('id', 'asc')
      .limit(WIKI_PERSON_IMPORT_MAX)

    const existing = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .where('slug', WIKI_PERSON_PREFERENCES_SLUG)
      .first()
    const published = existing?.publishedRevisionId
      ? await WikiRevision.find(existing.publishedRevisionId)
      : null
    const baseSource = published?.bodyMarkdown ?? wikiPersonPreferencesSkeleton()

    const tombstoneRows = await WikiRetraction.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .select('claim_fingerprint')
    const tombstones = new Set(tombstoneRows.map((r) => r.claimFingerprint))
    const plan = planWikiPreferenceImport({
      baseSource,
      summaries: entries.map((e) => e.summary),
      userId: actor.user.id,
      isRetracted: (statement) => tombstones.has(claimFingerprint(statement)),
    })

    let result: WikiMemoryImportResult = {
      imported: 0,
      skipped: plan.skipped,
      pageId: existing?.id ?? null,
      revisionId: null,
    }
    if (plan.body) {
      const page = existing ?? (await this.createPage(actor, space, baseSource))
      let revision: WikiRevision
      try {
        revision = await this.revisions.proposeRevision({
          page,
          space,
          body: plan.body,
          authorKind: 'ai',
          authorUserId: null,
          baseRevisionId: published?.id ?? null,
          changeSummary: `从 AI 记忆导入 ${plan.imported.length} 条偏好（待本人确认）`,
        })
      } catch (error) {
        if (!existing) await page.delete()
        throw error
      }
      result = {
        imported: plan.imported.length,
        skipped: plan.skipped,
        pageId: page.id,
        revisionId: revision.id,
      }
    }
    await this.audit.log({
      event: AuditEvent.WIKI_PERSON_MEMORY_IMPORTED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_space',
      entityId: space.id,
      metadata: { imported: result.imported, skipped: result.skipped },
    })
    return result
  }

  /** 新建空的偏好页（尚无已发布版本，导入提议即首个修订）。 */
  private async createPage(actor: WikiActor, space: WikiSpace, skeleton: string) {
    const doc = parseWikiMarkdown(skeleton)
    return WikiPage.create({
      organizationId: actor.organizationId,
      spaceId: space.id,
      slug: WIKI_PERSON_PREFERENCES_SLUG,
      pageType: 'person',
      title: doc.ok ? String(doc.doc.frontmatter.title) : '我的工作偏好',
      summaryLine: truncateWikiSummary(doc.ok ? String(doc.doc.frontmatter.summary ?? '') : ''),
      status: 'active',
      ownerUserId: actor.user.id,
      publishedRevisionId: null,
      sensitivity: 'normal',
      staleAfterDays: null,
      sharedWithProjectIds: null,
      lastPublishedAt: null,
      createdBy: actor.user.id,
    })
  }
}
