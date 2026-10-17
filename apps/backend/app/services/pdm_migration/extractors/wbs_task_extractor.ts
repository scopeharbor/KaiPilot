/**
 * v2-pdm-migration-compatibility —— WBS/Task/Dependency/Milestone Extractor（Section 4.2）。
 *
 * 保留父链、材质化路径、任务状态、依赖类型与 lag。
 */
import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import type { CanonicalProjectEntity, CanonicalProjectSnapshot } from '../types.js'
import db from '@adonisjs/lucid/services/db'

export class WbsTaskExtractor {
  /**
   * 将 WBS 节点、任务、依赖、里程碑抽取到已存在的快照中。
   */
  async extractInto(snapshot: CanonicalProjectSnapshot): Promise<void> {
    const projectId = snapshot.projectId
    const orgId = snapshot.organizationId

    // WBS 节点
    const wbsRows = await db
      .from('wbs_nodes')
      .where('project_id', projectId)
      .whereNull('deleted_at')
    for (const row of wbsRows) {
      snapshot.wbsNodes.push(this.rowToEntity('wbs_nodes', row, orgId))
    }

    // 任务（包括已软删除，记录 deleted_at）
    const taskRows = await db.from('tasks').where('project_id', projectId)
    for (const row of taskRows) {
      snapshot.tasks.push(this.rowToEntity('tasks', row, orgId))
    }

    // 依赖
    const depRows = await db
      .from('task_dependencies')
      .join('tasks as pred', 'task_dependencies.predecessor_id', 'pred.id')
      .join('tasks as succ', 'task_dependencies.successor_id', 'succ.id')
      .where('pred.project_id', projectId)
      .select('task_dependencies.*')
    for (const row of depRows) {
      snapshot.dependencies.push(this.rowToEntity('task_dependencies', row, orgId))
    }

    // 里程碑
    const milestoneRows = await db.from('milestones').where('project_id', projectId)
    for (const row of milestoneRows) {
      snapshot.milestones.push(this.rowToEntity('milestones', row, orgId))
    }
  }

  private rowToEntity(table: string, row: any, orgId: number): CanonicalProjectEntity {
    const fields: Record<string, unknown> = { ...row }
    delete fields.extensions
    const sourceHash = createHash('sha256')
      .update(JSON.stringify(fields, Object.keys(fields).sort()), 'utf-8')
      .digest('hex')
      .slice(0, 16)

    const createdAt = row.created_at ?? row.createdAt
    const updatedAt = row.updated_at ?? row.updatedAt
    const deletedAt = row.deleted_at ?? row.deletedAt

    return {
      sourceTable: table,
      sourceId: Number(row.id),
      sourceHash,
      organizationId: orgId,
      fields,
      extensions: {},
      deletedAt: deletedAt?.toISO?.() ?? deletedAt ?? null,
      createdAt: createdAt?.toISO?.() ?? DateTime.now().toISO(),
      updatedAt: updatedAt?.toISO?.() ?? updatedAt ?? null,
    }
  }
}
