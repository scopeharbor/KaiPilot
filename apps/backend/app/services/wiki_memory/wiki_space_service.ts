/**
 * v3-llm-wiki-memory-foundation —— 维基空间：按作用域幂等解析/创建，读取前校验权限。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { WikiScopeKind, WikiSpaceDto } from '@aiproj/types'
import WikiSpace from '#models/wiki_space'
import RbacService from '#services/rbac_service'
import WikiAccessService, { type WikiActor } from './wiki_access_service.js'
import { WikiNotFoundError } from './errors.js'

@inject()
export default class WikiSpaceService {
  constructor(
    private readonly access: WikiAccessService,
    private readonly rbac: RbacService,
  ) {}

  /** 作用域对象存在于本组织时返回空间标题，否则 null。 */
  private async scopeTitle(
    actor: WikiActor,
    scopeKind: WikiScopeKind,
    scopeRefId: number,
  ): Promise<string | null> {
    const org = actor.organizationId
    switch (scopeKind) {
      case 'organization':
        return scopeRefId === org ? '组织维基' : null
      case 'department': {
        const row = await db
          .from('departments')
          .where('organization_id', org)
          .where('id', scopeRefId)
          .whereNull('deleted_at')
          .select('name')
          .first()
        return row ? `${row.name} 维基` : null
      }
      case 'project': {
        if (!(await this.rbac.projectExistsInOrg(scopeRefId, org))) return null
        const row = await db.from('projects').where('id', scopeRefId).select('name').first()
        return `${row?.name ?? '项目'} 维基`
      }
      case 'user':
        return scopeRefId === Number(actor.user.id) ? '我的维基' : null
      default:
        return null
    }
  }

  /** 解析（不存在则创建）作用域空间；作用域不存在或无权读取 → 404。 */
  async resolve(
    actor: WikiActor,
    scopeKind: WikiScopeKind,
    scopeRefId: number,
  ): Promise<WikiSpace> {
    const title = await this.scopeTitle(actor, scopeKind, scopeRefId)
    const probe = { organizationId: actor.organizationId, scopeKind, scopeRefId }
    if (!title || !(await this.access.canReadSpace(actor, probe))) throw new WikiNotFoundError()
    const existing = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('scope_kind', scopeKind)
      .where('scope_ref_id', scopeRefId)
      .first()
    if (existing) return existing
    try {
      return await WikiSpace.create({ ...probe, title, createdBy: actor.user.id })
    } catch {
      // 并发创建撞唯一键：返回先建成的那个
      return WikiSpace.query()
        .where('organization_id', actor.organizationId)
        .where('scope_kind', scopeKind)
        .where('scope_ref_id', scopeRefId)
        .firstOrFail()
    }
  }

  /** 按 ID 读取可读空间；跨组织或无权 → 404。 */
  async getReadable(actor: WikiActor, spaceId: number): Promise<WikiSpace> {
    const space = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('id', spaceId)
      .first()
    if (!space || !(await this.access.canReadSpace(actor, space))) throw new WikiNotFoundError()
    return space
  }

  async toDto(actor: WikiActor, space: WikiSpace): Promise<WikiSpaceDto> {
    const [pages] = await db
      .from('wiki_pages')
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .where('status', 'active')
      .whereNotIn('page_type', ['index', 'log'])
      .count('* as total')
    const canReview = await this.access.canReviewSpace(actor, space)
    let pending = 0
    if (canReview) {
      const [row] = await db
        .from('wiki_revisions as r')
        .join('wiki_pages as p', 'p.id', 'r.page_id')
        .where('r.organization_id', actor.organizationId)
        .where('p.space_id', space.id)
        .where('r.status', 'proposed')
        .count('* as total')
      pending = Number(row.total)
    }
    return {
      id: space.id,
      scopeKind: space.scopeKind,
      scopeRefId: Number(space.scopeRefId),
      title: space.title,
      canReview,
      canPropose: await this.access.canProposeInSpace(actor, space),
      pageCount: Number(pages.total),
      pendingProposalCount: pending,
    }
  }

  /** 读者可读的全部既有空间。 */
  async listReadable(actor: WikiActor): Promise<WikiSpace[]> {
    const spaces = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .orderBy('id', 'asc')
    const out: WikiSpace[] = []
    for (const s of spaces) if (await this.access.canReadSpace(actor, s)) out.push(s)
    return out
  }

  /** 本组织的组织空间（不存在返回 null；墓碑跨空间生效时使用）。 */
  async organizationSpaceId(organizationId: number): Promise<number | null> {
    const row = await WikiSpace.query()
      .where('organization_id', organizationId)
      .where('scope_kind', 'organization')
      .where('scope_ref_id', organizationId)
      .first()
    return row?.id ?? null
  }
}
