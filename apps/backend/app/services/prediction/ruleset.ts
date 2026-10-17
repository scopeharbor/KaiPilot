/**
 * ProjectPredictionRuleset —— 预测信号确定性规则集。
 *
 * 输出排期、关键路径、里程碑、依赖、资源、风险、变更影响、
 * 数据过期和数据质量信号。默认路径禁止调用 LLM。
 *
 * v2-ai-risk-progress-prediction / design D2
 */
import { createHash } from 'node:crypto'
import type {
  PredictionSignalType,
  PredictionSeverity,
  PredictionConfidenceBand,
  PredictionSignalInput,
  PredictionEvidenceRef,
  PredictionDataWarning,
} from '@aiproj/types'
import type { PredictionCollectorOutput } from './input_collector.js'

// ---------------------------------------------------------------------------
// 规则版本常量
// ---------------------------------------------------------------------------

const RULE_VERSION = '1.0.0'

interface RuleResult {
  signalType: PredictionSignalType
  severity: PredictionSeverity
  score: number
  confidenceBand: PredictionConfidenceBand
  confidenceLower?: number
  confidenceUpper?: number
  ruleId: string
  description: string
  evidenceRefs: PredictionEvidenceRef[]
  expiresAt: string | null
}

// 过期时间（7 天后）
function defaultExpiresAt(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  return d.toISOString()
}

// ---------------------------------------------------------------------------
// Ruleset
// ---------------------------------------------------------------------------

export class ProjectPredictionRuleset {
  evaluate(input: PredictionCollectorOutput): {
    signals: PredictionSignalInput[]
    warnings: PredictionDataWarning[]
  } {
    const allRules = this.getAllRules()
    const results: RuleResult[] = []
    const warnings: PredictionDataWarning[] = [...input.warnings]

    for (const rule of allRules) {
      const result = rule(input)
      if (result) {
        results.push(result)
      }
    }

    const signals: PredictionSignalInput[] = results.map((r) => ({
      signalType: r.signalType,
      severity: r.severity,
      score: r.score,
      confidenceBand: r.confidenceBand,
      confidenceLower: r.confidenceLower,
      confidenceUpper: r.confidenceUpper,
      ruleId: r.ruleId,
      ruleVersion: RULE_VERSION,
      description: r.description,
      evidenceRefs: r.evidenceRefs,
    }))

    // 如果存在 blocking warning 则添加 data_quality signal
    const blockingWarnings = warnings.filter((w) => w.blocking)
    if (blockingWarnings.length > 0) {
      signals.push({
        signalType: 'data_quality',
        severity: 'medium',
        score: Math.max(0, 100 - blockingWarnings.length * 15),
        confidenceBand: 'medium',
        confidenceLower: undefined,
        confidenceUpper: undefined,
        ruleId: 'data-quality',
        ruleVersion: RULE_VERSION,
        description: `存在 ${blockingWarnings.length} 个数据质量问题，可能影响预测准确性`,
        evidenceRefs: blockingWarnings.map((w) => ({
          entityType: 'warning',
          entityId: 0,
          summaryHash: this.hashString(w.code),
          displaySummary: w.message,
          visibility: 'summary_only' as const,
        })),
      })
    }

    return { signals, warnings }
  }

  get ruleVersion(): string {
    return RULE_VERSION
  }

  private getAllRules(): Array<(input: PredictionCollectorOutput) => RuleResult | null> {
    return [
      (i) => this.ruleScheduleRisk(i),
      (i) => this.ruleCriticalPathDrift(i),
      (i) => this.ruleMilestonePressure(i),
      (i) => this.ruleDependencyBlock(i),
      (i) => this.ruleResourceBottleneck(i),
      (i) => this.ruleRiskEscalation(i),
      (i) => this.ruleChangeImpact(i),
      (i) => this.ruleDataStaleness(i),
    ]
  }

  // --- 规则实现 ---

  private ruleScheduleRisk(input: PredictionCollectorOutput): RuleResult | null {
    const td = input.taskData
    if (!td || td.totalTasks === 0) return null

    const overdueRatio = td.totalTasks > 0 ? td.overdueTasks / td.totalTasks : 0
    const dueSoonRatio = td.totalTasks > 0 ? td.dueSoonTasks / td.totalTasks : 0

    // 综合评分
    const score = Math.max(
      0,
      Math.round(
        100 - overdueRatio * 50 - dueSoonRatio * 20 - Math.min(td.averageOverdueDays * 2, 20),
      ),
    )

    const severity = this.scoreToSeverity(score)
    const evidence: PredictionEvidenceRef[] = []

    if (td.overdueTasks > 0) {
      evidence.push({
        entityType: 'task',
        entityId: 0,
        summaryHash: this.hashString(`overdue:${td.overdueTasks}`),
        displaySummary: `${td.overdueTasks} 个任务逾期（平均 ${td.averageOverdueDays} 天）`,
        visibility: 'summary_only',
      })
    }
    if (td.dueSoonTasks > 0) {
      evidence.push({
        entityType: 'task',
        entityId: 0,
        summaryHash: this.hashString(`duesoon:${td.dueSoonTasks}`),
        displaySummary: `${td.dueSoonTasks} 个任务即将到期`,
        visibility: 'summary_only',
      })
    }

    return {
      signalType: 'schedule_risk',
      severity,
      score,
      confidenceBand: td.totalTasks > 0 ? 'high' : 'low',
      confidenceLower: Math.max(0, score - 10),
      confidenceUpper: Math.min(100, score + 10),
      ruleId: 'schedule-risk',
      description: `排期风险：${td.overdueTasks} 个任务逾期，${td.dueSoonTasks} 个即将到期，完成率 ${Math.round((td.completedTasks / td.totalTasks) * 100)}%`,
      evidenceRefs: evidence,
      expiresAt: defaultExpiresAt(),
    }
  }

  private ruleCriticalPathDrift(input: PredictionCollectorOutput): RuleResult | null {
    const cp = input.criticalPathData
    if (!cp || cp.totalCriticalTasks === 0) return null

    const driftRatio =
      cp.totalCriticalTasks > 0 ? cp.overdueCriticalTasks / cp.totalCriticalTasks : 0
    const score = Math.max(0, Math.round(100 - driftRatio * 60 - cp.averageDelayDays * 3))

    const severity =
      driftRatio > 0.5
        ? 'critical'
        : driftRatio > 0.3
          ? 'high'
          : driftRatio > 0.1
            ? 'medium'
            : driftRatio > 0
              ? 'low'
              : 'info'

    return {
      signalType: 'critical_path_drift',
      severity,
      score,
      confidenceBand: cp.overdueCriticalTasks > 0 ? 'high' : 'low',
      confidenceLower: Math.max(0, score - 15),
      confidenceUpper: Math.min(100, score + 5),
      ruleId: 'critical-path-drift',
      description: `关键路径：${cp.overdueCriticalTasks}/${cp.totalCriticalTasks} 个任务延期，平均延迟 ${cp.averageDelayDays} 天`,
      evidenceRefs: cp.delayedTasks.slice(0, 5).map((t) => ({
        entityType: 'task',
        entityId: t.id,
        summaryHash: this.hashString(`cp_delay:${t.id}`),
        displaySummary: `"${t.title}" 延迟 ${t.delayDays} 天`,
        visibility: 'summary_only',
      })),
      expiresAt: defaultExpiresAt(),
    }
  }

  private ruleMilestonePressure(input: PredictionCollectorOutput): RuleResult | null {
    const ms = input.milestoneData
    if (!ms || ms.totalMilestones === 0) return null

    const overdueRatio = ms.totalMilestones > 0 ? ms.overdueMilestones / ms.totalMilestones : 0
    const upcomingPressure = ms.upcomingMilestones > 0 ? Math.min(ms.upcomingMilestones * 5, 20) : 0
    const score = Math.max(0, Math.round(100 - overdueRatio * 40 - upcomingPressure))

    const severity =
      overdueRatio > 0.4
        ? 'high'
        : overdueRatio > 0.2
          ? 'medium'
          : ms.upcomingMilestones > 3
            ? 'low'
            : ms.overdueMilestones > 0
              ? 'low'
              : 'info'

    return {
      signalType: 'milestone_pressure',
      severity,
      score,
      confidenceBand: ms.totalMilestones > 0 ? 'high' : 'low',
      confidenceLower: Math.max(0, score - 10),
      confidenceUpper: Math.min(100, score + 10),
      ruleId: 'milestone-pressure',
      description: `里程碑压力：${ms.overdueMilestones} 个逾期，${ms.upcomingMilestones} 个即将到期`,
      evidenceRefs: [
        ...ms.overdueDetails.slice(0, 3).map((m) => ({
          entityType: 'milestone' as const,
          entityId: m.id,
          summaryHash: this.hashString(`ms_overdue:${m.id}`),
          displaySummary: `"${m.title}" 逾期 ${m.daysOverdue} 天`,
          visibility: 'summary_only' as const,
        })),
        ...ms.upcomingDetails.slice(0, 3).map((m) => ({
          entityType: 'milestone' as const,
          entityId: m.id,
          summaryHash: this.hashString(`ms_upcoming:${m.id}`),
          displaySummary: `"${m.title}" 将在 ${m.daysUntil} 天后到期`,
          visibility: 'summary_only' as const,
        })),
      ],
      expiresAt: defaultExpiresAt(),
    }
  }

  private ruleDependencyBlock(input: PredictionCollectorOutput): RuleResult | null {
    const td = input.taskData
    if (!td || td.totalTasks === 0) return null

    const blockedRatio = td.totalTasks > 0 ? td.blockedTasks / td.totalTasks : 0
    if (blockedRatio === 0) return null

    const score = Math.max(0, Math.round(100 - blockedRatio * 70))
    const severity = blockedRatio > 0.2 ? 'high' : blockedRatio > 0.1 ? 'medium' : 'low'

    return {
      signalType: 'dependency_block',
      severity,
      score,
      confidenceBand: 'high',
      confidenceLower: Math.max(0, score - 10),
      confidenceUpper: Math.min(100, score + 5),
      ruleId: 'dependency-block',
      description: `${td.blockedTasks} 个任务因依赖阻塞`,
      evidenceRefs: [
        {
          entityType: 'task',
          entityId: 0,
          summaryHash: this.hashString(`blocked:${td.blockedTasks}`),
          displaySummary: `${td.blockedTasks} 个任务被阻塞`,
          visibility: 'summary_only',
        },
      ],
      expiresAt: defaultExpiresAt(),
    }
  }

  private ruleResourceBottleneck(input: PredictionCollectorOutput): RuleResult | null {
    const rd = input.resourceData
    if (!rd || rd.totalResources === 0) return null

    const overloadRatio = rd.totalResources > 0 ? rd.overloadedResources / rd.totalResources : 0
    const score = Math.max(
      0,
      Math.round(100 - overloadRatio * 60 - Math.max(0, rd.overallLoadPercent - 80) / 2),
    )

    const severity =
      overloadRatio > 0.3
        ? 'high'
        : overloadRatio > 0.15
          ? 'medium'
          : overloadRatio > 0
            ? 'low'
            : 'info'

    return {
      signalType: 'resource_bottleneck',
      severity,
      score,
      confidenceBand: rd.totalResources > 3 ? 'high' : 'medium',
      confidenceLower: Math.max(0, score - 15),
      confidenceUpper: Math.min(100, score + 5),
      ruleId: 'resource-bottleneck',
      description: `资源瓶颈：${rd.overloadedResources}/${rd.totalResources} 资源超载，平均负载 ${rd.overallLoadPercent}%`,
      evidenceRefs: rd.overloadDetails.slice(0, 5).map((o) => ({
        entityType: 'resource',
        entityId: 0,
        summaryHash: this.hashString(`overload:${o.role}`),
        displaySummary: `"${o.role}" 过载 ${o.overloadPercent}%`,
        visibility: 'summary_only',
      })),
      expiresAt: defaultExpiresAt(),
    }
  }

  private ruleRiskEscalation(input: PredictionCollectorOutput): RuleResult | null {
    const rsk = input.riskData
    if (!rsk || rsk.totalRisks === 0) return null

    const criticalHighRatio =
      rsk.totalRisks > 0 ? (rsk.criticalRisks + rsk.highRisks) / rsk.totalRisks : 0
    const score = Math.max(
      0,
      Math.round(100 - criticalHighRatio * 50 - Math.min(rsk.overdueReviews.length * 5, 20)),
    )

    const severity =
      criticalHighRatio > 0.4
        ? 'critical'
        : criticalHighRatio > 0.25
          ? 'high'
          : criticalHighRatio > 0.1
            ? 'medium'
            : rsk.overdueReviews.length > 0
              ? 'low'
              : 'info'

    return {
      signalType: 'risk_escalation',
      severity,
      score,
      confidenceBand: rsk.totalRisks > 5 ? 'high' : 'medium',
      confidenceLower: Math.max(0, score - 10),
      confidenceUpper: Math.min(100, score + 10),
      ruleId: 'risk-escalation',
      description: `风险升级：${rsk.criticalRisks} 个严重、${rsk.highRisks} 个高风险，${rsk.overdueReviews.length} 个复查逾期`,
      evidenceRefs: [
        {
          entityType: 'risk',
          entityId: 0,
          summaryHash: this.hashString(`risk_conc:${rsk.criticalRisks}:${rsk.highRisks}`),
          displaySummary: `${rsk.criticalRisks} 严重 / ${rsk.highRisks} 高风险`,
          visibility: 'summary_only',
        },
        ...rsk.overdueReviews.slice(0, 3).map((r) => ({
          entityType: 'risk' as const,
          entityId: r.riskId,
          summaryHash: this.hashString(`review_overdue:${r.riskId}`),
          displaySummary: `"${r.title}" 复查逾期 ${r.daysOverdue} 天`,
          visibility: 'summary_only' as const,
        })),
      ],
      expiresAt: defaultExpiresAt(),
    }
  }

  private ruleChangeImpact(input: PredictionCollectorOutput): RuleResult | null {
    const ci = input.changeImpactData
    if (!ci || ci.totalAnalyses === 0) return null

    const score = Math.max(0, Math.round(100 - ci.openAnalyses * 10))
    const severity =
      ci.openAnalyses > 5
        ? 'high'
        : ci.openAnalyses > 3
          ? 'medium'
          : ci.openAnalyses > 0
            ? 'low'
            : 'info'

    return {
      signalType: 'change_impact',
      severity,
      score,
      confidenceBand: 'medium',
      confidenceLower: Math.max(0, score - 10),
      confidenceUpper: Math.min(100, score + 10),
      ruleId: 'change-impact',
      description: `变更影响：${ci.openAnalyses}/${ci.totalAnalyses} 个分析未关闭`,
      evidenceRefs: [
        {
          entityType: 'change_analysis',
          entityId: 0,
          summaryHash: this.hashString(`change_open:${ci.openAnalyses}`),
          displaySummary: `${ci.openAnalyses} 个未关闭的变更影响分析`,
          visibility: 'summary_only',
        },
      ],
      expiresAt: defaultExpiresAt(),
    }
  }

  private ruleDataStaleness(input: PredictionCollectorOutput): RuleResult | null {
    // 检查活动数据：如果 30 天内无活动则认为数据可能过时
    const ad = input.activityData
    if (!ad || ad.recentActivityCount > 0) return null

    return {
      signalType: 'data_staleness',
      severity: 'low',
      score: 50,
      confidenceBand: 'low',
      confidenceLower: undefined,
      confidenceUpper: undefined,
      ruleId: 'data-staleness',
      description: '项目近 30 天无活动记录，预测可能基于过时数据',
      evidenceRefs: [],
      expiresAt: defaultExpiresAt(),
    }
  }

  // --- 辅助方法 ---

  private scoreToSeverity(score: number): PredictionSeverity {
    if (score < 40) return 'critical'
    if (score < 60) return 'high'
    if (score < 75) return 'medium'
    if (score < 90) return 'low'
    return 'info'
  }

  private hashString(value: string): string {
    const hash = createHash('sha256')
    hash.update(value)
    return hash.digest('hex').substring(0, 8)
  }
}
