/**
 * v2-pdm-migration-compatibility —— V1 Read Adapter（Section 10.2）。
 *
 * 复用既有 Service/API 读取语义，包含软删除默认过滤和权限结果。
 * 输出与 PdmReadAdapter 同形的摘要，供 DualReadVerifier 比较。
 */
import db from '@adonisjs/lucid/services/db'
import { createHash } from 'node:crypto'
import type { EntityDigest } from './pdm_read_adapter.js'

export class V1ReadAdapter {
  /**
   * 从 V1 表读取项目摘要（复用既有查询语义）。
   */
  async getProjectDigest(projectId: number, organizationId: number): Promise<EntityDigest[]> {
    // 项目
    const project = await db
      .from('projects')
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    const projectHash = project
      ? createHash('sha256')
          .update(JSON.stringify(project, Object.keys(project).sort()), 'utf-8')
          .digest('hex')
          .slice(0, 16)
      : 'not_found'

    // WBS
    const wbsNodes = await db
      .from('wbs_nodes')
      .where('project_id', projectId)
      .whereNull('deleted_at')
    const wbsHash = this.combinedHash(wbsNodes.map((r: any) => JSON.stringify(r)))

    // 任务
    const tasks = await db.from('tasks').where('project_id', projectId).whereNull('deleted_at')
    const taskStatuses: Record<string, number> = {}
    for (const t of tasks) {
      const s = t.status ?? 'unknown'
      taskStatuses[s] = (taskStatuses[s] ?? 0) + 1
    }
    const taskHash = this.combinedHash(tasks.map((r: any) => JSON.stringify(r)))

    // 依赖
    const deps = await db
      .from('task_dependencies')
      .join('tasks as pred', 'task_dependencies.predecessor_id', 'pred.id')
      .where('pred.project_id', projectId)
      .select('task_dependencies.*')
    const depHash = this.combinedHash(deps.map((r: any) => JSON.stringify(r)))

    // 里程碑
    const milestones = await db.from('milestones').where('project_id', projectId)
    const msHash = this.combinedHash(milestones.map((r: any) => JSON.stringify(r)))

    // 资源
    const resources = await db
      .from('resources')
      .where('project_id', projectId)
      .whereNull('deleted_at')
    const resHash = this.combinedHash(resources.map((r: any) => JSON.stringify(r)))

    // 风险
    const risks = await db.from('risks').where('project_id', projectId).whereNull('deleted_at')
    const riskHash = this.combinedHash(risks.map((r: any) => JSON.stringify(r)))

    return [
      { entityType: 'project', count: project ? 1 : 0, fieldHash: projectHash, statusSummary: {} },
      { entityType: 'wbs_node', count: wbsNodes.length, fieldHash: wbsHash, statusSummary: {} },
      { entityType: 'task', count: tasks.length, fieldHash: taskHash, statusSummary: taskStatuses },
      { entityType: 'dependency', count: deps.length, fieldHash: depHash, statusSummary: {} },
      { entityType: 'milestone', count: milestones.length, fieldHash: msHash, statusSummary: {} },
      { entityType: 'resource', count: resources.length, fieldHash: resHash, statusSummary: {} },
      { entityType: 'risk', count: risks.length, fieldHash: riskHash, statusSummary: {} },
    ]
  }

  /**
   * 读取 V1 AI 草案摘要。
   */
  async getDraftDigest(draftId: number, organizationId: number): Promise<EntityDigest[]> {
    const draft = await db
      .from('ai_project_drafts')
      .where('id', draftId)
      .where('organization_id', organizationId)
      .first()
    if (!draft) return []

    const versions = await db.from('ai_project_draft_versions').where('draft_id', draftId)

    return [
      {
        entityType: 'draft',
        count: 1,
        fieldHash: createHash('sha256')
          .update(JSON.stringify(draft, Object.keys(draft).sort()), 'utf-8')
          .digest('hex')
          .slice(0, 16),
        statusSummary: {},
      },
      {
        entityType: 'draft_version',
        count: versions.length,
        fieldHash: this.combinedHash(versions.map((r: any) => JSON.stringify(r))),
        statusSummary: {},
      },
    ]
  }

  private combinedHash(jsonStrings: string[]): string {
    return createHash('sha256')
      .update(jsonStrings.sort().join(''), 'utf-8')
      .digest('hex')
      .slice(0, 16)
  }
}
