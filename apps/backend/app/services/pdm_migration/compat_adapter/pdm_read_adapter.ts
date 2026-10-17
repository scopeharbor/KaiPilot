/**
 * v2-pdm-migration-compatibility —— PDM Read Adapter（Section 10.1）。
 *
 * PDM Adapter 摘要接口：为双读验证提供 PDM 侧的摘要数据。
 * project/wbs/task/dependency/milestone/resource/risk/ai_draft 全覆盖。
 */
import type { CanonicalProjectSnapshot } from '../types.js'
import { PdmProjector } from '../projectors/pdm_projector.js'
import { ProjectExtractor } from '../extractors/project_extractor.js'
import { WbsTaskExtractor } from '../extractors/wbs_task_extractor.js'
import { ResourceRiskExtractor } from '../extractors/resource_risk_extractor.js'
import { AiDraftExtractor } from '../extractors/ai_draft_extractor.js'
import { createHash } from 'node:crypto'

export interface EntityDigest {
  entityType: string
  count: number
  fieldHash: string
  statusSummary: Record<string, number>
}

export class PdmReadAdapter {
  /**
   * 读取 PDM 摘要（通过抽取+投影获得）。
   */
  async getProjectDigest(projectId: number, organizationId: number): Promise<EntityDigest[]> {
    const extractor = new ProjectExtractor()
    const snapshot = await extractor.extract(projectId, organizationId)

    const wbsTaskExtractor = new WbsTaskExtractor()
    await wbsTaskExtractor.extractInto(snapshot)

    const resourceRiskExtractor = new ResourceRiskExtractor()
    await resourceRiskExtractor.extractInto(snapshot)

    const projector = new PdmProjector()
    await projector.project(snapshot, 0)

    return this.digestFromSnapshot(snapshot)
  }

  /**
   * 读取 AI 草案 PDM 摘要。
   */
  async getDraftDigest(draftId: number, organizationId: number): Promise<EntityDigest[]> {
    const extractor = new AiDraftExtractor()
    const snapshot = await extractor.extract(draftId, organizationId)
    if (!snapshot) return []

    return [
      {
        entityType: 'draft',
        count: 1,
        fieldHash: this.hashFields(snapshot.draft.fields),
        statusSummary: {},
      },
      {
        entityType: 'draft_version',
        count: snapshot.versions.length,
        fieldHash: this.combinedHash(snapshot.versions.map((v) => v.sourceHash)),
        statusSummary: {},
      },
    ]
  }

  private digestFromSnapshot(snapshot: CanonicalProjectSnapshot): EntityDigest[] {
    const taskStatuses: Record<string, number> = {}
    for (const t of snapshot.tasks) {
      const s = String(t.fields.status ?? 'unknown')
      taskStatuses[s] = (taskStatuses[s] ?? 0) + 1
    }

    return [
      {
        entityType: 'project',
        count: 1,
        fieldHash: snapshot.project.sourceHash,
        statusSummary: {},
      },
      {
        entityType: 'wbs_node',
        count: snapshot.wbsNodes.length,
        fieldHash: this.combinedHash(snapshot.wbsNodes.map((w) => w.sourceHash)),
        statusSummary: {},
      },
      {
        entityType: 'task',
        count: snapshot.tasks.length,
        fieldHash: this.combinedHash(snapshot.tasks.map((t) => t.sourceHash)),
        statusSummary: taskStatuses,
      },
      {
        entityType: 'dependency',
        count: snapshot.dependencies.length,
        fieldHash: this.combinedHash(snapshot.dependencies.map((d) => d.sourceHash)),
        statusSummary: {},
      },
      {
        entityType: 'milestone',
        count: snapshot.milestones.length,
        fieldHash: this.combinedHash(snapshot.milestones.map((m) => m.sourceHash)),
        statusSummary: {},
      },
      {
        entityType: 'resource',
        count: snapshot.resources.length,
        fieldHash: this.combinedHash(snapshot.resources.map((r) => r.sourceHash)),
        statusSummary: {},
      },
      {
        entityType: 'risk',
        count: snapshot.risks.length,
        fieldHash: this.combinedHash(snapshot.risks.map((r) => r.sourceHash)),
        statusSummary: {},
      },
    ]
  }

  private combinedHash(hashes: string[]): string {
    return createHash('sha256').update(hashes.sort().join(''), 'utf-8').digest('hex').slice(0, 16)
  }

  private hashFields(fields: Record<string, unknown>): string {
    return createHash('sha256')
      .update(JSON.stringify(fields, Object.keys(fields).sort()), 'utf-8')
      .digest('hex')
      .slice(0, 16)
  }
}
