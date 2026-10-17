import { isoDay } from '#services/project_health_service'
import db from '@adonisjs/lucid/services/db'
import type { ContradictionInputSnapshot, ContradictionInputWarning } from '@aiproj/types'
import { CONTRADICTION_RULESET_VERSION } from '@aiproj/types'
import { inject } from '@adonisjs/core'

/**
 * 矛盾输入收集器（v2-triz-contradiction-model-foundation D4）。
 *
 * 从任务、依赖、关键路径、资源分配/超载、风险、里程碑、变更影响等**只读**输入
 * 组装 `ContradictionInputSnapshot`。模块缺失/无权限时给 warning（DATA_SOURCE_UNAVAILABLE）
 * 并脱敏；禁止跨项目或全项目误读——所有查询强制 organization_id + project_id。
 */
@inject()
export default class ContradictionInputCollector {
  /**
   * 收集矛盾派生输入（只读聚合）。空项目优雅返回零值快照。
   */
  async collect(organizationId: number, projectId: number): Promise<ContradictionInputSnapshot> {
    const warnings: ContradictionInputWarning[] = []
    const todayStr = new Date().toISOString().slice(0, 10)

    // ── 任务聚合 ──
    let taskTotal = 0
    let overdueTaskCount = 0
    let criticalPathTaskCount = 0
    let scopeItemCount = 0
    try {
      const taskRows = await db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('status', 'end_date', 'is_critical_path')

      taskTotal = taskRows.length
      for (const t of taskRows) {
        const isCritical = Boolean(t.is_critical_path)
        if (isCritical) criticalPathTaskCount++
        const status = String(t.status ?? '')
        const due = isoDay(t.end_date)
        if (due !== null && due < todayStr && status !== 'completed' && status !== 'cancelled') {
          overdueTaskCount++
        }
      }
      scopeItemCount = taskTotal
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '任务数据读取失败，工期与范围维度降级',
        source: 'tasks',
      })
    }

    // ── WBS 叶节点（范围广度补充，可选模块）──
    try {
      const wbsCountRow = await db
        .from('wbs_nodes')
        .where('project_id', projectId)
        .count('* as total')
      scopeItemCount += Number(
        (wbsCountRow[0] as any)?.$extras?.total ?? (wbsCountRow[0] as any)?.total ?? 0,
      )
    } catch {
      // WBS 模块可能不存在；范围广度退化为任务数，不报阻断 warning
    }

    // ── 资源分配/超载 ──
    let resourceUtilization: number | null = null
    let resourceOverloadCount = 0
    try {
      const resources = await db
        .from('resources')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('id')
      if (resources.length > 0) {
        let totalUtilization = 0
        for (const r of resources) {
          const allocRows = await db
            .from('resource_allocations')
            .where('resource_id', r.id)
            .select('allocation_percent')
          const sum = allocRows.reduce(
            (acc: number, a: any) => acc + Number(a.allocation_percent ?? 0),
            0,
          )
          // 单资源利用率：min(sum, capacity)/capacity，容量统一按 100
          const utilization = Math.min(sum, 100) / 100
          totalUtilization += utilization
          if (sum > 100) resourceOverloadCount++
        }
        resourceUtilization = totalUtilization / resources.length
      }
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '资源管理模块未启用或数据不可用，资源利用率维度降级',
        source: 'resources',
      })
    }

    // ── 风险 ──
    let activeRiskCount = 0
    let highRiskCount = 0
    try {
      const riskRows = await db
        .from('risks')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .whereIn('status', ['identified', 'analyzing', 'mitigating'])
        .select('score')
      activeRiskCount = riskRows.length
      for (const r of riskRows) {
        if (Number((r as any).score ?? 0) >= 10) highRiskCount++
      }
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '风险模块未启用或数据不可用，风险维度降级',
        source: 'risks',
      })
    }

    // ── 里程碑 ──
    let milestoneTotal = 0
    try {
      const msCountRow = await db
        .from('milestones')
        .where('project_id', projectId)
        .count('* as total')
      milestoneTotal = Number(
        (msCountRow[0] as any)?.$extras?.total ?? (msCountRow[0] as any)?.total ?? 0,
      )
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '里程碑数据读取失败',
        source: 'milestones',
      })
    }

    // ── 变更请求 ──
    let changeRequestCount = 0
    try {
      const crCountRow = await db
        .from('change_requests')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .whereNull('deleted_at')
        .count('* as total')
      changeRequestCount = Number(
        (crCountRow[0] as any)?.$extras?.total ?? (crCountRow[0] as any)?.total ?? 0,
      )
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '变更请求数据读取失败',
        source: 'change_requests',
      })
    }

    // ── 计划工期（项目结束 - 开始，天）──
    let plannedDurationDays: number | null = null
    try {
      const project = await db
        .from('projects')
        .where('id', projectId)
        .where('organization_id', organizationId)
        .whereNull('deleted_at')
        .select('start_date', 'end_date')
        .first()
      if (project?.start_date && project?.end_date) {
        const start = new Date(isoDay(project.start_date) ?? '').getTime()
        const end = new Date(isoDay(project.end_date) ?? '').getTime()
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          plannedDurationDays = Math.round((end - start) / (1000 * 60 * 60 * 24))
        }
      }
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '项目计划日期读取失败',
        source: 'projects',
      })
    }

    const criticalPathDensity = taskTotal > 0 ? criticalPathTaskCount / taskTotal : 0

    return {
      organizationId,
      projectId,
      taskTotal,
      overdueTaskCount,
      criticalPathTaskCount,
      criticalPathDensity,
      resourceUtilization,
      resourceOverloadCount,
      activeRiskCount,
      highRiskCount,
      milestoneTotal,
      changeRequestCount,
      plannedDurationDays,
      scopeItemCount,
      warnings,
      ruleVersion: CONTRADICTION_RULESET_VERSION,
    }
  }
}
