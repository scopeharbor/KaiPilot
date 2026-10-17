import type {
  EvolutionTrendCollectorOutput,
  EvolutionTrendScore,
  EvolutionTrendRiskCandidate,
  EvolutionTrendWarningCode,
  TrendSeverity,
  TrendRiskType,
} from '@aiproj/types'
import {
  EVOLUTION_TREND_IDS,
  computeTrendKey,
  computeTrendRiskKey,
  computeTrendStage,
  trendScoreToSeverity,
  classifyTrendDirection,
  computeTrendRiskImpactScore,
  computeSourceCoverage,
  adjustConfidenceForCoverage,
  TREND_RISK_TYPE_TREND_MAP,
} from '@aiproj/types'

/**
 * TRIZ 进化趋势规则引擎（v3-triz-evolution-trend-analysis §4.4–§4.5）。
 *
 * 对 8 大趋势分别计算评分、阶段、置信度、风险严重度，并产出 8 类风险预警候选。
 * 全部确定性规则，零模型调用；缺失证据时降级置信度 + warning，不编造。
 * 不修改正式项目/任务/资源/风险/排期事实。
 */
export default class TrizEvolutionTrendRuleEngine {
  evaluate(collected: EvolutionTrendCollectorOutput): {
    trends: EvolutionTrendScore[]
    risks: EvolutionTrendRiskCandidate[]
  } {
    const trends = EVOLUTION_TREND_IDS.map((trendId) => this.evaluateTrend(trendId, collected))
    const risks = this.generateRisks(trends, collected)
    return { trends, risks }
  }

  // ── 8 大趋势评分 ──
  private evaluateTrend(
    trendId: (typeof EVOLUTION_TREND_IDS)[number],
    c: EvolutionTrendCollectorOutput,
  ): EvolutionTrendScore {
    const trendKey = computeTrendKey(c.projectId, trendId, c.scopeType)
    const { score, metrics, sourceRefs, sourceHashes, warningCodes, confidence } = this.scoreTrend(
      trendId,
      c,
    )

    const direction = classifyTrendDirection(null)
    const stage = computeTrendStage(score)
    const severity = trendScoreToSeverity(score)

    return {
      trendKey,
      trendId,
      stage,
      score,
      confidence,
      severity,
      direction,
      sourceRefs,
      sourceHashes,
      metrics,
      warningCodes,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    }
  }

  private scoreTrend(
    trendId: string,
    c: EvolutionTrendCollectorOutput,
  ): {
    score: number
    confidence: number
    metrics: Record<string, number | null>
    sourceRefs: EvolutionTrendScore['sourceRefs']
    sourceHashes: Record<string, string>
    warningCodes: EvolutionTrendWarningCode[]
  } {
    const warnings: EvolutionTrendWarningCode[] = []
    const sourceRefs: EvolutionTrendScore['sourceRefs'] = []
    const sourceHashes: Record<string, string> = {}
    const metrics: Record<string, number | null> = {}

    let factors: number[] = []
    let weights: number[] = []
    let totalWeight = 0

    const addFactor = (value: number | null, weight: number, metricName: string) => {
      const v = value ?? 0
      factors.push(v)
      weights.push(weight)
      totalWeight += weight
      metrics[metricName] = value
    }

    switch (trendId) {
      case 'completeness': {
        // 完备性：角色覆盖度、角色多样性、单点风险
        const roleCoverage = c.distinctRoleCount > 0 ? Math.min(1, c.distinctRoleCount / 6) : 0.3
        addFactor(roleCoverage, 0.4, 'roleCoverage')
        const singlePersonRisk =
          c.memberCount > 0 ? 1 - c.singlePersonRoleCount / Math.max(1, c.distinctRoleCount) : 0
        addFactor(singlePersonRisk, 0.3, 'singlePersonRisk')
        const memberAdequacy = Math.min(1, c.memberCount / 5)
        addFactor(memberAdequacy, 0.3, 'memberAdequacy')
        if (c.distinctRoleCount === 0) warnings.push('INSUFFICIENT_TREND_SOURCE')
        break
      }
      case 'energy_information_transmission': {
        // 能量/信息传递：阻塞项比例、平均等待天数
        const blockRatio =
          c.taskTotal > 0 ? Math.max(0, 1 - (c.blockedTaskCount / c.taskTotal) * 2) : 0.5
        addFactor(blockRatio, 0.5, 'blockRatio')
        const waitScore =
          c.averageBlockedWaitDays !== null ? Math.max(0, 1 - c.averageBlockedWaitDays / 14) : 0.5
        addFactor(waitScore, 0.5, 'waitScore')
        if (c.taskTotal === 0) warnings.push('INSUFFICIENT_TREND_SOURCE')
        break
      }
      case 'dynamization': {
        // 动态化：变更响应、返工比
        const changeResponsiveness =
          c.averageChangeResponseDays !== null
            ? Math.max(0, 1 - c.averageChangeResponseDays / 14)
            : 0.5
        addFactor(changeResponsiveness, 0.4, 'changeResponsiveness')
        const reworkScore = c.reworkRatio !== null ? Math.max(0, 1 - c.reworkRatio * 2) : 0.5
        addFactor(reworkScore, 0.3, 'reworkScore')
        const flexibility = c.changeRequestCount > 0 ? Math.min(1, c.changeRequestCount / 10) : 0.3
        addFactor(flexibility, 0.3, 'flexibility')
        break
      }
      case 'uneven_subsystem_evolution': {
        // 子系统不均衡进化：进度差、资源负载差
        const balanceScore =
          c.subsystemProgressSpread !== null
            ? Math.max(0, 1 - c.subsystemProgressSpread * 1.5)
            : 0.5
        addFactor(balanceScore, 0.5, 'balanceScore')
        const loadBalance =
          c.resourceLoadSyncSpread !== null ? Math.max(0, 1 - c.resourceLoadSyncSpread * 1.5) : 0.5
        addFactor(loadBalance, 0.5, 'loadBalance')
        break
      }
      case 'transition_to_supersystem': {
        // 向超系统进化：外部依赖健康度
        const extHealth =
          c.externalDependencyCount > 0
            ? 1 - c.unhealthyExternalDependencyCount / c.externalDependencyCount
            : 1
        addFactor(extHealth, 0.6, 'extHealth')
        const totalDepScore = c.dependencyCount > 0 ? Math.min(1, c.dependencyCount / 30) : 0
        addFactor(totalDepScore, 0.4, 'totalDepScore')
        break
      }
      case 'micro_level_transition': {
        // 微观化：任务粒度、WBS深度
        const granularityScore =
          c.averageTaskGranularityDays !== null
            ? Math.max(0, 1 - c.averageTaskGranularityDays / 21)
            : 0.5
        addFactor(granularityScore, 0.5, 'granularityScore')
        const depthScore = Math.min(1, c.deepWbsLevelCount / 3)
        addFactor(depthScore, 0.5, 'depthScore')
        break
      }
      case 'ideality_increase': {
        // 理想度增长：价值产出 vs 成本/危害增长
        const valueScore = Math.min(1, c.deliveredValueItemCount / Math.max(1, c.taskTotal))
        addFactor(valueScore, 0.4, 'valueScore')
        const costPenalty = Math.max(0, 1 - c.costGrowthSignals / 5)
        addFactor(costPenalty, 0.3, 'costPenalty')
        const harmPenalty = Math.max(0, 1 - c.harmOrRiskGrowthSignals / 5)
        addFactor(harmPenalty, 0.3, 'harmPenalty')
        break
      }
      case 'coordination': {
        // 协调性：依赖节奏失配、资源同步度
        const rhythmScore = Math.max(
          0,
          1 - c.dependencyRhythmMismatchCount / Math.max(1, c.dependencyCount),
        )
        addFactor(rhythmScore, 0.5, 'rhythmScore')
        const syncScore =
          c.resourceLoadSyncSpread !== null ? Math.max(0, 1 - c.resourceLoadSyncSpread * 1.5) : 0.5
        addFactor(syncScore, 0.5, 'syncScore')
        break
      }
      default:
        addFactor(0.5, 1, 'defaultScore')
    }

    const weightedSum =
      factors.reduce((s, f, i) => s + f * weights[i], 0) / Math.max(1, totalWeight)
    const score = Number(weightedSum.toFixed(2))
    const coverage = computeSourceCoverage(factors.length, 3)
    const confidence = adjustConfidenceForCoverage(0.8, coverage)

    return { score, confidence, metrics, sourceRefs, sourceHashes, warningCodes: warnings }
  }

  // ── 8 类风险候选 ──
  private generateRisks(
    trends: EvolutionTrendScore[],
    c: EvolutionTrendCollectorOutput,
  ): EvolutionTrendRiskCandidate[] {
    const trendsByKey = new Map(trends.map((t) => [t.trendId, t]))
    const risks: EvolutionTrendRiskCandidate[] = []

    for (const riskType of Object.keys(TREND_RISK_TYPE_TREND_MAP) as TrendRiskType[]) {
      const trendId = TREND_RISK_TYPE_TREND_MAP[riskType]
      const trend = trendsByKey.get(trendId)
      if (!trend) continue

      const { shouldCreate, severity, confidence, rationaleSummary, targetRefs, suggestedActions } =
        this.evaluateRisk(riskType, trend, c)

      if (!shouldCreate) continue

      const trendRefs = [trend.trendKey]
      const riskKey = computeTrendRiskKey(
        riskType,
        `ET-${String(risks.length + 1).padStart(3, '0')}`,
        trendRefs,
        [''],
      )
      const impactScore = computeTrendRiskImpactScore(
        severity,
        confidence,
        trend.score,
        targetRefs.length,
      )

      risks.push({
        riskKey,
        riskType,
        trendId,
        ruleId: `ET-${String(risks.length + 1).padStart(3, '0')}`,
        status: 'unreviewed',
        severity,
        confidence,
        impactScore,
        title: this.riskTitle(riskType),
        rationaleSummary,
        trendRefs,
        targetRefs,
        suggestedActions,
        sourceHashes: c.sourceHashes,
        warningCodes: trend.warningCodes,
        aiExplanationRef: null,
        reviewedBy: null,
        reviewedAt: null,
        outputHash: `tet-ro-${riskKey}`,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      })
    }

    return risks
  }

  private evaluateRisk(
    riskType: TrendRiskType,
    trend: EvolutionTrendScore,
    c: EvolutionTrendCollectorOutput,
  ): {
    shouldCreate: boolean
    severity: TrendSeverity
    confidence: number
    rationaleSummary: string
    targetRefs: EvolutionTrendRiskCandidate['targetRefs']
    suggestedActions: string[]
  } {
    switch (riskType) {
      case 'role_gap':
        return {
          shouldCreate: c.distinctRoleCount <= 2 || c.singlePersonRoleCount > 0,
          severity:
            c.singlePersonRoleCount > 1 ? 'critical' : c.distinctRoleCount <= 1 ? 'high' : 'medium',
          confidence: trend.confidence,
          rationaleSummary: `项目当前角色种类 ${c.distinctRoleCount}，单点角色数 ${c.singlePersonRoleCount}，存在能力覆盖或关键职责单点风险。`,
          targetRefs: [],
          suggestedActions: ['查看依据', '加入方案篮子', '记录审查'],
        }
      case 'information_flow_delay':
        return {
          shouldCreate: c.blockedTaskCount > 1 || (c.averageBlockedWaitDays ?? 0) > 3,
          severity: (c.averageBlockedWaitDays ?? 0) > 7 ? 'high' : 'medium',
          confidence: trend.confidence,
          rationaleSummary: `当前被阻塞任务 ${c.blockedTaskCount} 项，平均等待 ${c.averageBlockedWaitDays ?? '未知'} 天，信息/决策流转存在迟滞。`,
          targetRefs: [],
          suggestedActions: ['查看依据', '加入方案篮子', '记录审查'],
        }
      case 'process_rigidity':
        return {
          shouldCreate: c.reworkRatio !== null && c.reworkRatio > 0.15,
          severity: (c.reworkRatio ?? 0) > 0.3 ? 'high' : 'medium',
          confidence: trend.confidence,
          rationaleSummary: `变更/返工比例 ${(c.reworkRatio ?? 0).toFixed(2)}，变更响应天数 ${c.averageChangeResponseDays ?? '未知'}，流程可能存在僵化迹象。`,
          targetRefs: [],
          suggestedActions: ['查看依据', '加入方案篮子', '记录审查'],
        }
      case 'subsystem_imbalance':
        return {
          shouldCreate: c.subsystemProgressSpread !== null && c.subsystemProgressSpread > 0.3,
          severity: (c.subsystemProgressSpread ?? 0) > 0.6 ? 'critical' : 'high',
          confidence: trend.confidence,
          rationaleSummary: `子系统进度差达到 ${((c.subsystemProgressSpread ?? 0) * 100).toFixed(0)}%，超过不均衡阈值，存在集成与交付节奏风险。`,
          targetRefs: [],
          suggestedActions: ['查看依据', '加入方案篮子', '记录审查'],
        }
      case 'external_dependency_bottleneck':
        return {
          shouldCreate: c.externalDependencyCount > 0 && c.unhealthyExternalDependencyCount > 0,
          severity: c.unhealthyExternalDependencyCount > 2 ? 'high' : 'medium',
          confidence: trend.confidence,
          rationaleSummary: `外部依赖 ${c.externalDependencyCount} 项（不健康 ${c.unhealthyExternalDependencyCount} 项），向超系统进化的路径存在瓶颈。`,
          targetRefs: [],
          suggestedActions: ['查看依据', '加入方案篮子', '记录审查'],
        }
      case 'complexity_granularity_risk':
        return {
          shouldCreate: c.taskTotal > 20 || (c.averageTaskGranularityDays ?? 0) > 7,
          severity: (c.averageTaskGranularityDays ?? 0) > 14 ? 'high' : 'medium',
          confidence: trend.confidence,
          rationaleSummary: `平均任务粒度 ${c.averageTaskGranularityDays?.toFixed(1) ?? '未知'} 天，WBS 深层级 ${c.deepWbsLevelCount}，微观化/粒度管理存在优化空间。`,
          targetRefs: [],
          suggestedActions: ['查看依据', '加入方案篮子', '记录审查'],
        }
      case 'ideality_decline':
        return {
          shouldCreate:
            c.harmOrRiskGrowthSignals >= c.deliveredValueItemCount || c.costGrowthSignals > 2,
          severity: c.harmOrRiskGrowthSignals > c.deliveredValueItemCount ? 'critical' : 'high',
          confidence: trend.confidence,
          rationaleSummary: `已交付价值项 ${c.deliveredValueItemCount} vs 成本压力信号 ${c.costGrowthSignals} / 危害增长信号 ${c.harmOrRiskGrowthSignals}，理想度可能正在恶化。`,
          targetRefs: [],
          suggestedActions: ['查看依据', '加入方案篮子', '记录审查'],
        }
      case 'coordination_drift':
        return {
          shouldCreate:
            c.dependencyRhythmMismatchCount > 0 || (c.resourceLoadSyncSpread ?? 0) > 0.3,
          severity: c.dependencyRhythmMismatchCount > 3 ? 'high' : 'medium',
          confidence: trend.confidence,
          rationaleSummary: `依赖节奏失配数 ${c.dependencyRhythmMismatchCount}，资源负载离散度 ${((c.resourceLoadSyncSpread ?? 0) * 100).toFixed(0)}%，协调节奏可能出现漂移。`,
          targetRefs: [],
          suggestedActions: ['查看依据', '加入方案篮子', '记录审查'],
        }
      default:
        return {
          shouldCreate: false,
          severity: 'low',
          confidence: 0,
          rationaleSummary: '',
          targetRefs: [],
          suggestedActions: [],
        }
    }
  }

  private riskTitle(riskType: TrendRiskType): string {
    const titles: Record<TrendRiskType, string> = {
      role_gap: '角色/能力缺口',
      information_flow_delay: '信息流转迟滞',
      process_rigidity: '变更响应僵化',
      subsystem_imbalance: '子系统进度不均衡',
      external_dependency_bottleneck: '外部依赖瓶颈',
      complexity_granularity_risk: '复杂度/粒度风险',
      ideality_decline: '投入产出恶化',
      coordination_drift: '团队节奏失配',
    }
    return titles[riskType] ?? riskType
  }
}
