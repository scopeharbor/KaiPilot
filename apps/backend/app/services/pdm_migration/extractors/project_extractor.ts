/**
 * v2-pdm-migration-compatibility —— Project Extractor（Section 4.1）。
 *
 * 抽取 V1 projects 表数据生成 CanonicalProjectEntity。
 * 保留基础信息、状态、日期、AI metadata、软删除与组织上下文。
 */
import Project from '#models/project'
import { createHash } from 'node:crypto'
import type { CanonicalProjectEntity, CanonicalProjectSnapshot } from '../types.js'
import { DateTime } from 'luxon'

export class ProjectExtractor {
  /**
   * 抽取单个项目的 canonical 快照。
   */
  async extract(projectId: number, organizationId: number): Promise<CanonicalProjectSnapshot> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .firstOrFail()

    const fields: Record<string, unknown> = {
      id: project.id,
      organizationId: Number(project.organizationId),
      name: (project as any).name,
      description: (project as any).description ?? null,
      status: (project as any).status,
      startDate: (project as any).startDate ?? null,
      endDate: (project as any).endDate ?? null,
      projectType: (project as any).projectType ?? null,
      priority: (project as any).priority ?? null,
      createdBy: (project as any).createdBy ?? null,
      wbsRootId: (project as any).wbsRootId ?? null,
    }

    const extensions: Record<string, unknown> = {}
    if ((project as any).settings) {
      extensions.settings = (project as any).settings
    }
    if ((project as any).aiMetadata) {
      extensions.aiMetadata = (project as any).aiMetadata
    }

    const sourceHash = this.computeHash(fields)
    const now = DateTime.now().toISO()

    const entity: CanonicalProjectEntity = {
      sourceTable: 'projects',
      sourceId: Number(project.id),
      sourceHash,
      organizationId: Number(project.organizationId),
      fields,
      extensions,
      deletedAt: (project as any).deletedAt?.toISO?.() ?? null,
      createdAt: project.createdAt?.toISO?.() ?? now,
      updatedAt: project.updatedAt?.toISO?.() ?? null,
    }

    return {
      kind: 'project',
      organizationId: Number(project.organizationId),
      projectId: Number(project.id),
      project: entity,
      wbsNodes: [],
      tasks: [],
      dependencies: [],
      milestones: [],
      resources: [],
      resourceAllocations: [],
      risks: [],
      aiMetadata: (extensions.aiMetadata as Record<string, unknown>) ?? {},
      extractedAt: now,
    }
  }

  /**
   * 计算字段哈希。
   */
  private computeHash(fields: Record<string, unknown>): string {
    const json = JSON.stringify(fields, Object.keys(fields).sort())
    return createHash('sha256').update(json, 'utf-8').digest('hex').slice(0, 16)
  }
}
