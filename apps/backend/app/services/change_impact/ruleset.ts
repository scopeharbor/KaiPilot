import type {
  ChangeImpactInput,
  ChangeImpactItem,
  ChangeImpactSummary,
  ChangeImpactWarning,
  ChangeImpactDimension,
  ChangeImpactSeverity,
  PropagationPathEntry,
} from '@aiproj/types'
import { isBlockingSeverity, maxSeverity, severityScore, SEVERITY_ORDER } from '@aiproj/types'

/**
 * 规则版本：影响分析使用的确定性规则集版本号（D3）。
 */
export const RULESET_VERSION = '2.0.0'

/**
 * V2 首版最大传播深度。
 */
export const DEFAULT_MAX_DEPTH = 5

/**
 * V2 首版严重度阈值：分数 >= 此值视为 blocking。
 */
export const BLOCKING_SCORE_THRESHOLD = 4 // high

/**
 * 计算输入签名：对结构化输入做确定性排序 + JSON 序列化 + hash。
 */
export function computeInputSignature(input: ChangeImpactInput): string {
  const sorted = {
    cr: {
      title: input.changeRequest.title,
      description: input.changeRequest.description,
      type: input.changeRequest.changeType,
      priority: input.changeRequest.priority,
      impactSummary: input.changeRequest.impactSummary,
      relatedTaskIds: [...(input.changeRequest.relatedTaskIds ?? [])].sort((a, b) => a - b),
      relatedDocumentIds: [...(input.changeRequest.relatedDocumentIds ?? [])].sort((a, b) => a - b),
    },
    scope: {
      dimensions: [...input.scope.dimensions].sort(),
      maxPropagationDepth: input.scope.maxPropagationDepth,
      includeEvidenceDetails: input.scope.includeEvidenceDetails,
    },
    tasks: [...input.relatedTasks]
      .sort((a, b) => a.entityId - b.entityId)
      .map((t) => ({
        id: t.entityId,
        title: t.title,
        startDate: (t as any).startDate ?? null,
        endDate: (t as any).endDate ?? null,
        status: (t as any).status ?? null,
        priority: (t as any).priority ?? null,
        updatedAt: (t as any).updatedAt ?? null,
        isCriticalPath: (t as any).isCriticalPath ?? null,
        totalFloat: (t as any).totalFloat ?? null,
        milestoneId: (t as any).milestoneId ?? null,
        wbsNodeId: (t as any).wbsNodeId ?? null,
      })),
    deps: [...input.relatedDependencies]
      .sort((a, b) => a.id - b.id)
      .map((d) => `${d.id}:${d.predecessorId}>${d.successorId}:${d.type}:${d.lagDays}`),
    milestones: [...input.relatedMilestones]
      .sort((a, b) => a.entityId - b.entityId)
      .map((m) => `${m.entityId}:${m.title}:${m.isVisible}`),
    resources: [...input.relatedResources]
      .sort((a, b) => a.resourceId - b.resourceId)
      .map((r) => ({
        id: r.resourceId,
        name: r.resourceName,
        capacity: r.capacity,
        isVisible: r.isVisible,
        allocations: [...r.allocations]
          .sort((a, b) => a.taskId - b.taskId)
          .map((a) => `${a.taskId}:${a.loadPercent}`),
      })),
    risks: [...input.relatedRisks]
      .sort((a, b) => a.entityId - b.entityId)
      .map((r) => `${r.entityId}:${r.title}:${r.isVisible}`),
    missingInputs: [...input.missingInputs]
      .map((m) => `${m.dimension}:${m.reason}:${m.requiredData}`)
      .sort(),
    warnings: [...input.warnings].map((w) => `${w.dimension ?? ''}:${w.code}:${w.message}`).sort(),
    ruleVersion: input.ruleVersion,
  }
  // Simple deterministic hash (not crypto - just identity for stale detection)
  let hash = 0
  const str = JSON.stringify(sorted)
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `v2-${Math.abs(hash).toString(16).padStart(8, '0')}`
}

/**
 * 变更影响分析规则集引擎（v2-change-management-impact-analysis D3,D4）。
 *
 * 使用确定性规则计算变更影响传播，不调用 LLM。
 * 所有规则结果可复现、可审计。
 */
export default class ChangeImpactRuleset {
  /**
   * 执行影响传播分析。
   */
  propagate(input: ChangeImpactInput): {
    items: ChangeImpactItem[]
    summary: ChangeImpactSummary
    warnings: ChangeImpactWarning[]
  } {
    const items: ChangeImpactItem[] = []
    const warnings: ChangeImpactWarning[] = [...input.warnings]
    const maxDepth = input.scope.maxPropagationDepth ?? DEFAULT_MAX_DEPTH

    // 逐维度分析
    const dimensions = input.scope.dimensions

    if (dimensions.includes('schedule') || dimensions.includes('scope')) {
      this.propagateTaskDependencies(input, items, maxDepth) // R001
      this.propagateWbsInclusion(input, items, maxDepth) // R002
      this.propagateMilestoneAssociation(input, items) // R003
    }

    if (dimensions.includes('resource')) {
      this.propagateResourceAllocation(input, items) // R004
      this.detectResourceOverload(input, items, warnings) // R008
      this.detectResourceMissing(input, items, warnings) // R009
    }

    if (dimensions.includes('risk')) {
      this.propagateRiskAssociation(input, items) // R005
    }

    if (dimensions.includes('quality')) {
      this.propagateTraceabilityLinks(input, items) // R006
    }

    // 关键路径提升（R007）- 提升进度维度项中关键路径实体的严重度
    this.escalateCriticalPath(items)

    // 去重：同实体+同维度保留最高分
    const deduped = this.deduplicateItems(items)

    // 稳定排序：分数 desc → 实体类型 → 实体 ID
    deduped.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType)
      return a.entityId - b.entityId
    })

    // 构建摘要
    const summary = this.buildSummary(deduped)

    return { items: deduped, summary, warnings }
  }

  private propagateTaskDependencies(
    input: ChangeImpactInput,
    items: ChangeImpactItem[],
    maxDepth: number,
  ): void {
    const depMap = new Map<number, { predId: number; succId: number }[]>()
    for (const dep of input.relatedDependencies) {
      const pred = dep.predecessorId
      const succ = dep.successorId
      // pred -> succ 方向
      const entry1 = depMap.get(pred) ?? []
      entry1.push({ predId: pred, succId: succ })
      depMap.set(pred, entry1)
    }

    // 从关联任务出发 BFS
    for (const task of input.relatedTasks) {
      if (task.entityType !== 'task') continue
      this.bfsDep(depMap, task.entityId, 0, maxDepth, input, items, [])
    }
  }

  private bfsDep(
    depMap: Map<number, { predId: number; succId: number }[]>,
    currentTaskId: number,
    depth: number,
    maxDepth: number,
    input: ChangeImpactInput,
    items: ChangeImpactItem[],
    path: PropagationPathEntry[],
  ): void {
    if (depth >= maxDepth) return

    const successors = depMap.get(currentTaskId) ?? []
    for (const dep of successors) {
      const newPath: PropagationPathEntry[] = [
        ...path,
        {
          fromEntityType: 'task',
          fromEntityId: dep.predId,
          toEntityType: 'task',
          toEntityId: dep.succId,
          relationshipType: 'task_dependency',
          relationshipId: null,
        },
      ]

      // 检查是否已在 items 中（去重防止环）
      const exists = items.some(
        (i) => i.entityType === 'task' && i.entityId === dep.succId && i.dimension === 'schedule',
      )
      if (!exists) {
        items.push({
          id: null,
          analysisId: null,
          entityType: 'task',
          entityId: dep.succId,
          dimension: 'schedule',
          severity: this.calcDepSeverity(depth),
          score:
            ((SEVERITY_ORDER.length - SEVERITY_ORDER.indexOf(this.calcDepSeverity(depth))) *
              (maxDepth - depth)) /
            maxDepth,
          propagationPath: newPath,
          depth: depth + 1,
          ruleId: 'R001',
          evidence: `通过任务依赖传播（${dep.predId} → ${dep.succId}），传播深度 ${depth + 1}`,
          requiresReview: depth >= 3,
          isVisible: true,
        })
      }

      this.bfsDep(depMap, dep.succId, depth + 1, maxDepth, input, items, newPath)
    }
  }

  private calcDepSeverity(depth: number): ChangeImpactSeverity {
    if (depth === 0) return 'high'
    if (depth <= 2) return 'medium'
    if (depth <= 4) return 'low'
    return 'low'
  }

  private propagateWbsInclusion(
    input: ChangeImpactInput,
    items: ChangeImpactItem[],
    _maxDepth: number,
  ): void {
    // WBS 包含传播：如果父级受影响，子级也受影响
    // V2 首版简化：当变更请求关联任务时检查 WBS 节点
    for (const task of input.relatedTasks) {
      if (task.entityType !== 'task') continue
      items.push({
        id: null,
        analysisId: null,
        entityType: 'task',
        entityId: task.entityId,
        dimension: 'scope',
        severity: 'medium',
        score: 3,
        propagationPath: [],
        depth: 0,
        ruleId: 'R002',
        evidence: `变更请求直接关联任务（ID:${task.entityId}），属于 WBS 范围影响`,
        requiresReview: false,
        isVisible: true,
      })
    }
  }

  private propagateMilestoneAssociation(input: ChangeImpactInput, items: ChangeImpactItem[]): void {
    // 如果里程碑关联任务受影响，标记里程碑也在进度维度受影响
    for (const ms of input.relatedMilestones) {
      items.push({
        id: null,
        analysisId: null,
        entityType: 'milestone',
        entityId: ms.entityId,
        dimension: 'schedule',
        severity: 'high',
        score: 4,
        propagationPath: [],
        depth: 1,
        ruleId: 'R003',
        evidence: `里程碑与变更关联`,
        requiresReview: true,
        isVisible: ms.isVisible,
      })
    }
  }

  private propagateResourceAllocation(input: ChangeImpactInput, items: ChangeImpactItem[]): void {
    for (const res of input.relatedResources) {
      if (!res.isVisible) continue
      for (const alloc of res.allocations) {
        items.push({
          id: null,
          analysisId: null,
          entityType: 'resource',
          entityId: res.resourceId,
          dimension: 'resource',
          severity: 'medium',
          score: 3,
          propagationPath: [
            {
              fromEntityType: 'task',
              fromEntityId: alloc.taskId,
              toEntityType: 'resource',
              toEntityId: res.resourceId,
              relationshipType: 'resource_allocation',
              relationshipId: null,
            },
          ],
          depth: 1,
          ruleId: 'R004',
          evidence: `资源 ${res.resourceName} 已有分配到任务 ${alloc.taskId}，负载 ${alloc.loadPercent}%`,
          requiresReview: alloc.loadPercent > 80,
          isVisible: true,
        })
      }
    }
  }

  private detectResourceOverload(
    input: ChangeImpactInput,
    items: ChangeImpactItem[],
    _warnings: ChangeImpactWarning[],
  ): void {
    for (const res of input.relatedResources) {
      if (!res.isVisible) continue
      const totalLoad = res.allocations.reduce(
        (sum: number, a: { loadPercent: number }) => sum + a.loadPercent,
        0,
      )
      if (totalLoad > res.capacity) {
        items.push({
          id: null,
          analysisId: null,
          entityType: 'resource',
          entityId: res.resourceId,
          dimension: 'resource',
          severity: 'high',
          score: 4,
          propagationPath: [],
          depth: 0,
          ruleId: 'R008',
          evidence: `资源 ${res.resourceName} 总负载 ${totalLoad}% 超过容量 ${res.capacity}%`,
          requiresReview: true,
          isVisible: true,
        })
      }
    }
  }

  private detectResourceMissing(
    _input: ChangeImpactInput,
    items: ChangeImpactItem[],
    warnings: ChangeImpactWarning[],
  ): void {
    // R009：资源缺失 — 当资源维度被选中但无资源数据时输出 warning
    // 实际由 input_collector 的 warning 处理
    if (items.filter((i) => i.dimension === 'resource').length === 0) {
      warnings.push({
        code: 'RESOURCE_DATA_MISSING',
        message: '缺少资源分配数据，资源影响分析不完全',
        dimension: 'resource',
      })
    }
  }

  private propagateRiskAssociation(input: ChangeImpactInput, items: ChangeImpactItem[]): void {
    for (const risk of input.relatedRisks) {
      items.push({
        id: null,
        analysisId: null,
        entityType: 'risk',
        entityId: risk.entityId,
        dimension: 'risk',
        severity: 'medium',
        score: 3,
        propagationPath: [],
        depth: 1,
        ruleId: 'R005',
        evidence: `变更可能影响已登记风险「${risk.title}」`,
        requiresReview: true,
        isVisible: risk.isVisible,
      })
    }
  }

  private propagateTraceabilityLinks(input: ChangeImpactInput, items: ChangeImpactItem[]): void {
    // Traceability 影响传播：仅使用已存在的追溯链接
    // V2 首版简化：当有风险关联时同步输出质量维度
    if (input.relatedRisks.length > 0) {
      for (const risk of input.relatedRisks) {
        items.push({
          id: null,
          analysisId: null,
          entityType: 'risk',
          entityId: risk.entityId,
          dimension: 'quality',
          severity: 'low',
          score: 2,
          propagationPath: [],
          depth: 1,
          ruleId: 'R006',
          evidence: '风险关联可能影响质量验收标准',
          requiresReview: false,
          isVisible: risk.isVisible,
        })
      }
    }
  }

  private escalateCriticalPath(items: ChangeImpactItem[]): void {
    // R007：对 schedule 维度且传播深度 0-1（接近源变更）的项标记关键路径影响。
    for (const item of items) {
      if (item.dimension !== 'schedule' || item.depth > 1) continue

      if (isBlockingSeverity(item.severity)) {
        // 已是高/关键严重度：不再上调（避免越级放大），但标记为关键路径影响，
        // 以驱动 summary.criticalPathAffected，保留原严重度与分数。
        item.evidence += '；位于关键路径附近'
        item.ruleId = 'R007'
      } else {
        // 非阻断项：提升一级严重度并标记关键路径。
        const idx = SEVERITY_ORDER.indexOf(item.severity)
        if (idx > 0) {
          const elevated = SEVERITY_ORDER[idx - 1] as ChangeImpactSeverity
          item.severity = elevated
          item.score = severityScore(elevated) * 2
          item.evidence += '；位于关键路径附近，严重度已提升'
          item.ruleId = 'R007'
        }
      }
    }
  }

  private deduplicateItems(items: ChangeImpactItem[]): ChangeImpactItem[] {
    const seen = new Map<string, ChangeImpactItem>()
    for (const item of items) {
      const key = `${item.entityType}:${item.entityId}:${item.dimension}`
      const existing = seen.get(key)
      if (!existing || item.score > existing.score) {
        seen.set(key, item)
      }
    }
    return Array.from(seen.values())
  }

  private buildSummary(items: ChangeImpactItem[]): ChangeImpactSummary {
    const severityDistribution: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      none: 0,
    }

    const dimensionMap = new Map<
      ChangeImpactDimension,
      { count: number; highest: ChangeImpactSeverity; evidence: string[] }
    >()

    for (const item of items) {
      severityDistribution[item.severity] = (severityDistribution[item.severity] ?? 0) + 1

      let dimEntry = dimensionMap.get(item.dimension)
      if (!dimEntry) {
        dimEntry = { count: 0, highest: 'none' as ChangeImpactSeverity, evidence: [] }
        dimensionMap.set(item.dimension, dimEntry)
      }
      dimEntry.count++
      dimEntry.highest = maxSeverity(dimEntry.highest, item.severity)
      if (item.evidence && dimEntry.evidence.length < 3) {
        dimEntry.evidence.push(item.evidence.substring(0, 100))
      }
    }

    const dimensionSummaries = Array.from(dimensionMap.entries()).map(([dim, entry]) => ({
      dimension: dim,
      affectedCount: entry.count,
      highestSeverity: entry.highest,
      topEvidence: entry.evidence,
    }))

    const hasCriticalPath = items.some((i) => i.ruleId === 'R007')
    const hasBlocking = items.some((i) => isBlockingSeverity(i.severity))

    return {
      totalAffected: items.length,
      severityDistribution: severityDistribution as Record<ChangeImpactSeverity, number>,
      dimensionSummaries,
      criticalPathAffected: hasCriticalPath,
      hasBlockingWarnings: hasBlocking,
    }
  }
}
