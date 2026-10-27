/**
 * v3-llm-wiki-rag-retirement —— 项目 / 组织 AI 同事记忆迁移为维基待审提议（design D3）。
 *
 * 项目或组织维基的审阅者触发：读本范围未失效的 Copilot 记忆（项目级按项目、组织级按组织），
 * 确定性整理为本空间「AI 同事记忆（迁移）」页的推断主张（来源为当初提问者的陈述），以 AI 作者提交为待审修订；
 * 审阅后才生效。不调用模型、不改 Copilot 记忆。个人级沿用 M6 的偏好导入；部门空间不支持。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import {
  WIKI_MEMORY_MIGRATION_MAX,
  WIKI_MEMORY_MIGRATION_SLUG,
  parseWikiMarkdown,
  planWikiMemoryMigration,
  truncateWikiSummary,
  wikiMemoryMigrationSkeleton,
} from '@aiproj/types'
import CopilotMemoryEntry from '#models/copilot_memory_entry'
import WikiPage from '#models/wiki_page'
import WikiRetraction from '#models/wiki_retraction'
import WikiRevision from '#models/wiki_revision'
import WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import WikiRevisionService, { claimFingerprint } from '../wiki_revision_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import { WikiNotFoundError, WikiPermissionError, WikiValidationError } from '../errors.js'

const MIGRATABLE_STATUSES = ['candidate', 'confirmed', 'edited'] as const

export interface WikiMemoryMigrationResult {
  imported: number
  skipped: number
  pageId: number | null
  revisionId: number | null
}

@inject()
export default class WikiMemoryMigrationService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly access: WikiAccessService,
    private readonly revisions: WikiRevisionService,
    private readonly audit: AuditService,
  ) {}

  async migrate(actor: WikiActor, spaceId: number): Promise<WikiMemoryMigrationResult> {
    await this.settings.assertEnabled(actor.organizationId)
    const space = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('id', spaceId)
      .first()
    if (!space || !(await this.access.canReadSpace(actor, space))) throw new WikiNotFoundError()
    if (space.scopeKind !== 'project' && space.scopeKind !== 'organization')
      throw new WikiValidationError(
        space.scopeKind === 'user'
          ? '个人空间请用「从 AI 记忆导入偏好」'
          : '部门空间暂不支持迁移 AI 同事记忆',
      )
    if (!(await this.access.canReviewSpace(actor, space)))
      throw new WikiPermissionError('只有本空间的审阅者可以迁移 AI 同事记忆')
    const scope = space.scopeKind

    const query = CopilotMemoryEntry.query()
      .where('organization_id', actor.organizationId)
      .where('memory_scope', scope)
      .whereIn('status', [...MIGRATABLE_STATUSES])
      .orderBy('id', 'asc')
    if (scope === 'project') query.where('project_id', space.scopeRefId)
    const entries = await query.limit(WIKI_MEMORY_MIGRATION_MAX)

    // 来源是提问者陈述：只保留仍是组织成员（或所有者）的提问者
    const memberRows = await db
      .from('organization_members')
      .where('organization_id', actor.organizationId)
      .select('user_id')
    const members = new Set(memberRows.map((r) => Number(r.user_id)))
    const owner = await db
      .from('organizations')
      .where('id', actor.organizationId)
      .select('owner_id')
      .first()
    if (owner?.owner_id) members.add(Number(owner.owner_id))
    const current = entries.filter((e) => members.has(Number(e.actorId)))

    const existing = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .where('slug', WIKI_MEMORY_MIGRATION_SLUG)
      .first()
    const published = existing?.publishedRevisionId
      ? await WikiRevision.find(existing.publishedRevisionId)
      : null
    const baseSource = published?.bodyMarkdown ?? wikiMemoryMigrationSkeleton(scope)
    const tombstoneRows = await WikiRetraction.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .select('claim_fingerprint')
    const tombstones = new Set(tombstoneRows.map((r) => r.claimFingerprint))
    const plan = planWikiMemoryMigration({
      baseSource,
      entries: current.map((e) => ({ summary: e.summary, actorId: Number(e.actorId) })),
      isRetracted: (statement) => tombstones.has(claimFingerprint(statement)),
    })

    let result: WikiMemoryMigrationResult = {
      imported: 0,
      skipped: plan.skipped + (entries.length - current.length),
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
          changeSummary: `从 AI 同事记忆迁移 ${plan.imported.length} 条（待审）`,
        })
      } catch (error) {
        if (!existing) await page.delete()
        throw error
      }
      result = {
        ...result,
        imported: plan.imported.length,
        pageId: page.id,
        revisionId: revision.id,
      }
    }
    await this.audit.log({
      event: AuditEvent.WIKI_COPILOT_MEMORY_MIGRATED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_space',
      entityId: space.id,
      metadata: { scope, imported: result.imported, skipped: result.skipped },
    })
    return result
  }

  /** 新建空的迁移页（尚无已发布版本，迁移提议即首个修订）。 */
  private async createPage(actor: WikiActor, space: WikiSpace, skeleton: string) {
    const doc = parseWikiMarkdown(skeleton)
    return WikiPage.create({
      organizationId: actor.organizationId,
      spaceId: space.id,
      slug: WIKI_MEMORY_MIGRATION_SLUG,
      pageType: 'digest',
      title: doc.ok ? String(doc.doc.frontmatter.title) : 'AI 同事记忆（迁移）',
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
}
