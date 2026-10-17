/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerPreviewService（task 4.1-4.5）。
 *
 * 将 PDM 投影为正式业务实体 Preview（只读）。
 * 生成 preview snapshot，计算 previewHash。
 * 禁止调用正式创建/更新服务。
 */
import { inject } from '@adonisjs/core'
import DraftLayerSession from '#models/draft_layer_session'
import DraftLayerPreview from '#models/draft_layer_preview'
import DraftLayerChange from '#models/draft_layer_change'
import { ArtifactStore } from '#services/compiler/artifact_store'
import type { DraftLayerPreviewEntity } from '@aiproj/types'
import { computePreviewHash } from '@aiproj/types'
import { computeContentHash } from '#services/compiler/artifact_store'

export class PreviewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreviewError'
  }
}

@inject()
export class DraftLayerPreviewService {
  constructor(readonly artifactStore: ArtifactStore) {}

  /**
   * 从 Compiler PDM artifact 生成 Preview。
   * 1. 读取 PDM artifact
   * 2. 读取当前正式数据（baseline）
   * 3. 投影 PDM 为 preview 实体
   * 4. 保存 preview snapshot
   * 5. 创建 change 记录
   */
  async generatePreview(sessionId: number, organizationId: number): Promise<DraftLayerPreview> {
    const session = await DraftLayerSession.forOrganization(organizationId)
      .where('id', sessionId)
      .first()

    if (!session) throw new PreviewError('Draft session 不存在')
    if (session.status !== 'active' && session.status !== 'previewing') {
      throw new PreviewError(`Session 状态 ${session.status} 不允许生成 Preview`)
    }

    // 读取 PDM
    if (!session.compilerRunId) throw new PreviewError('Session 没有关联的 Compiler Run')
    const pdmArtifact = await this.artifactStore.latest(session.compilerRunId, 'pdm')
    if (!pdmArtifact) throw new PreviewError('PDM artifact 不存在')

    // v3-copilot-action-and-preview-boundary —— Copilot 动作会话兼容分支：
    // sourceType='v3_copilot_action' 且无 Compiler Run 的会话由 CopilotActionBuilder
    // 直接写入 change set，Preview 从既有 change 行投影（不重放 PDM、不覆盖 change）。
    // 对既有 PDM 流程零行为变化（additive 分支）。
    if (session.sourceType === 'v3_copilot_action') {
      return this.generatePreviewFromChangeSet(sessionId, session)
    }

    // 投影 PDM 为 preview entities
    const entities = this.projectPdmToEntities(pdmArtifact.payload)

    // 计算 entity hashes
    const entityHashes = entities.map((e) => computeContentHash(e))

    // 计算 preview hash
    const baselineSummary: Record<string, unknown> = {}
    const currentSummary: Record<string, unknown> = {
      entityCount: entities.length,
      entityTypes: this.countEntityTypes(entities),
    }
    const previewHash = computePreviewHash(baselineSummary, currentSummary, entityHashes)

    // 创建 change 记录
    const changes: DraftLayerChange[] = []
    for (const [i, entity] of entities.entries()) {
      const change = await DraftLayerChange.create({
        sessionId,
        targetEntityType: entity.entityType,
        targetEntityId: entity.tempId,
        targetFieldPath: null,
        operation: 'create',
        value: entity.fields,
        oldValue: null,
        reviewStatus: 'pending',
        userModifiedValue: null,
        userNote: null,
        sequence: i + 1,
        dependsOn: [],
        confidence: entity.aiMarker?.confidence ?? 0.5,
        validationSummary: null,
      })
      changes.push(change)
    }

    // 更新 session 状态
    session.status = 'previewing'
    session.summary = {
      ...((session.summary as any) ?? {}),
      totalChanges: changes.length,
      pendingChanges: changes.length,
    }
    await session.save()

    // 保存 preview snapshot
    const preview = await DraftLayerPreview.create({
      sessionId,
      version: session.version,
      baselineSummary,
      currentSummary,
      previewHash,
      computedFromChangeIds: changes.map((c) => c.id),
      validationSummary: null,
    })

    return preview
  }

  /**
   * Copilot 动作会话的 Preview：从会话既有 change set 投影（v3-copilot-action-and-preview-boundary）。
   * 不重放 PDM、不新建/覆盖 change 行；只计算 previewHash 并保存 preview snapshot。
   * 只读当前 change 行与 session，禁止写正式业务表。
   */
  private async generatePreviewFromChangeSet(
    sessionId: number,
    session: DraftLayerSession,
  ): Promise<DraftLayerPreview> {
    const changes = await DraftLayerChange.query()
      .where('session_id', sessionId)
      .orderBy('sequence', 'asc')

    const entityHashes = changes.map((c) => computeContentHash(c.value))
    const baselineSummary: Record<string, unknown> = {}
    const currentSummary: Record<string, unknown> = {
      entityCount: changes.length,
      entityTypes: this.countEntityTypes(
        changes.map(
          (c) =>
            ({
              entityType: c.targetEntityType as DraftLayerPreviewEntity['entityType'],
              tempId: c.targetEntityId,
              fields: (c.value as Record<string, unknown>) ?? {},
              references: [],
              lineage: [],
              aiMarker: null,
              needsConfirmation: true,
            }) satisfies DraftLayerPreviewEntity,
        ),
      ),
    }
    const previewHash = computePreviewHash(baselineSummary, currentSummary, entityHashes)

    // 更新 session 状态与摘要
    session.status = 'previewing'
    session.summary = {
      ...((session.summary as any) ?? {}),
      totalChanges: changes.length,
      pendingChanges: changes.length,
    }
    await session.save()

    const preview = await DraftLayerPreview.create({
      sessionId,
      version: session.version,
      baselineSummary,
      currentSummary,
      previewHash,
      computedFromChangeIds: changes.map((c) => c.id),
      validationSummary: null,
    })

    return preview
  }

  /**
   * 投影 PDM 为 preview entities。
   * 只读投影，不写正式表。
   */
  private projectPdmToEntities(pdmPayload: unknown): DraftLayerPreviewEntity[] {
    const entities: DraftLayerPreviewEntity[] = []
    const pdm = (pdmPayload as Record<string, unknown>) ?? {}

    // Project
    if (pdm.metadata) {
      entities.push({
        tempId: 'project_1',
        entityType: 'project',
        fields: pdm.metadata as Record<string, unknown>,
        references: [],
        lineage: ['pdm:metadata'],
        aiMarker: null,
        needsConfirmation: true,
      })
    }

    // Workstreams → WBS nodes
    const workstreams = Array.isArray(pdm.workstreams) ? pdm.workstreams : []
    for (const [i, workstream] of workstreams.entries()) {
      const ws = workstream as Record<string, unknown>
      const tempId = `wbs_${i + 1}`
      entities.push({
        tempId,
        entityType: 'wbs_node',
        fields: ws,
        references: [
          { field: 'projectId', targetTempId: 'project_1', targetEntityType: 'project' },
        ],
        lineage: [`pdm:workstreams[${i}]`],
        aiMarker: null,
        needsConfirmation: true,
      })
    }

    // Tasks
    const tasks = Array.isArray(pdm.tasks) ? pdm.tasks : []
    for (const [i, taskInput] of tasks.entries()) {
      const task = taskInput as Record<string, unknown>
      const tempId = `task_${i + 1}`
      entities.push({
        tempId,
        entityType: 'task',
        fields: task,
        references: [
          {
            field: 'wbsNodeId',
            targetTempId: `wbs_${((task.wbsIndex as number) ?? 0) + 1}`,
            targetEntityType: 'wbs_node',
          },
        ],
        lineage: [`pdm:tasks[${i}]`],
        aiMarker: null,
        needsConfirmation: true,
      })
    }

    // Milestones
    const milestones = Array.isArray(pdm.milestones) ? pdm.milestones : []
    for (const [i, milestone] of milestones.entries()) {
      const ms = milestone as Record<string, unknown>
      entities.push({
        tempId: `milestone_${i + 1}`,
        entityType: 'milestone',
        fields: ms,
        references: [],
        lineage: [`pdm:milestones[${i}]`],
        aiMarker: null,
        needsConfirmation: true,
      })
    }

    // Risks
    const risks = Array.isArray(pdm.risks) ? pdm.risks : []
    for (const [i, risk] of risks.entries()) {
      entities.push({
        tempId: `risk_${i + 1}`,
        entityType: 'risk',
        fields: risk as Record<string, unknown>,
        references: [
          { field: 'projectId', targetTempId: 'project_1', targetEntityType: 'project' },
        ],
        lineage: [`pdm:risks[${i}]`],
        aiMarker: null,
        needsConfirmation: true,
      })
    }

    // Resources
    const resources = Array.isArray(pdm.resources) ? pdm.resources : []
    for (const [i, resource] of resources.entries()) {
      entities.push({
        tempId: `resource_${i + 1}`,
        entityType: 'resource',
        fields: resource as Record<string, unknown>,
        references: [
          { field: 'projectId', targetTempId: 'project_1', targetEntityType: 'project' },
        ],
        lineage: [`pdm:resources[${i}]`],
        aiMarker: null,
        needsConfirmation: true,
      })
    }

    return entities
  }

  private countEntityTypes(entities: DraftLayerPreviewEntity[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const e of entities) {
      counts[e.entityType] = (counts[e.entityType] ?? 0) + 1
    }
    return counts
  }
}
