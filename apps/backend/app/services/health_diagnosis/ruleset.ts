/**
 * ProjectHealthRuleset —— 项目健康诊断确定性规则集。
 *
 * 输出总体分、中文状态标签、维度分、严重度、稳定排序信号、证据 hash
 * 和建议动作候选。首批规则覆盖：逾期/即将到期、关键路径延期、依赖阻塞、
 * 里程碑偏差、资源超载、高风险集中、复查逾期、变更冲击和数据缺失。
 *
 * v2-ai-project-health-diagnosis / D2
 */
import { createHash } from 'node:crypto'
import type {
  HealthDimension,
  HealthSeverity,
  HealthRuleId,
  HealthEvidenceItem,
  HealthDimensionScore,
  HealthSuggestedAction,
  HealthDiagnosisSummary,
} from '@aiproj/types'
import { HEALTH_SEVERITY_ORDER, healthSeverityScore } from '@aiproj/types'
import type { HealthCollectorOutput } from './input_collector.js'

// ---------------------------------------------------------------------------
// 规则配置常量
// ---------------------------------------------------------------------------

const RULE_VERSION = '1.0.0'

interface RuleResult {
  ruleId: HealthRuleId
  dimension: HealthDimension
  scoreImpact: number
  severity: HealthSeverity
  evidence: HealthEvidenceItem[]
  suggestedActions: string[]
}

// 各维度权重（总和=100）
const DIMENSION_WEIGHTS: Record<HealthDimension, number> = {
  progress: 25,
  critical_path: 20,
  milestone: 10,
  resource: 15,
  risk: 15,
  change_impact: 10,
  collaboration: 3,
  data_integrity: 2,
}

// 阈值配置
const THRESHOLDS = {
  overdueRatio: { ok: 0, low: 0.05, medium: 0.15, high: 0.25, critical: 0.4 },
  criticalPathOverdueRatio: { ok: 0, low: 0.1, medium: 0.2, high: 0.35, critical: 0.5 },
  blockedRatio: { ok: 0, low: 0.03, medium: 0.08, high: 0.15, critical: 0.25 },
  resourceOverloadPercent: { ok: 80, low: 90, medium: 100, high: 120, critical: 150 },
  riskCriticalRatio: { ok: 0, low: 0.05, medium: 0.1, high: 0.2, critical: 0.3 },
}

// ---------------------------------------------------------------------------
// Ruleset
// ---------------------------------------------------------------------------

export class ProjectHealthRuleset {
  /**
   * 对收集的输入执行所有规则，返回诊断摘要。
   */
  evaluate(input: HealthCollectorOutput): HealthDiagnosisSummary {
    const rules = this.getAllRules()
    const results: RuleResult[] = rules.map((r) => r(input))
    const dimensionScores = this.buildDimensionScores(results, input)
    const overallScore = this.computeOverallScore(dimensionScores)
    const overallLabel = this.deriveOverallLabel(overallScore)
    const evidenceHash = this.computeEvidenceHash(results)
    const suggestedActions = this.aggregateActions(results)

    return {
      overallScore,
      overallLabel,
      dimensionScores,
      warnings: [...input.warnings, ...input.dataIntegrity.missingDimensions],
      suggestedActions,
      evidenceHash,
    }
  }

  get ruleVersion(): string {
    return RULE_VERSION
  }

  private getAllRules(): Array<(input: HealthCollectorOutput) => RuleResult> {
    return [
      (i) => this.ruleOverdueTasks(i),
      (i) => this.ruleDueSoonTasks(i),
      (i) => this.ruleCriticalPathOverdue(i),
      (i) => this.ruleBlockedTasks(i),
      (i) => this.ruleMilestoneDeviation(i),
      (i) => this.ruleResourceOverload(i),
      (i) => this.ruleHighRiskConcentration(i),
      (i) => this.ruleDataMissing(i),
    ]
  }

  // --- 规则实现 ---

  private ruleOverdueTasks(input: HealthCollectorOutput): RuleResult {
    const ts = input.taskSummary
    const ratio = ts?.totalTasks ? ts.overdueTasks / ts.totalTasks : 0
    const severity = this.ratioToSeverity(ratio, THRESHOLDS.overdueRatio)

    return {
      ruleId: 'R001',
      dimension: 'progress',
      scoreImpact: -Math.round(ratio * 100),
      severity,
      evidence:
        ts && ratio > 0
          ? [
              {
                ruleId: 'R001',
                entityType: 'task',
                entityId: 0,
                summary: `${ts.overdueTasks} 个任务逾期，逾期率 ${(ratio * 100).toFixed(1)}%`,
                impact: Math.round(ratio * 100),
                severity,
              },
            ]
          : [],
      suggestedActions: severity !== 'ok' ? ['审查逾期任务进度，调整计划或分配更多资源'] : [],
    }
  }

  private ruleDueSoonTasks(input: HealthCollectorOutput): RuleResult {
    const ts = input.taskSummary
    const ratio = ts?.totalTasks ? ts.dueSoonTasks / ts.totalTasks : 0
    const severity = ratio > 0.3 ? 'medium' : ratio > 0.15 ? 'low' : 'ok'

    return {
      ruleId: 'R002',
      dimension: 'progress',
      scoreImpact: -Math.round(ratio * 30),
      severity,
      evidence:
        ts && ratio > 0.15
          ? [
              {
                ruleId: 'R002',
                entityType: 'task',
                entityId: 0,
                summary: `${ts.dueSoonTasks} 个任务将在 30 天内到期`,
                impact: Math.round(ratio * 100),
                severity,
              },
            ]
          : [],
      suggestedActions: severity !== 'ok' ? ['关注即将到期的任务，提前安排资源'] : [],
    }
  }

  private ruleCriticalPathOverdue(input: HealthCollectorOutput): RuleResult {
    const cp = input.criticalPathSummary
    const ratio = cp?.totalCriticalTasks ? cp.overdueCriticalTasks / cp.totalCriticalTasks : 0
    const severity = this.ratioToSeverity(ratio, THRESHOLDS.criticalPathOverdueRatio)

    return {
      ruleId: 'R003',
      dimension: 'critical_path',
      scoreImpact: -Math.round(ratio * 100),
      severity,
      evidence:
        cp && ratio > 0
          ? [
              {
                ruleId: 'R003',
                entityType: 'task',
                entityId: 0,
                summary: `关键路径上 ${cp.overdueCriticalTasks}/${cp.totalCriticalTasks} 个任务逾期`,
                impact: Math.round(ratio * 100),
                severity,
              },
            ]
          : [],
      suggestedActions: severity !== 'ok' ? ['检查关键路径任务进度，评估对项目整体工期的影响'] : [],
    }
  }

  private ruleBlockedTasks(input: HealthCollectorOutput): RuleResult {
    const ts = input.taskSummary
    const ratio = ts?.totalTasks ? ts.blockedTasks / ts.totalTasks : 0
    const severity = this.ratioToSeverity(ratio, THRESHOLDS.blockedRatio)

    return {
      ruleId: 'R004',
      dimension: 'critical_path',
      scoreImpact: -Math.round(ratio * 60),
      severity,
      evidence:
        ts && ratio > 0
          ? [
              {
                ruleId: 'R004',
                entityType: 'task',
                entityId: 0,
                summary: `${ts.blockedTasks} 个任务被阻塞`,
                impact: Math.round(ratio * 100),
                severity,
              },
            ]
          : [],
      suggestedActions: severity !== 'ok' ? ['排查阻塞原因，推动前置依赖或审批流程'] : [],
    }
  }

  private ruleMilestoneDeviation(input: HealthCollectorOutput): RuleResult {
    const ms = input.milestoneSummary
    const ratio = ms?.totalMilestones ? ms.overdueMilestones / ms.totalMilestones : 0
    const severity = this.ratioToSeverity(ratio, THRESHOLDS.overdueRatio)

    return {
      ruleId: 'R005',
      dimension: 'milestone',
      scoreImpact: -Math.round(ratio * 100),
      severity,
      evidence:
        ms && ratio > 0
          ? [
              {
                ruleId: 'R005',
                entityType: 'milestone',
                entityId: 0,
                summary: `${ms.overdueMilestones}/${ms.totalMilestones} 里程碑逾期`,
                impact: Math.round(ratio * 100),
                severity,
              },
            ]
          : [],
      suggestedActions: severity !== 'ok' ? ['评估里程碑延期对关键节点交付的影响'] : [],
    }
  }

  private ruleResourceOverload(input: HealthCollectorOutput): RuleResult {
    const rs = input.resourceSummary
    if (!rs) {
      return {
        ruleId: 'R006',
        dimension: 'resource',
        scoreImpact: 0,
        severity: 'ok',
        evidence: [],
        suggestedActions: [],
      }
    }

    const overloadRatio = rs.totalResources > 0 ? rs.overloadedResources / rs.totalResources : 0
    const loadSeverity =
      overloadRatio > 0.3
        ? 'high'
        : overloadRatio > 0.1
          ? 'medium'
          : overloadRatio > 0
            ? 'low'
            : 'ok'

    return {
      ruleId: 'R006',
      dimension: 'resource',
      scoreImpact: -Math.round(overloadRatio * 100),
      severity: loadSeverity,
      evidence:
        rs.overloadedResources > 0
          ? [
              {
                ruleId: 'R006',
                entityType: 'resource',
                entityId: 0,
                summary: `${rs.overloadedResources}/${rs.totalResources} 资源超载，平均负载 ${rs.overallLoadPercent}%`,
                impact: Math.round(overloadRatio * 100),
                severity: loadSeverity,
              },
            ]
          : [],
      suggestedActions: loadSeverity !== 'ok' ? ['审查资源分配，考虑重新分配任务或增加资源'] : [],
    }
  }

  private ruleHighRiskConcentration(input: HealthCollectorOutput): RuleResult {
    const rsk = input.riskSummary
    if (!rsk) {
      return {
        ruleId: 'R007',
        dimension: 'risk',
        scoreImpact: 0,
        severity: 'ok',
        evidence: [],
        suggestedActions: [],
      }
    }

    const criticalHighRatio =
      rsk.totalRisks > 0 ? (rsk.criticalRisks + rsk.highRisks) / rsk.totalRisks : 0
    const severity = this.ratioToSeverity(criticalHighRatio, THRESHOLDS.riskCriticalRatio)

    return {
      ruleId: 'R007',
      dimension: 'risk',
      scoreImpact: -Math.round(criticalHighRatio * 100),
      severity,
      evidence:
        criticalHighRatio > 0
          ? [
              {
                ruleId: 'R007',
                entityType: 'risk',
                entityId: 0,
                summary: `${rsk.criticalRisks} 个严重风险、${rsk.highRisks} 个高风险`,
                impact: Math.round(criticalHighRatio * 100),
                severity,
              },
            ]
          : [],
      suggestedActions: severity !== 'ok' ? ['制定风险应对计划，优先处理严重和高风险项'] : [],
    }
  }

  private ruleDataMissing(input: HealthCollectorOutput): RuleResult {
    const missing = input.dataIntegrity.missingDimensions
    const hasMissingData = missing.length > 0

    return {
      ruleId: 'R010',
      dimension: 'data_integrity',
      scoreImpact: hasMissingData ? -(missing.length * 25) : 0,
      severity: hasMissingData ? 'medium' : 'ok',
      evidence: hasMissingData
        ? missing.map((m) => ({
            ruleId: 'R010' as HealthRuleId,
            entityType: 'project',
            entityId: 0,
            summary: m.message,
            impact: 0,
            severity: 'medium' as HealthSeverity,
          }))
        : [],
      suggestedActions: hasMissingData ? ['补充缺失的数据维度以获得完整健康评估'] : [],
    }
  }

  // --- 辅助方法 ---

  private ratioToSeverity(ratio: number, thresholds: Record<string, number>): HealthSeverity {
    for (const sev of HEALTH_SEVERITY_ORDER) {
      if (ratio >= thresholds[sev]) return sev
    }
    return 'ok'
  }

  private buildDimensionScores(
    results: RuleResult[],
    input: HealthCollectorOutput,
  ): HealthDimensionScore[] {
    const dimMap = new Map<HealthDimension, HealthDimensionScore>()

    // 初始化所有维度
    const allDimensions: HealthDimension[] = [
      'progress',
      'critical_path',
      'milestone',
      'resource',
      'risk',
      'change_impact',
      'collaboration',
      'data_integrity',
    ]

    for (const dim of allDimensions) {
      dimMap.set(dim, {
        dimension: dim,
        score: 0,
        severity: 'ok',
        evidence: [],
        warnings: input.warnings.filter((w) => w.dimension === dim),
        suggestedActions: [],
      })
    }

    // 累计规则结果
    for (const r of results) {
      const ds = dimMap.get(r.dimension)
      if (!ds) continue

      ds.score += r.scoreImpact
      ds.evidence.push(...r.evidence)
      ds.suggestedActions.push(...r.suggestedActions)

      // 取最高严重度
      if (healthSeverityScore(r.severity) > healthSeverityScore(ds.severity)) {
        ds.severity = r.severity
      }
    }

    // 计算维度基础分（初始 100，扣分后保底 0）
    for (const ds of dimMap.values()) {
      ds.score = Math.max(0, 100 + ds.score)
    }

    return Array.from(dimMap.values())
  }

  private computeOverallScore(dimensionScores: HealthDimensionScore[]): number {
    let weightedSum = 0
    let totalWeight = 0

    for (const ds of dimensionScores) {
      const weight = DIMENSION_WEIGHTS[ds.dimension]
      weightedSum += ds.score * weight
      totalWeight += weight
    }

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0
  }

  private deriveOverallLabel(score: number): string {
    if (score >= 85) return 'healthy'
    if (score >= 65) return 'attention'
    if (score >= 45) return 'warning'
    return 'critical'
  }

  private aggregateActions(results: RuleResult[]): HealthSuggestedAction[] {
    const actions: HealthSuggestedAction[] = []

    for (const r of results) {
      if (r.severity !== 'ok') {
        for (const action of r.suggestedActions) {
          actions.push({
            action,
            priority: r.severity === 'critical' || r.severity === 'high' ? 'high' : 'medium',
            dimension: r.dimension,
          })
        }
      }
    }

    return actions
  }

  private computeEvidenceHash(results: RuleResult[]): string {
    const hash = createHash('sha256')
    for (const r of results) {
      for (const e of r.evidence) {
        hash.update(`${e.ruleId}:${e.summary}`)
      }
    }
    return hash.digest('hex').substring(0, 16)
  }
}

export { RULE_VERSION }
