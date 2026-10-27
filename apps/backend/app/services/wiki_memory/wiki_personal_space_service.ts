/**
 * v3-llm-wiki-memory-foundation —— 个人空间：逐页授权与一键清空。
 *
 * - 授权：只有本人可改；只能授权给本组织内的项目，被授权项目的项目经理只读（默认不授权）；
 * - 清空：删除个人空间全部页面（修订正文、主张文本、来源、链接、检索投影、体检发现）与旧日志，
 *   先为所有主张写入撤回指纹以防重新编入；审计只记条数。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { WikiSharedWithMeDto } from '@aiproj/types'
import WikiClaim from '#models/wiki_claim'
import WikiPage from '#models/wiki_page'
import WikiRetraction from '#models/wiki_retraction'
import User from '#models/user'
import WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import RbacService from '#services/rbac_service'
import type { WikiActor } from './wiki_access_service.js'
import WikiReadService from './wiki_read_service.js'
import WikiRevisionService from './wiki_revision_service.js'
import { WikiNotFoundError, WikiPermissionError, WikiValidationError } from './errors.js'

export const WIKI_MAX_SHARED_PROJECTS = 20
/** 「授权给我的个人页」最多列出的页面数。 */
export const WIKI_SHARED_WITH_ME_LIMIT = 200

@inject()
export default class WikiPersonalSpaceService {
  constructor(
    private readonly rbac: RbacService,
    private readonly revisions: WikiRevisionService,
    private readonly audit: AuditService,
    private readonly reader: WikiReadService,
  ) {}

  /**
   * 授权给我的个人页（v3-llm-wiki-person-space D4）：本组织成员授权给「我担任项目经理的项目」的个人页，
   * 与读时权限同一判定；不含本人页面与受限页面；按页面 id 升序，不汇总、不排序比较。
   */
  async sharedWithMe(actor: WikiActor): Promise<WikiSharedWithMeDto[]> {
    const rows = await db
      .from('wiki_pages as p')
      .join('wiki_spaces as s', 's.id', 'p.space_id')
      .where('p.organization_id', actor.organizationId)
      .where('s.organization_id', actor.organizationId)
      .where('s.scope_kind', 'user')
      .whereNot('s.scope_ref_id', actor.user.id)
      .where('p.status', 'active')
      .where('p.sensitivity', 'normal')
      .whereNotNull('p.shared_with_project_ids_json')
      .orderBy('p.id', 'asc')
      .limit(WIKI_SHARED_WITH_ME_LIMIT)
      .select('p.id as page_id', 's.scope_ref_id as owner_id')
    const managed = new Map<number, boolean>()
    const isManager = async (projectId: number) => {
      if (!managed.has(projectId))
        managed.set(
          projectId,
          (await this.rbac.projectExistsInOrg(projectId, actor.organizationId)) &&
            (await this.rbac.isProjectManager(actor.user, projectId)),
        )
      return managed.get(projectId)!
    }
    const out: WikiSharedWithMeDto[] = []
    for (const row of rows) {
      const page = await WikiPage.query()
        .where('organization_id', actor.organizationId)
        .where('id', Number(row.page_id))
        .first()
      if (!page) continue
      const projectIds: number[] = []
      for (const projectId of page.sharedWithProjectIds ?? [])
        if (await isManager(Number(projectId))) projectIds.push(Number(projectId))
      if (projectIds.length === 0) continue
      const owner = await User.find(Number(row.owner_id))
      out.push({
        page: this.reader.summaryDto(page, false),
        ownerName: owner?.fullName?.trim() || owner?.email || '成员',
        projectIds,
      })
    }
    return out
  }

  private async ownSpace(actor: WikiActor, spaceId: number): Promise<WikiSpace> {
    const space = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('id', spaceId)
      .first()
    if (!space) throw new WikiNotFoundError()
    if (space.scopeKind !== 'user') throw new WikiPermissionError('只有个人空间支持此操作')
    if (Number(space.scopeRefId) !== Number(actor.user.id)) throw new WikiNotFoundError()
    return space
  }

  async updateSharing(actor: WikiActor, pageId: number, projectIds: number[]): Promise<number[]> {
    const page = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('id', pageId)
      .first()
    if (!page) throw new WikiNotFoundError()
    await this.ownSpace(actor, page.spaceId)
    const unique = [...new Set(projectIds.map(Number))].sort((a, b) => a - b)
    if (unique.length > WIKI_MAX_SHARED_PROJECTS) {
      throw new WikiValidationError(`最多授权 ${WIKI_MAX_SHARED_PROJECTS} 个项目`)
    }
    for (const projectId of unique) {
      if (
        !Number.isSafeInteger(projectId) ||
        !(await this.rbac.projectExistsInOrg(projectId, actor.organizationId))
      ) {
        throw new WikiValidationError('只能授权给本组织内存在的项目')
      }
    }
    page.sharedWithProjectIds = unique.length ? unique : null
    await page.save()
    await this.audit.log({
      event: AuditEvent.WIKI_PAGE_SHARING_UPDATED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_page',
      entityId: page.id,
      metadata: { sharedProjectCount: unique.length },
    })
    return unique
  }

  async clear(actor: WikiActor, spaceId: number): Promise<{ pagesDeleted: number }> {
    const space = await this.ownSpace(actor, spaceId)
    const pages = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
    const claims = pages.length
      ? await WikiClaim.query()
          .where('organization_id', actor.organizationId)
          .whereIn(
            'page_id',
            pages.map((p) => p.id),
          )
      : []
    const fingerprints = [...new Set(claims.map((c) => c.fingerprint))]

    await db.transaction(async (trx) => {
      const existingRows = await WikiRetraction.query({ client: trx })
        .where('organization_id', actor.organizationId)
        .where('space_id', space.id)
      const existing = new Set(existingRows.map((r) => r.claimFingerprint))
      const fresh = fingerprints.filter((f) => !existing.has(f))
      if (fresh.length) {
        await WikiRetraction.createMany(
          fresh.map((f) => ({
            organizationId: actor.organizationId,
            spaceId: space.id,
            claimFingerprint: f,
            reason: '本人清空个人空间',
            retractedBy: actor.user.id,
          })),
          { client: trx },
        )
      }
      // 页面删除级联：修订、主张、来源、链接、检索投影、体检发现
      await trx
        .from('wiki_pages')
        .where('organization_id', actor.organizationId)
        .where('space_id', space.id)
        .delete()
      await trx
        .from('wiki_log_entries')
        .where('organization_id', actor.organizationId)
        .where('space_id', space.id)
        .delete()
    })

    await this.revisions.appendLog(
      null,
      space,
      'clear',
      '本人清空个人空间',
      'human',
      actor.user.id,
      null,
    )
    await this.audit.log({
      event: AuditEvent.WIKI_PERSONAL_SPACE_CLEARED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_space',
      entityId: space.id,
      metadata: { pagesDeleted: pages.length, fingerprintsKept: fingerprints.length },
    })
    return { pagesDeleted: pages.length }
  }
}
