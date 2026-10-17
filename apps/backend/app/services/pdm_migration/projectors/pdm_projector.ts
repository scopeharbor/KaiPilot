/**
 * v2-pdm-migration-compatibility —— PDM Projector（Section 5）。
 *
 * 将 CanonicalSnapshot 投影为 Foundation PDM schema 兼容结构。
 * 使用 Foundation Entity ID 工具生成稳定 PDM ID。
 * 检测 ID 冲突：同一 PDM ID 不同来源 hash → blocking issue。
 */
import { generateEntityId } from '@aiproj/compiler-spec'
import type { CanonicalProjectSnapshot, CanonicalDraftSnapshot, MigrationIssue } from '../types.js'

export interface ProjectionResult {
  pdm: Record<string, unknown>
  mappings: Array<{
    sourceKind: string
    sourceTable: string
    sourceId: number
    sourceHash: string
    pdmEntityType: string
    pdmEntityId: string
  }>
  issues: MigrationIssue[]
}

export class PdmProjector {
  /**
   * 将项目 snapshot 投影为 PDM。
   */
  async project(snapshot: CanonicalProjectSnapshot, runId: number): Promise<ProjectionResult> {
    const issues: MigrationIssue[] = []
    const mappings: ProjectionResult['mappings'] = []
    const projectId = String(snapshot.projectId)

    // 投影为 PDM
    const pdm: Record<string, unknown> = {
      metadata: {
        schemaVersion: '1.0',
        compilerVersion: '0.1.0',
        generatedAt: snapshot.extractedAt,
        projectId,
        runId,
      },
      intent: {
        text: '',
        detectedLanguage: 'zh-CN',
        receivedAt: snapshot.extractedAt,
      },
      parsedIntent: {
        projectName: (snapshot.project.fields.name as string) ?? '',
        projectType: (snapshot.project.fields.projectType as string) ?? '',
        summary: (snapshot.project.fields.description as string) ?? '',
        objectives: [],
        scope: '',
        constraints: [],
        stakeholders: [],
        priority: (snapshot.project.fields.priority as string) ?? 'medium',
      },
      blueprint: {
        workstreams: [],
        milestones: [],
        risks: [],
        resources: [],
        stakeholders: [],
      },
      computed: {
        status: (snapshot.project.fields.status as string) ?? 'pending',
        totalEstimatedHours: 0,
      },
    }

    // 投影 WBS → workstreams / work_packages
    for (const wbs of snapshot.wbsNodes) {
      const name = String(wbs.fields.name ?? '')
      const parentId = wbs.fields.parent_id ?? wbs.fields.parentId
      const wbsId = Number(wbs.fields.id)

      // 顶层 WBS → workstream
      if (!parentId) {
        const pdmId = generateEntityId('workstream', name, projectId)
        mappings.push({
          sourceKind: 'wbs_node',
          sourceTable: 'wbs_nodes',
          sourceId: wbsId,
          sourceHash: wbs.sourceHash,
          pdmEntityType: 'workstream',
          pdmEntityId: pdmId,
        })
        ;(pdm.blueprint as any).workstreams.push({
          id: pdmId,
          name,
          description: String(wbs.fields.description ?? ''),
          workPackages: [],
        })
      } else {
        // 子 WBS → work_package（查找父 workstream）
        const parentName =
          (snapshot.wbsNodes.find((w) => Number(w.fields.id) === Number(parentId))?.fields
            .name as string) ?? ''
        const pdmId = generateEntityId('work_package', name, projectId)
        mappings.push({
          sourceKind: 'wbs_node',
          sourceTable: 'wbs_nodes',
          sourceId: wbsId,
          sourceHash: wbs.sourceHash,
          pdmEntityType: 'work_package',
          pdmEntityId: pdmId,
        })

        // 找到父 workstream 并追加 work_package
        const ws = (pdm.blueprint as any).workstreams.find(
          (w: any) =>
            w.name === parentName || w.id === generateEntityId('workstream', parentName, projectId),
        )
        if (ws) {
          ws.workPackages.push({
            id: pdmId,
            name,
            description: String(wbs.fields.description ?? ''),
            estimatedHours: 0,
            dependsOn: [],
            tasks: [],
          })
        }
      }
    }

    // 投影任务 → task_l1 / task_l2
    for (const task of snapshot.tasks) {
      const name = String(task.fields.name ?? '')
      const taskId = Number(task.fields.id)
      const parentTaskId = task.fields.parent_task_id ?? task.fields.parentTaskId
      const estimatedHours = Number(task.fields.estimated_hours ?? task.fields.estimatedHours ?? 0)
      const assigneeId = task.fields.assignee_id ?? task.fields.assigneeId

      // 简单按有无子任务分配 L1/L2
      const hasChildren = snapshot.tasks.some(
        (t) => Number(t.fields.parent_task_id ?? t.fields.parentTaskId) === taskId,
      )

      if (!parentTaskId || hasChildren) {
        // L1 任务
        const pdmId = generateEntityId('task_l1', name, projectId)
        mappings.push({
          sourceKind: 'task',
          sourceTable: 'tasks',
          sourceId: taskId,
          sourceHash: task.sourceHash,
          pdmEntityType: 'task_l1',
          pdmEntityId: pdmId,
        })

        // 找到所属 work_package 并追加
        const wbsId = task.fields.wbs_node_id ?? task.fields.wbsNodeId
        if (wbsId) {
          // 找到对应 work_package
          for (const ws of (pdm.blueprint as any).workstreams) {
            for (const wp of ws.workPackages) {
              const wpMapping = mappings.find(
                (m) => m.pdmEntityType === 'work_package' && Number(m.sourceId) === Number(wbsId),
              )
              if (wpMapping && wp.id === wpMapping.pdmEntityId) {
                wp.tasks.push({
                  id: pdmId,
                  name,
                  description: String(task.fields.description ?? ''),
                  estimatedHours,
                  deliverables: [],
                  dependsOn: [],
                  children: [],
                })
              }
            }
          }
        }
      } else {
        // L2 子任务
        const pdmId = generateEntityId('task_l2', name, projectId)
        mappings.push({
          sourceKind: 'task',
          sourceTable: 'tasks',
          sourceId: taskId,
          sourceHash: task.sourceHash,
          pdmEntityType: 'task_l2',
          pdmEntityId: pdmId,
        })
        // 找到父 L1
        for (const ws of (pdm.blueprint as any).workstreams) {
          for (const wp of ws.workPackages) {
            for (const t of wp.tasks) {
              const parentMapping = mappings.find(
                (m) => m.pdmEntityType === 'task_l1' && Number(m.sourceId) === Number(parentTaskId),
              )
              if (parentMapping && t.id === parentMapping.pdmEntityId) {
                t.children.push({
                  id: pdmId,
                  name,
                  description: String(task.fields.description ?? ''),
                  estimatedHours,
                  assignee: assigneeId ? String(assigneeId) : undefined,
                  dependsOn: [],
                })
              }
            }
          }
        }
      }
    }

    // 投影依赖 → dependsOn 填充
    for (const dep of snapshot.dependencies) {
      const predId = Number(dep.fields.predecessor_id ?? dep.fields.predecessorId)
      const succId = Number(dep.fields.successor_id ?? dep.fields.successorId)
      const predMapping = mappings.find(
        (m) => m.sourceKind === 'task' && Number(m.sourceId) === predId,
      )
      const succMapping = mappings.find(
        (m) => m.sourceKind === 'task' && Number(m.sourceId) === succId,
      )
      if (predMapping && succMapping) {
        // 在 PDM 中标记依赖（通过查找对应的 task）
        for (const ws of (pdm.blueprint as any).workstreams) {
          for (const wp of ws.workPackages) {
            for (const t of wp.tasks) {
              this.addDependencyToTask(t, succMapping.pdmEntityId, predMapping.pdmEntityId, issues)
              for (const child of t.children) {
                if (child.id === succMapping.pdmEntityId) {
                  child.dependsOn.push(predMapping.pdmEntityId)
                }
              }
            }
          }
        }
      } else {
        issues.push({
          severity: 'warning',
          code: 'DEPENDENCY_HANGING',
          message: `依赖引用不存在任务: predecessor=${predId} successor=${succId}`,
          entityType: 'dependency',
          entityId: Number(dep.fields.id),
          sourceTable: 'task_dependencies',
        })
      }
    }

    // 投影里程碑
    for (const ms of snapshot.milestones) {
      const name = String(ms.fields.name ?? '')
      const pdmId = generateEntityId('milestone', name, projectId)
      mappings.push({
        sourceKind: 'milestone',
        sourceTable: 'milestones',
        sourceId: Number(ms.fields.id),
        sourceHash: ms.sourceHash,
        pdmEntityType: 'milestone',
        pdmEntityId: pdmId,
      })
      ;(pdm.blueprint as any).milestones.push({
        id: pdmId,
        name,
        description: String(ms.fields.description ?? ''),
        dueDate: ms.fields.planned_date ?? ms.fields.plannedDate ?? undefined,
        criteria: [],
      })
    }

    // 投影风险
    for (const r of snapshot.risks) {
      const name = String(r.fields.title ?? '')
      const pdmId = generateEntityId('risk', name, projectId)
      mappings.push({
        sourceKind: 'risk',
        sourceTable: 'risks',
        sourceId: Number(r.fields.id),
        sourceHash: r.sourceHash,
        pdmEntityType: 'risk',
        pdmEntityId: pdmId,
      })
      ;(pdm.blueprint as any).risks.push({
        id: pdmId,
        name,
        description: String(r.fields.description ?? ''),
        probability: this.mapRiskLevel(Number(r.fields.probability ?? 0)),
        impact: this.mapRiskLevel(Number(r.fields.impact ?? 0)),
        mitigation: String(r.fields.mitigation_strategy ?? r.fields.mitigationStrategy ?? ''),
      })
    }

    // 投影资源
    for (const r of snapshot.resources) {
      const name = String(r.fields.name ?? '')
      const pdmId = generateEntityId('resource', name, projectId)
      mappings.push({
        sourceKind: 'resource',
        sourceTable: 'resources',
        sourceId: Number(r.fields.id),
        sourceHash: r.sourceHash,
        pdmEntityType: 'resource',
        pdmEntityId: pdmId,
      })
      ;(pdm.blueprint as any).resources.push({
        id: pdmId,
        name,
        role: String(r.fields.role ?? ''),
        count: Number(r.fields.daily_capacity_hours ?? r.fields.dailyCapacityHours ?? 1),
      })
    }

    // ID 冲突检测
    this.detectIdConflicts(mappings, issues)

    return { pdm, mappings, issues }
  }

  /**
   * 将草案 snapshot 投影为 PDM/Draft 兼容结构（Section 6）。
   */
  async projectDraft(snapshot: CanonicalDraftSnapshot, runId: number): Promise<ProjectionResult> {
    const issues: MigrationIssue[] = []
    const mappings: ProjectionResult['mappings'] = []

    const pdm: Record<string, unknown> = {
      metadata: {
        schemaVersion: '1.0',
        compilerVersion: '0.1.0',
        generatedAt: snapshot.extractedAt,
        projectId: `draft_${snapshot.draftId}`,
        runId,
      },
      draftInfo: {
        draftId: snapshot.draftId,
        draftUid: snapshot.draft.fields.draftUid,
        status: snapshot.draft.fields.status,
        schemaVersion: snapshot.draft.fields.schemaVersion,
        currentVersion: snapshot.draft.fields.currentVersion,
        projectType: snapshot.draft.fields.projectType,
        projectId: snapshot.draft.fields.projectId ?? null,
        structuredStrategy: snapshot.draft.fields.structuredStrategy,
        consistency: snapshot.draft.fields.consistency,
        fallbackUsed: snapshot.draft.extensions.fallbackUsed,
        provider: snapshot.draft.extensions.provider,
        model: snapshot.draft.extensions.model,
      },
      versions: snapshot.versions.map((v) => ({
        version: v.fields.version,
        origin: v.fields.origin,
        status: v.fields.status,
        draft: v.extensions.draft,
        meta: v.extensions.meta,
        validation: v.extensions.validation,
        createdAt: v.createdAt,
      })),
      events: snapshot.events.map((e) => ({
        type: e.fields.eventType,
        level: e.fields.level,
        createdAt: e.createdAt,
      })),
      confirmations: snapshot.confirmations.map((c) => ({
        confirmed: c.fields.confirmed,
        version: c.fields.version,
        createdAt: c.createdAt,
      })),
      blueprint: {
        workstreams: [],
        milestones: [],
        risks: [],
        resources: [],
        stakeholders: [],
      },
    }

    return { pdm, mappings, issues }
  }

  private addDependencyToTask(
    task: any,
    taskId: string,
    depId: string,
    _issues: MigrationIssue[],
  ): void {
    if (task.id === taskId) {
      if (!task.dependsOn.includes(depId)) {
        task.dependsOn.push(depId)
      }
    }
    for (const child of task.children ?? []) {
      if (child.id === taskId && !child.dependsOn.includes(depId)) {
        child.dependsOn.push(depId)
      }
    }
  }

  private mapRiskLevel(value: number): string {
    if (value >= 4) return 'high'
    if (value >= 2) return 'medium'
    return 'low'
  }

  private detectIdConflicts(
    mappings: ProjectionResult['mappings'],
    issues: MigrationIssue[],
  ): void {
    const idMap = new Map<string, string[]>()
    for (const m of mappings) {
      const key = `${m.pdmEntityType}:${m.pdmEntityId}`
      if (!idMap.has(key)) {
        idMap.set(key, [])
      }
      idMap.get(key)!.push(m.sourceHash)
    }

    for (const [key, hashes] of idMap) {
      const uniqueHashes = new Set(hashes)
      if (uniqueHashes.size > 1) {
        const [type, id] = key.split(':')
        issues.push({
          severity: 'blocking',
          code: 'ID_CONFLICT',
          message: `PDM ID "${id}" (${type}) 来源 hash 不一致，冲突被阻断`,
          entityType: type,
          entityId: id,
        })
      }
    }
  }
}
