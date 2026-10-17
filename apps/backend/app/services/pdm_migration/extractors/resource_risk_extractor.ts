/**
 * v2-pdm-migration-compatibility —— Resource/Risk Extractor（Section 4.3）。
 *
 * 抽取资源池、资源分配、风险评分、关联任务与 AI 风险元数据。
 */
import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import type { CanonicalProjectEntity, CanonicalProjectSnapshot } from '../types.js'
import db from '@adonisjs/lucid/services/db'

export class ResourceRiskExtractor {
  async extractInto(snapshot: CanonicalProjectSnapshot): Promise<void> {
    const projectId = snapshot.projectId
    const orgId = snapshot.organizationId

    // 资源
    const resourceRows = await db
      .from('resources')
      .where('project_id', projectId)
      .whereNull('deleted_at')
    for (const row of resourceRows) {
      snapshot.resources.push(this.rowToEntity('resources', row, orgId))
    }

    // 资源分配
    const allocRows = await db
      .from('resource_allocations')
      .join('resources', 'resource_allocations.resource_id', 'resources.id')
      .where('resources.project_id', projectId)
      .select('resource_allocations.*')
    for (const row of allocRows) {
      snapshot.resourceAllocations.push(this.rowToEntity('resource_allocations', row, orgId))
    }

    // 风险
    const riskRows = await db.from('risks').where('project_id', projectId).whereNull('deleted_at')
    for (const row of riskRows) {
      snapshot.risks.push(this.rowToEntity('risks', row, orgId))
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
