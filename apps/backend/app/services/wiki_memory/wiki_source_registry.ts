/**
 * v3-llm-wiki-memory-foundation —— 主张来源登记表。
 *
 * 写入时：来源必须存在、与主张同组织、非 L3 合成知识（validateForWrite）。
 * 读取时：按读者权限判定每个来源是否可见（resolveVisibility）；未知类型 fail closed（不可见）。
 * 体检时：找出已被删除的来源（findMissing）。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { WIKI_SOURCE_KIND_LABELS, type WikiSourceKind, type WikiSourceRef } from '@aiproj/types'
import RbacService from '#services/rbac_service'
import { KNOWLEDGE_VIEW, PROJECT_VIEW } from '#start/rbac/permissions'
import type { WikiActor } from './wiki_access_service.js'
import WikiAccessService from './wiki_access_service.js'
import { WIKI_REGISTERED_GENERATORS } from './wiki_generators.js'

/** 归属于项目的业务来源：通过 projects.organization_id 判定组织归属。 */
const PROJECT_SCOPED: Partial<Record<WikiSourceKind, { table: string; softDelete: boolean }>> = {
  task: { table: 'tasks', softDelete: true },
  wbs_node: { table: 'wbs_nodes', softDelete: true },
  milestone: { table: 'milestones', softDelete: false },
  risk: { table: 'risks', softDelete: true },
  change_request: { table: 'change_requests', softDelete: true },
  comment: { table: 'comments', softDelete: true },
  document: { table: 'documents', softDelete: true },
}

export const sourceKey = (s: Pick<WikiSourceRef, 'kind' | 'id'>) => `${s.kind}#${s.id}`

export function sourceLabel(s: Pick<WikiSourceRef, 'kind' | 'id'>): string {
  return `${WIKI_SOURCE_KIND_LABELS[s.kind]} #${s.id}`
}

const isNumericId = (id: string) => /^\d{1,18}$/.test(id)

function groupByKind(sources: readonly WikiSourceRef[]) {
  const map = new Map<WikiSourceKind, Set<string>>()
  for (const s of sources) {
    if (!map.has(s.kind)) map.set(s.kind, new Set())
    map.get(s.kind)!.add(s.id)
  }
  return map
}

export interface WikiSourceVisibility {
  visible: boolean
  label: string
}

@inject()
export default class WikiSourceRegistry {
  constructor(
    private readonly rbac: RbacService,
    private readonly access: WikiAccessService,
  ) {}

  /** 查询存在于本组织的来源：返回 key → projectId（非项目来源为 null）。 */
  private async existing(
    organizationId: number,
    sources: readonly WikiSourceRef[],
  ): Promise<Map<string, { projectId: number | null; synthetic?: boolean }>> {
    const found = new Map<string, { projectId: number | null; synthetic?: boolean }>()
    for (const [kind, idSet] of groupByKind(sources)) {
      const ids = [...idSet]
      const numeric = ids.filter(isNumericId).map(Number)
      const scoped = PROJECT_SCOPED[kind]
      if (scoped) {
        if (numeric.length === 0) continue
        const q = db
          .from(`${scoped.table} as s`)
          .join('projects as p', 'p.id', 's.project_id')
          .where('p.organization_id', organizationId)
          .whereNull('p.deleted_at')
          .whereIn('s.id', numeric)
          .select('s.id', 's.project_id')
        if (scoped.softDelete) q.whereNull('s.deleted_at')
        for (const row of await q) {
          found.set(`${kind}#${row.id}`, { projectId: Number(row.project_id) })
        }
        continue
      }
      switch (kind) {
        case 'project': {
          if (numeric.length === 0) break
          const rows = await db
            .from('projects')
            .where('organization_id', organizationId)
            .whereNull('deleted_at')
            .whereIn('id', numeric)
            .select('id')
          for (const row of rows) found.set(`project#${row.id}`, { projectId: Number(row.id) })
          break
        }
        case 'knowledge_item': {
          if (numeric.length === 0) break
          const rows = await db
            .from('knowledge_items')
            .where('organization_id', organizationId)
            .whereIn('id', numeric)
            .select('id', 'layer', 'is_synthetic')
          for (const row of rows) {
            found.set(`knowledge_item#${row.id}`, {
              projectId: null,
              synthetic: row.layer === 'L3' || Boolean(row.is_synthetic),
            })
          }
          break
        }
        case 'wiki_page': {
          if (numeric.length === 0) break
          const rows = await db
            .from('wiki_pages')
            .where('organization_id', organizationId)
            .whereIn('id', numeric)
            .select('id')
          for (const row of rows) found.set(`wiki_page#${row.id}`, { projectId: null })
          break
        }
        case 'user_statement': {
          if (numeric.length === 0) break
          const members = await db
            .from('organization_members')
            .where('organization_id', organizationId)
            .whereIn('user_id', numeric)
            .select('user_id')
          const owner = await db
            .from('organizations')
            .where('id', organizationId)
            .select('owner_id')
            .first()
          const ok = new Set(members.map((m) => String(m.user_id)))
          if (owner) ok.add(String(owner.owner_id))
          for (const id of ids)
            if (ok.has(id)) found.set(`user_statement#${id}`, { projectId: null })
          break
        }
        case 'derived_query': {
          for (const id of ids) {
            if (WIKI_REGISTERED_GENERATORS.has(id))
              found.set(`derived_query#${id}`, { projectId: null })
          }
          break
        }
        default:
          break
      }
    }
    return found
  }

  /** 写入前校验；返回逐条错误（为空即通过）。 */
  async validateForWrite(
    organizationId: number,
    sources: readonly WikiSourceRef[],
  ): Promise<string[]> {
    const found = await this.existing(organizationId, sources)
    const errors: string[] = []
    const seen = new Set<string>()
    for (const s of sources) {
      const key = sourceKey(s)
      if (seen.has(key)) continue
      seen.add(key)
      const hit = found.get(key)
      if (!hit) errors.push(`来源「${sourceLabel(s)}」不存在或不属于本组织`)
      else if (hit.synthetic)
        errors.push(`来源「${sourceLabel(s)}」是 L3 合成知识，不能作为主张依据`)
    }
    return errors
  }

  /** 体检：本组织内已不存在（被删除）的来源 key。 */
  async findMissing(
    organizationId: number,
    sources: readonly WikiSourceRef[],
  ): Promise<Set<string>> {
    const found = await this.existing(organizationId, sources)
    return new Set(sources.map(sourceKey).filter((k) => !found.has(k)))
  }

  /** 读取：按读者权限判定每个来源是否可见。 */
  async resolveVisibility(
    actor: WikiActor,
    sources: readonly WikiSourceRef[],
  ): Promise<Map<string, WikiSourceVisibility>> {
    const out = new Map<string, WikiSourceVisibility>()
    if (sources.length === 0) return out
    const found = await this.existing(actor.organizationId, sources)
    const projectVisible = new Map<number, boolean>()
    const canSeeProject = async (projectId: number) => {
      if (!projectVisible.has(projectId)) {
        const r = await this.rbac.check(actor.user, PROJECT_VIEW, actor.organizationId, projectId)
        projectVisible.set(projectId, r.allowed)
      }
      return projectVisible.get(projectId)!
    }
    let knowledgeVisible: boolean | null = null

    for (const s of sources) {
      const key = sourceKey(s)
      if (out.has(key)) continue
      const hit = found.get(key)
      let visible = false
      if (hit && !hit.synthetic) {
        if (hit.projectId !== null) visible = await canSeeProject(hit.projectId)
        else if (s.kind === 'knowledge_item') {
          if (knowledgeVisible === null) {
            const result = await this.rbac.check(actor.user, KNOWLEDGE_VIEW, actor.organizationId)
            knowledgeVisible = result.allowed
          }
          visible = knowledgeVisible
        } else if (s.kind === 'wiki_page') {
          visible = await this.canReadWikiPage(actor, Number(s.id))
        } else visible = s.kind === 'user_statement' || s.kind === 'derived_query'
      }
      out.set(key, { visible, label: sourceLabel(s) })
    }
    return out
  }

  private async canReadWikiPage(actor: WikiActor, pageId: number): Promise<boolean> {
    const { default: WikiPage } = await import('#models/wiki_page')
    const { default: WikiSpace } = await import('#models/wiki_space')
    const page = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('id', pageId)
      .first()
    if (!page) return false
    const space = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('id', page.spaceId)
      .first()
    return !!space && (await this.access.canReadPage(actor, space, page))
  }
}
