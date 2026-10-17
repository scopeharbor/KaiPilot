import type { RiskLevel } from '@aiproj/types'

/**
 * 风险信号规则定义。
 * 每个规则有稳定的 ruleId、版本、启停状态、阈值和中文说明。
 */
export interface RiskRule {
  ruleId: string
  ruleVersion: string
  enabled: boolean
  threshold: Record<string, unknown>
  description: string
}

/**
 * 风险信号输入（项目事实快照）。
 */
export interface SignalInput {
  projectId: number
  organizationId: number
  overdueTasks: Array<{ id: number; title: string; daysOverdue: number; isCritical: boolean }>
  criticalPathTasks: Array<{ id: number; title: string; delayDays: number }>
  resourceOverloads: Array<{ role: string; overloadPercent: number; count: number }>
  overdueReviews: Array<{ riskId: number; title: string; daysOverdue: number }>
  incompleteResponsePlans: Array<{ riskId: number; planId: number; daysPastDue: number }>
  upcomingMilestones: Array<{ id: number; title: string; daysUntil: number }>
}

/**
 * 风险信号候选输出。
 * 注意：候选不写正式表，仅用于 preview。
 */
export interface SignalCandidate {
  ruleId: string
  ruleVersion: string
  severity: RiskLevel
  evidence: Array<{ type: string; id: number; title: string; detail: string }>
  recommendedAction: string
  confidence: number
  idempotencyKey: string
  templateId: number | null
}

const RULES: RiskRule[] = [
  {
    ruleId: 'overdue-task',
    ruleVersion: '1.0',
    enabled: true,
    threshold: { minDaysOverdue: 3, criticalMinDaysOverdue: 1 },
    description: '逾期任务：关键任务逾期 >= 1 天或一般任务逾期 >= 3 天',
  },
  {
    ruleId: 'critical-path-drift',
    ruleVersion: '1.0',
    enabled: true,
    threshold: { minDelayDays: 1 },
    description: '关键路径漂移：关键路径任务延期 >= 1 天',
  },
  {
    ruleId: 'resource-overload',
    ruleVersion: '1.0',
    enabled: true,
    threshold: { minOverloadPercent: 20 },
    description: '资源过载：资源负载超过容量 120%',
  },
  {
    ruleId: 'review-overdue',
    ruleVersion: '1.0',
    enabled: true,
    threshold: { minDaysOverdue: 7 },
    description: '复查逾期：风险复查逾期超过 7 天',
  },
  {
    ruleId: 'incomplete-response-plans',
    ruleVersion: '1.0',
    enabled: true,
    threshold: { minDaysPastDue: 3 },
    description: '未完成应对计划：目标日期已过且状态未完成',
  },
  {
    ruleId: 'upcoming-milestone',
    ruleVersion: '1.0',
    enabled: true,
    threshold: { maxDaysUntil: 14 },
    description: '临近里程碑：14 天内有里程碑到期',
  },
]

/**
 * RiskRuleRegistry — 提供稳定 ruleId、版本、启停状态、阈值和中文解释。
 */
export default class RiskRuleRegistry {
  getAll(): RiskRule[] {
    return RULES
  }

  getById(ruleId: string): RiskRule | undefined {
    return RULES.find((r) => r.ruleId === ruleId)
  }

  getEnabled(): RiskRule[] {
    return RULES.filter((r) => r.enabled)
  }
}

/**
 * RiskSignalEvaluator — 基于项目事实运行确定性规则，输出候选信号。
 * 评估过程禁止调用 LLM，禁止写入正式风险。
 */
export class RiskSignalEvaluator {
  constructor(private registry: RiskRuleRegistry) {}

  /**
   * 评估所有启用的规则，返回候选列表。
   */
  evaluate(input: SignalInput): SignalCandidate[] {
    const candidates: SignalCandidate[] = []
    const enabledRules = this.registry.getEnabled()

    for (const rule of enabledRules) {
      const ruleCandidates = this.evaluateRule(rule, input)
      candidates.push(...ruleCandidates)
    }

    return candidates
  }

  /**
   * 评估单条规则。
   */
  private evaluateRule(rule: RiskRule, input: SignalInput): SignalCandidate[] {
    switch (rule.ruleId) {
      case 'overdue-task':
        return this.evaluateOverdueTask(rule, input)
      case 'critical-path-drift':
        return this.evaluateCriticalPathDrift(rule, input)
      case 'resource-overload':
        return this.evaluateResourceOverload(rule, input)
      case 'review-overdue':
        return this.evaluateReviewOverdue(rule, input)
      case 'incomplete-response-plans':
        return this.evaluateIncompletePlans(rule, input)
      case 'upcoming-milestone':
        return this.evaluateUpcomingMilestone(rule, input)
      default:
        return []
    }
  }

  private evaluateOverdueTask(rule: RiskRule, input: SignalInput): SignalCandidate[] {
    const minOverdue = Number(rule.threshold.minDaysOverdue) || 3
    const criticalMinOverdue = Number(rule.threshold.criticalMinDaysOverdue) || 1

    const matching = input.overdueTasks.filter(
      (t) => (t.isCritical && t.daysOverdue >= criticalMinOverdue) || t.daysOverdue >= minOverdue,
    )

    if (matching.length === 0) return []

    const evidence = matching.slice(0, 5).map((t) => ({
      type: 'task' as const,
      id: t.id,
      title: t.title,
      detail: `${t.isCritical ? '关键' : ''}任务逾期 ${t.daysOverdue} 天`,
    }))

    return [
      {
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        severity: this.severityByCount(matching.length, 3, 8),
        evidence,
        recommendedAction: `存在 ${matching.length} 个逾期任务，建议审查任务状态并调整资源安排`,
        confidence: 0.95,
        idempotencyKey: `${rule.ruleId}-${input.projectId}-${matching.length}`,
        templateId: null,
      },
    ]
  }

  private evaluateCriticalPathDrift(rule: RiskRule, input: SignalInput): SignalCandidate[] {
    const minDelay = Number(rule.threshold.minDelayDays) || 1
    const matching = input.criticalPathTasks.filter((t) => t.delayDays >= minDelay)
    if (matching.length === 0) return []

    const evidence = matching.slice(0, 5).map((t) => ({
      type: 'task' as const,
      id: t.id,
      title: t.title,
      detail: `关键路径延期 ${t.delayDays} 天`,
    }))

    return [
      {
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        severity: this.severityByCount(matching.length, 1, 3),
        evidence,
        recommendedAction: `关键路径存在 ${matching.length} 个延期任务，建议评估对项目总工期的影响`,
        confidence: 0.9,
        idempotencyKey: `${rule.ruleId}-${input.projectId}-${matching.length}`,
        templateId: null,
      },
    ]
  }

  private evaluateResourceOverload(rule: RiskRule, input: SignalInput): SignalCandidate[] {
    const minOverload = Number(rule.threshold.minOverloadPercent) || 20
    const matching = input.resourceOverloads.filter((r) => r.overloadPercent >= minOverload)
    if (matching.length === 0) return []

    const evidence = matching.slice(0, 5).map((r) => ({
      type: 'resource' as const,
      id: 0,
      title: r.role,
      detail: `角色 "${r.role}" 过载 ${r.overloadPercent}%（${r.count} 个资源）`,
    }))

    return [
      {
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        severity: 'medium',
        evidence,
        recommendedAction: `存在 ${matching.length} 个角色资源过载，建议调整分配或增加资源`,
        confidence: 0.85,
        idempotencyKey: `${rule.ruleId}-${input.projectId}-${matching.length}`,
        templateId: null,
      },
    ]
  }

  private evaluateReviewOverdue(rule: RiskRule, input: SignalInput): SignalCandidate[] {
    const minDays = Number(rule.threshold.minDaysOverdue) || 7
    const matching = input.overdueReviews.filter((r) => r.daysOverdue >= minDays)
    if (matching.length === 0) return []

    const evidence = matching.slice(0, 5).map((r) => ({
      type: 'risk' as const,
      id: r.riskId,
      title: r.title,
      detail: `复查逾期 ${r.daysOverdue} 天`,
    }))

    return [
      {
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        severity: 'medium',
        evidence,
        recommendedAction: `存在 ${matching.length} 个风险复查逾期超过 ${minDays} 天，建议安排复查`,
        confidence: 0.9,
        idempotencyKey: `${rule.ruleId}-${input.projectId}-${matching.length}`,
        templateId: null,
      },
    ]
  }

  private evaluateIncompletePlans(rule: RiskRule, input: SignalInput): SignalCandidate[] {
    const minDays = Number(rule.threshold.minDaysPastDue) || 3
    const matching = input.incompleteResponsePlans.filter((p) => p.daysPastDue >= minDays)
    if (matching.length === 0) return []

    const evidence = matching.slice(0, 5).map((p) => ({
      type: 'response_plan' as const,
      id: p.planId,
      title: `风险 #${p.riskId} 应对计划`,
      detail: `目标日期已过 ${p.daysPastDue} 天`,
    }))

    return [
      {
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        severity: 'high',
        evidence,
        recommendedAction: `存在 ${matching.length} 个应对计划已过目标日期，建议跟进或调整计划`,
        confidence: 0.85,
        idempotencyKey: `${rule.ruleId}-${input.projectId}-${matching.length}`,
        templateId: null,
      },
    ]
  }

  private evaluateUpcomingMilestone(rule: RiskRule, input: SignalInput): SignalCandidate[] {
    const maxDays = Number(rule.threshold.maxDaysUntil) || 14
    const matching = input.upcomingMilestones.filter(
      (m) => m.daysUntil >= 0 && m.daysUntil <= maxDays,
    )
    if (matching.length === 0) return []

    const evidence = matching.slice(0, 5).map((m) => ({
      type: 'milestone' as const,
      id: m.id,
      title: m.title,
      detail: `距到期还有 ${m.daysUntil} 天`,
    }))

    return [
      {
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        severity: 'medium',
        evidence,
        recommendedAction: `未来 ${maxDays} 天内有 ${matching.length} 个里程碑到期，建议检查各里程碑任务进展`,
        confidence: 0.75,
        idempotencyKey: `${rule.ruleId}-${input.projectId}-${matching.length}`,
        templateId: null,
      },
    ]
  }

  private severityByCount(
    count: number,
    mediumThreshold: number,
    highThreshold: number,
  ): RiskLevel {
    if (count >= highThreshold) return 'high'
    if (count >= mediumThreshold) return 'medium'
    return 'low'
  }
}

/**
 * 构建幂等性键（项目 + 规则 + 输入摘要）。
 */
export function buildIdempotencyKey(ruleId: string, projectId: number, input: SignalInput): string {
  const inputs = [
    `ot:${input.overdueTasks.length}`,
    `cp:${input.criticalPathTasks.length}`,
    `ro:${input.resourceOverloads.length}`,
    `rv:${input.overdueReviews.length}`,
    `rp:${input.incompleteResponsePlans.length}`,
    `ms:${input.upcomingMilestones.length}`,
  ]
  return `${ruleId}-${projectId}-${inputs.join('|')}`
}
