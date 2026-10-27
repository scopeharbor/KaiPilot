/**
 * v3-llm-wiki-retrospective-lessons —— 结项复盘页刷新（design D2）。
 *
 * 只在项目结项（已完成 / 已取消 / 已归档）后，由项目空间审阅者（或睡眠整理以组织所有者身份）生成；
 * 统计只读本项目的任务、风险与变更请求，经派生页写入器写入（纯派生新页按簿记发布，刷新只替换派生段、保留人写教训）。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  WIKI_RETROSPECTIVE_CLOSED_STATUSES,
  WIKI_RETROSPECTIVE_GENERATOR,
  WIKI_RETROSPECTIVE_KEY_PREFIX,
  WIKI_RETROSPECTIVE_SLUG,
  computeWikiRetrospective,
  renderWikiRetrospectiveBlock,
  wikiRetrospectivePageBody,
  type WikiDossierRefreshSummary,
} from '@aiproj/types'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import WikiDerivedPageWriter from '../wiki_derived_page_writer.js'
import WikiSettingsService from '../wiki_settings_service.js'
import WikiSpaceService from '../wiki_space_service.js'
import { WikiNotFoundError, WikiPermissionError, WikiValidationError } from '../errors.js'

/** 睡眠整理：只处理这么多天内更新过的结项项目，每组织最多这么多个。 */
export const WIKI_RETROSPECTIVE_RECENT_DAYS = 90
export const WIKI_RETROSPECTIVE_CONSOLIDATE_LIMIT = 20

/** 数据库日期值（Date / 字符串）→ YYYY-MM-DD。 */
function toDay(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

const isClosed = (status: string) =>
  (WIKI_RETROSPECTIVE_CLOSED_STATUSES as readonly string[]).includes(status)

@inject()
export default class WikiRetrospectiveService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly spaces: WikiSpaceService,
    private readonly access: WikiAccessService,
    private readonly writer: WikiDerivedPageWriter,
    private readonly audit: AuditService,
  ) {}

  async refresh(actor: WikiActor, projectId: number): Promise<WikiDossierRefreshSummary> {
    await this.settings.assertEnabled(actor.organizationId)
    const project = await db
      .from('projects')
      .where('organization_id', actor.organizationId)
      .where('id', projectId)
      .whereNull('deleted_at')
      .first()
    if (!project) throw new WikiNotFoundError()
    const space = await this.spaces.resolve(actor, 'project', projectId)
    if (!(await this.access.canReviewSpace(actor, space)))
      throw new WikiPermissionError('只有本项目维基的审阅者可以生成项目复盘')
    if (!isClosed(String(project.status)))
      throw new WikiValidationError('项目结项（已完成、已取消或已归档）后才生成复盘')

    const summary: WikiDossierRefreshSummary = { created: 0, updated: 0, unchanged: 0, skipped: 0 }
    const stats = computeWikiRetrospective(await this.collect(actor.organizationId, project))
    if (stats) {
      const block = renderWikiRetrospectiveBlock(stats)
      await this.writer.upsert(
        actor,
        space,
        {
          slug: WIKI_RETROSPECTIVE_SLUG,
          pageType: 'lesson',
          generatorId: WIKI_RETROSPECTIVE_GENERATOR,
          keyPrefix: WIKI_RETROSPECTIVE_KEY_PREFIX,
          block,
          fullBody: () => wikiRetrospectivePageBody(block),
          label: '项目复盘',
        },
        summary,
      )
    } else summary.skipped++

    await this.audit.log({
      event: AuditEvent.WIKI_RETROSPECTIVE_REFRESHED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      projectId,
      entityType: 'wiki_space',
      entityId: space.id,
      metadata: { ...summary },
    })
    return summary
  }

  /** 睡眠整理：最近结项的项目逐个刷新，单个失败只计数。 */
  async refreshRecent(owner: WikiActor, now = DateTime.now()): Promise<WikiDossierRefreshSummary> {
    const projects = await db
      .from('projects')
      .where('organization_id', owner.organizationId)
      .whereNull('deleted_at')
      .whereIn('status', [...WIKI_RETROSPECTIVE_CLOSED_STATUSES])
      .where('updated_at', '>=', now.minus({ days: WIKI_RETROSPECTIVE_RECENT_DAYS }).toSQL()!)
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(WIKI_RETROSPECTIVE_CONSOLIDATE_LIMIT)
      .select('id')
    const total: WikiDossierRefreshSummary = { created: 0, updated: 0, unchanged: 0, skipped: 0 }
    for (const p of projects) {
      try {
        const s = await this.refresh(owner, Number(p.id))
        total.created += s.created
        total.updated += s.updated
        total.unchanged += s.unchanged
        total.skipped += s.skipped
      } catch {
        total.skipped++
      }
    }
    return total
  }

  private async collect(organizationId: number, project: Record<string, unknown>) {
    const projectId = Number(project.id)
    const tasks = await db
      .from('tasks')
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .whereNot('task_type', 'summary')
      .orderBy('id', 'asc')
      .select('name', 'status', 'end_date', 'actual_end_date')
    const risks = await db
      .from('risks')
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .select('status')
    const changes = await db
      .from('change_requests')
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .select('status', 'approved_at')
    return {
      plannedStart: toDay(project.start_date),
      plannedEnd: toDay(project.end_date),
      actualEnd: toDay(project.actual_end_date),
      tasks: tasks.map((t) => ({
        name: String(t.name ?? ''),
        completed: t.status === 'completed',
        plannedEnd: toDay(t.end_date),
        actualEnd: toDay(t.actual_end_date),
      })),
      riskStatuses: risks.map((r) => String(r.status)),
      changes: changes.map((c) => ({
        submitted: c.status !== 'draft',
        approved: c.approved_at !== null && c.approved_at !== undefined,
      })),
    }
  }
}
