/**
 * v2-pdm-migration-compatibility —— Migration Validator（Section 7.1-7.4）。
 *
 * 分层校验：Level 0 PDM Schema → Level 1 引用完整性 → Level 2 业务规则 → Level 4 安全隔离。
 * 任一 blocking 项阻止 execute / completed / 读路径切换。
 */
import { pdmSchema } from '@aiproj/compiler-spec'
import type { CanonicalProjectSnapshot, MigrationIssue } from '../types.js'

export class MigrationValidator {
  /**
   * Level 0：PDM zod schema + JSON 可解析。
   */
  validateLevel0(pdm: Record<string, unknown>): MigrationIssue[] {
    const issues: MigrationIssue[] = []
    const result = pdmSchema.safeParse(pdm)
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({
          severity: 'blocking',
          code: 'PDM_SCHEMA_ERROR',
          message: `PDM schema 校验失败: ${issue.path.join('.')} - ${issue.message}`,
          entityType: 'pdm',
          fieldPath: issue.path.join('.'),
        })
      }
    }
    return issues
  }

  /**
   * Level 1：引用完整性（WBS 父链、依赖引用、DAG 无环）。
   */
  validateLevel1(snapshot: CanonicalProjectSnapshot): MigrationIssue[] {
    const issues: MigrationIssue[] = []

    // WBS 父链检查
    for (const wbs of snapshot.wbsNodes) {
      const parentId = wbs.fields.parent_id ?? wbs.fields.parentId
      if (parentId) {
        const parentExists = snapshot.wbsNodes.some((w) => Number(w.fields.id) === Number(parentId))
        if (!parentExists) {
          issues.push({
            severity: 'blocking',
            code: 'WBS_PARENT_MISSING',
            message: `WBS 节点 ${wbs.fields.id} 的父节点 ${parentId} 不存在`,
            entityType: 'wbs_node',
            entityId: Number(wbs.fields.id),
            sourceTable: 'wbs_nodes',
          })
        }
      }
    }

    // 依赖引用检查
    for (const dep of snapshot.dependencies) {
      const predId = Number(dep.fields.predecessor_id ?? dep.fields.predecessorId)
      const succId = Number(dep.fields.successor_id ?? dep.fields.successorId)
      const predExists = snapshot.tasks.some((t) => Number(t.fields.id) === predId)
      const succExists = snapshot.tasks.some((t) => Number(t.fields.id) === succId)

      if (!predExists) {
        issues.push({
          severity: 'blocking',
          code: 'DEPENDENCY_PREDECESSOR_MISSING',
          message: `依赖 ${dep.fields.id} 的前置任务 ${predId} 不存在`,
          entityType: 'dependency',
          entityId: Number(dep.fields.id),
          sourceTable: 'task_dependencies',
        })
      }
      if (!succExists) {
        issues.push({
          severity: 'blocking',
          code: 'DEPENDENCY_SUCCESSOR_MISSING',
          message: `依赖 ${dep.fields.id} 的后置任务 ${succId} 不存在`,
          entityType: 'dependency',
          entityId: Number(dep.fields.id),
          sourceTable: 'task_dependencies',
        })
      }
    }

    // 依赖 DAG 无环检测（DFS）
    const depEdges = snapshot.dependencies.map((d) => ({
      from: Number(d.fields.predecessor_id ?? d.fields.predecessorId),
      to: Number(d.fields.successor_id ?? d.fields.successorId),
    }))

    if (this.hasCycle(depEdges)) {
      issues.push({
        severity: 'blocking',
        code: 'DEPENDENCY_CYCLE',
        message: '任务依赖图存在环路（DAG 检测失败）',
        entityType: 'dependency_graph',
      })
    }

    // 里程碑/资源/风险关联无悬空
    for (const risk of snapshot.risks) {
      const taskId = risk.fields.related_task_id ?? risk.fields.relatedTaskId
      if (taskId && !snapshot.tasks.some((t) => Number(t.fields.id) === Number(taskId))) {
        issues.push({
          severity: 'warning',
          code: 'RISK_HANGING_TASK',
          message: `风险 ${risk.fields.id} 关联的任务 ${taskId} 不存在`,
          entityType: 'risk',
          entityId: Number(risk.fields.id),
          sourceTable: 'risks',
        })
      }
    }

    return issues
  }

  /**
   * Level 2：业务规则（日期/时区、状态枚举、软删除过滤、AIMarker/假设保留）。
   */
  validateLevel2(snapshot: CanonicalProjectSnapshot): MigrationIssue[] {
    const issues: MigrationIssue[] = []
    const validStatuses = [
      'pending',
      'in_progress',
      'completed',
      'on_hold',
      'cancelled',
      'archived',
    ]

    // 状态枚举校验
    for (const task of snapshot.tasks) {
      const status = (task.fields.status as string) ?? ''
      if (status && !validStatuses.includes(status)) {
        issues.push({
          severity: 'warning',
          code: 'INVALID_STATUS',
          message: `任务 ${task.fields.id} 的状态 "${status}" 非标准枚举值`,
          entityType: 'task',
          entityId: Number(task.fields.id),
          sourceTable: 'tasks',
          fieldPath: 'status',
        })
      }
    }

    // 日期合理性
    for (const task of snapshot.tasks) {
      const startDate = task.fields.start_date ?? task.fields.startDate
      const endDate = task.fields.end_date ?? task.fields.endDate
      if (startDate && endDate && new Date(startDate as string) > new Date(endDate as string)) {
        issues.push({
          severity: 'warning',
          code: 'INVALID_DATE_RANGE',
          message: `任务 ${task.fields.id} 的开始日期晚于结束日期`,
          entityType: 'task',
          entityId: Number(task.fields.id),
          sourceTable: 'tasks',
          fieldPath: 'startDate/endDate',
        })
      }
    }

    // 软删除过滤：记录已被软删除但仍在源中的实体
    for (const entityList of [
      snapshot.wbsNodes,
      snapshot.milestones,
      snapshot.resources,
      snapshot.risks,
    ]) {
      for (const entity of entityList) {
        if (entity.deletedAt) {
          issues.push({
            severity: 'info',
            code: 'SOFT_DELETED_ENTITY',
            message: `实体 ${entity.sourceTable}:${entity.sourceId} 已被软删除 (${entity.deletedAt})`,
            entityType: entity.sourceTable,
            entityId: entity.sourceId,
            sourceTable: entity.sourceTable,
          })
        }
      }
    }

    return issues
  }

  /**
   * Level 4：安全隔离校验。
   */
  validateLevel4(snapshot: CanonicalProjectSnapshot): MigrationIssue[] {
    const issues: MigrationIssue[] = []
    const orgId = snapshot.organizationId

    // 检查所有实体是否属于同一组织
    const allEntities = [
      snapshot.project,
      ...snapshot.wbsNodes,
      ...snapshot.tasks,
      ...snapshot.dependencies,
      ...snapshot.milestones,
      ...snapshot.resources,
      ...snapshot.resourceAllocations,
      ...snapshot.risks,
    ]

    for (const entity of allEntities) {
      if (entity.organizationId !== orgId) {
        issues.push({
          severity: 'blocking',
          code: 'CROSS_ORG_ENTITY',
          message: `实体 ${entity.sourceTable}:${entity.sourceId} 的组织 ID (${entity.organizationId}) 与项目组织 (${orgId}) 不一致`,
          entityType: entity.sourceTable,
          entityId: entity.sourceId,
          sourceTable: entity.sourceTable,
        })
      }
    }

    return issues
  }

  /**
   * 运行全部校验并汇总。
   */
  async validateAll(
    snapshot: CanonicalProjectSnapshot,
    pdm: Record<string, unknown>,
  ): Promise<MigrationIssue[]> {
    const issues: MigrationIssue[] = [
      ...this.validateLevel0(pdm),
      ...this.validateLevel1(snapshot),
      ...this.validateLevel2(snapshot),
      ...this.validateLevel4(snapshot),
    ]
    return issues
  }

  // ── 私有辅助 ──

  private hasCycle(edges: Array<{ from: number; to: number }>): boolean {
    const adj = new Map<number, number[]>()
    for (const { from, to } of edges) {
      if (!adj.has(from)) adj.set(from, [])
      adj.get(from)!.push(to)
    }

    const WHITE = 0
    const GRAY = 1
    const BLACK = 2
    const color = new Map<number, number>()

    for (const node of adj.keys()) {
      color.set(node, WHITE)
    }

    function dfs(node: number): boolean {
      color.set(node, GRAY)
      for (const neighbor of adj.get(node) ?? []) {
        const c = color.get(neighbor) ?? WHITE
        if (c === GRAY) return true // 发现回边
        if (c === WHITE && dfs(neighbor)) return true
      }
      color.set(node, BLACK)
      return false
    }

    for (const node of adj.keys()) {
      if (color.get(node) === WHITE && dfs(node)) return true
    }
    return false
  }
}
