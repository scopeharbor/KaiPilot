import type { ContradictionSeverity, ProjectParameterKey } from '@aiproj/types'
import type {
  PhysicalAnalysisCollectorOutput,
  PhysicalContradictionCandidate,
  PhysicalCandidateRequirement,
  PhysicalRuleId,
  SeparationAxis,
  PhysicalWarningCode,
} from '@aiproj/types'
import {
  PHYSICAL_WARNING_CODES,
  PHYSICAL_RULESET_VERSION,
  computePhysicalCandidateKey,
  computePhysicalCandidatesOutputHash,
  comparePhysicalCandidate,
  scoreSeparationPrincipleRelevance,
  getSeparationPrinciple,
} from '@aiproj/types'

/**
 * 物理矛盾检测规则集（v3-triz-physical-contradiction-analyzer §4.3）。
 *
 * 确定性规则：从只读收集输出派生物理矛盾候选。
 * 不调用 LLM；结果可复现、可审计。
 * 候选排序：严重度 → 置信度 → 影响分数 → 规则ID → candidateKey。
 */

/**
 * 收集器侧 warning code 的契约类型是宽 string；物理矛盾运行记录只接受码表内的值。
 * 表外码统一降级为 INSUFFICIENT_EVIDENCE，保留原文 message 以便追溯。
 */
function toPhysicalWarningCode(code: string | null | undefined): PhysicalWarningCode {
  return (PHYSICAL_WARNING_CODES as readonly string[]).includes(code ?? '')
    ? (code as PhysicalWarningCode)
    : 'INSUFFICIENT_EVIDENCE'
}

export interface PhysicalRulesetResult {
  candidates: PhysicalContradictionCandidate[]
  warnings: Array<{ code: PhysicalWarningCode; message: string }>
  outputHash: string
  ruleVersion: string
}

/** 规则命中时的低敏证据 refs。 */
function makeEvidenceRefs(
  entityType: string,
  count: number,
  detail: string,
): Array<{ entityType: string; entityId: number; lowSensitiveTitle: string }> {
  if (count <= 0) return []
  return [{ entityType, entityId: 0, lowSensitiveTitle: `${detail}（共 ${count} 项）` }]
}

function intensityToSeverity(intensity: number): ContradictionSeverity {
  if (intensity >= 0.75) return 'critical'
  if (intensity >= 0.5) return 'high'
  if (intensity >= 0.25) return 'medium'
  return 'low'
}

export default class PhysicalContradictionRuleset {
  evaluate(input: PhysicalAnalysisCollectorOutput): PhysicalRulesetResult {
    const candidates: PhysicalContradictionCandidate[] = []

    this.rulePd001ScopeAllAndFast(input, candidates)
    this.rulePd002ResourceHighUtilVsBuffer(input, candidates)
    this.rulePd003ScheduleFastVsStable(input, candidates)
    this.rulePd004GovernanceStableVsFlexible(input, candidates)
    this.rulePd005QualityStrictVsFast(input, candidates)
    this.rulePd006InformationDetailVsBrevity(input, candidates)
    this.rulePd007RiskLowVsCost(input, candidates)

    // 分类守卫（§4.4）：仅保留同参数对立候选；跨参数 trade-off 路由到技术矛盾分析，
    // 并对无法判定的证据记录 AMBIGUOUS_CLASSIFICATION 警告，不臆造参数映射。
    const filtered = candidates.filter((c) => c.parameterKey !== null)
    const guardWarnings = this.classificationGuard(input, filtered)

    // 稳定排序
    filtered.sort(comparePhysicalCandidate)

    const outputHash = computePhysicalCandidatesOutputHash(filtered)

    return {
      candidates: filtered,
      warnings: [
        ...input.warnings.map((w) => ({
          code: toPhysicalWarningCode(w.code),
          message: w.message,
        })),
        ...guardWarnings,
      ],
      outputHash,
      ruleVersion: PHYSICAL_RULESET_VERSION,
    }
  }

  /**
   * 分类守卫（§4.4）：将跨参数 trade-off 路由到技术矛盾分析，不作为物理候选。
   * 若证据同时呈现同参数对立与跨参数 trade-off 特征，记录模糊分类警告。
   */
  private classificationGuard(
    input: PhysicalAnalysisCollectorOutput,
    _candidates: PhysicalContradictionCandidate[],
  ): Array<{ code: PhysicalWarningCode; message: string }> {
    const warnings: Array<{ code: PhysicalWarningCode; message: string }> = []

    // 跨参数 trade-off 启发式：进度压缩同时抬高成本/风险（improving duration ↔ worsening cost/risk）
    const crossParameterRouted =
      input.overdueTaskCount >= 4 &&
      (input.highRiskCount >= 2 || (input.resourceUtilization ?? 0) >= 0.85)
    if (crossParameterRouted) {
      warnings.push({
        code: 'CROSS_PARAMETER_ROUTED',
        message: '检测到改善工期与恶化成本/风险的跨参数 trade-off，已路由到技术矛盾分析',
      })
    }

    // 模糊分类：证据不足以判定是同参数对立还是跨参数 trade-off
    const ambiguous =
      input.scopeItemCount >= 15 &&
      input.overdueTaskCount >= 2 &&
      input.informationCompletenessScore !== null &&
      input.informationCompletenessScore < 0.4
    if (ambiguous) {
      warnings.push({
        code: 'AMBIGUOUS_CLASSIFICATION',
        message: '证据不足以判定为同参数对立或跨参数 trade-off，请补充项目上下文后重审',
      })
    }

    return warnings
  }

  /** PD-001：范围既要全又要快。范围广 + 工期紧。 */
  private rulePd001ScopeAllAndFast(
    input: PhysicalAnalysisCollectorOutput,
    out: PhysicalContradictionCandidate[],
  ): void {
    const scopeWide = input.scopeItemCount >= 15
    const timeTight =
      (input.plannedDurationDays !== null && input.plannedDurationDays < 30) ||
      input.overdueTaskCount >= 2
    if (!scopeWide || !timeTight) return

    const intensity = Math.min(
      1,
      input.scopeItemCount / 60 + (input.overdueTaskCount >= 2 ? 0.2 : 0),
    )
    const severity = intensityToSeverity(intensity)
    const reqA: PhysicalCandidateRequirement = {
      summary: '范围要完整覆盖所有需求',
      context: `项目有 ${input.scopeItemCount} 个范围条目需要全面交付`,
      conditionRefs: ['cond_scope_broad'],
    }
    const reqB: PhysicalCandidateRequirement = {
      summary: '交付要快速完成',
      context: `项目工期紧迫${input.overdueTaskCount > 0 ? `，有 ${input.overdueTaskCount} 个逾期任务` : ''}`,
      conditionRefs: ['cond_time_tight'],
    }

    out.push(
      this.buildPhysicalCandidate(
        'PD-001',
        'scope',
        severity,
        0.75,
        reqA,
        reqB,
        'time',
        intensity,
        {
          contextA: '干系人验收阶段需要完整覆盖',
          contextB: '交付截止日前需要快速收敛',
          conditionRefs: ['cond_scope_broad', 'cond_time_tight'],
          evidenceRefs: [
            ...makeEvidenceRefs('scope_item', input.scopeItemCount, '范围广度'),
            ...makeEvidenceRefs('task', input.overdueTaskCount, '逾期任务驱动工期压力'),
          ],
          affectedScope: ['scope', 'duration'],
          warningCodes: [],
        },
      ),
    )
  }

  /** PD-002：资源既要高利用又要保留缓冲。利用率高且有过载。 */
  private rulePd002ResourceHighUtilVsBuffer(
    input: PhysicalAnalysisCollectorOutput,
    out: PhysicalContradictionCandidate[],
  ): void {
    const util = input.resourceUtilization ?? 0
    if (util < 0.6 && input.resourceOverloadCount === 0) return

    const intensity = Math.min(1, util + Math.min(0.3, input.resourceOverloadCount * 0.1))
    const severity = intensityToSeverity(intensity)
    const reqA: PhysicalCandidateRequirement = {
      summary: '资源利用率要高以节省成本',
      context: `当前平均利用率 ${Math.round(util * 100)}%`,
      conditionRefs: ['cond_cost_pressure'],
    }
    const reqB: PhysicalCandidateRequirement = {
      summary: '资源要保留缓冲应对突发',
      context: `有 ${input.resourceOverloadCount} 个资源已过载`,
      conditionRefs: ['cond_contingency'],
    }

    out.push(
      this.buildPhysicalCandidate(
        'PD-002',
        'resource_load',
        severity,
        0.8,
        reqA,
        reqB,
        'resource_state',
        intensity,
        {
          contextA: '成本敏感阶段需要高利用',
          contextB: '关键里程碑前需要保留缓冲',
          conditionRefs: ['cond_cost_pressure', 'cond_contingency'],
          evidenceRefs: [...makeEvidenceRefs('resource', input.resourceOverloadCount, '过载资源')],
          affectedScope: ['resource', 'stability'],
          warningCodes: input.resourceUtilization === null ? ['SOURCE_UNAVAILABLE'] : [],
        },
      ),
    )
  }

  /** PD-003：进度既要快又要稳。逾期压力与关键路径密度并存。 */
  private rulePd003ScheduleFastVsStable(
    input: PhysicalAnalysisCollectorOutput,
    out: PhysicalContradictionCandidate[],
  ): void {
    const hasOverdue = input.overdueTaskCount >= 2
    const hasCriticalDensity = input.criticalPathDensity >= 0.3
    if (!hasOverdue || !hasCriticalDensity) return

    const intensity = Math.min(1, input.overdueTaskCount / 8 + input.criticalPathDensity)
    const severity = intensityToSeverity(intensity)
    const reqA: PhysicalCandidateRequirement = {
      summary: '进度要快以追赶截止日',
      context: `${input.overdueTaskCount} 个任务逾期`,
      conditionRefs: ['cond_deadline_pressure'],
    }
    const reqB: PhysicalCandidateRequirement = {
      summary: '进度要稳以保证质量',
      context: `关键路径密度 ${Math.round(input.criticalPathDensity * 100)}%，缺乏缓冲`,
      conditionRefs: ['cond_critical_path'],
    }

    out.push(
      this.buildPhysicalCandidate(
        'PD-003',
        'duration',
        severity,
        0.7,
        reqA,
        reqB,
        'phase',
        intensity,
        {
          contextA: '追赶阶段需要加速',
          contextB: '稳定阶段需要按计划节奏',
          conditionRefs: ['cond_deadline_pressure', 'cond_critical_path'],
          evidenceRefs: [
            ...makeEvidenceRefs('task', input.overdueTaskCount, '逾期任务'),
            ...makeEvidenceRefs(
              'task',
              input.taskCount > 0 ? Math.round(input.criticalPathDensity * input.taskCount) : 0,
              '关键路径任务',
            ),
          ],
          affectedScope: ['duration', 'stability'],
          warningCodes: [],
        },
      ),
    )
  }

  /** PD-004：治理流程既要稳定又要灵活。里程碑多且变更请求活跃。 */
  private rulePd004GovernanceStableVsFlexible(
    input: PhysicalAnalysisCollectorOutput,
    out: PhysicalContradictionCandidate[],
  ): void {
    if (input.milestoneCount < 3 || input.changeRequestCount < 2) return

    const intensity = Math.min(1, input.milestoneCount / 12 + input.changeRequestCount / 10)
    const severity = intensityToSeverity(intensity)
    const reqA: PhysicalCandidateRequirement = {
      summary: '治理流程要稳定以保证可预测性',
      context: `有 ${input.milestoneCount} 个里程碑作为管控节点`,
      conditionRefs: ['cond_governance_stable'],
    }
    const reqB: PhysicalCandidateRequirement = {
      summary: '治理流程要灵活以应对变更',
      context: `有 ${input.changeRequestCount} 个变更请求需要处理`,
      conditionRefs: ['cond_governance_flexible'],
    }

    out.push(
      this.buildPhysicalCandidate(
        'PD-004',
        'stability',
        severity,
        0.65,
        reqA,
        reqB,
        'condition',
        intensity,
        {
          contextA: '基线阶段需要稳定治理',
          contextB: '变更密集时需灵活调整',
          conditionRefs: ['cond_governance_stable', 'cond_governance_flexible'],
          evidenceRefs: [
            ...makeEvidenceRefs('milestone', input.milestoneCount, '里程碑'),
            ...makeEvidenceRefs('change_request', input.changeRequestCount, '变更请求'),
          ],
          affectedScope: ['stability', 'flexibility'],
          warningCodes: [],
        },
      ),
    )
  }

  /** PD-005：质量门禁既要严格又要快速。质量关注度高且有过期压力。 */
  private rulePd005QualityStrictVsFast(
    input: PhysicalAnalysisCollectorOutput,
    out: PhysicalContradictionCandidate[],
  ): void {
    const qualityConcern =
      input.governanceComplexity === 'high' ||
      (input.informationCompletenessScore !== null && input.informationCompletenessScore > 0.8)
    if (!qualityConcern || input.overdueTaskCount < 1) return

    const intensity = Math.min(
      1,
      (input.governanceComplexity === 'high' ? 0.6 : 0.3) +
        Math.min(0.4, input.overdueTaskCount / 8),
    )
    const severity = intensityToSeverity(intensity)
    const reqA: PhysicalCandidateRequirement = {
      summary: '质量门禁要严格以保证交付质量',
      context: `治理复杂度为 ${input.governanceComplexity}`,
      conditionRefs: ['cond_quality_strict'],
    }
    const reqB: PhysicalCandidateRequirement = {
      summary: '质量检查要快速以追赶进度',
      context: `${input.overdueTaskCount} 个任务逾期`,
      conditionRefs: ['cond_deadline_pressure'],
    }

    out.push(
      this.buildPhysicalCandidate(
        'PD-005',
        'quality',
        severity,
        0.6,
        reqA,
        reqB,
        'condition',
        intensity,
        {
          contextA: '高复杂度项目需要严格门禁',
          contextB: '工期压力下需要快速通过',
          conditionRefs: ['cond_quality_strict', 'cond_deadline_pressure'],
          evidenceRefs: [
            ...makeEvidenceRefs('task', input.overdueTaskCount, '逾期任务驱动质量加速'),
          ],
          affectedScope: ['quality', 'duration'],
          warningCodes: [],
        },
      ),
    )
  }

  /** PD-006：信息既要详尽又要简洁。信息完整度高且项目规模大。 */
  private rulePd006InformationDetailVsBrevity(
    input: PhysicalAnalysisCollectorOutput,
    out: PhysicalContradictionCandidate[],
  ): void {
    const highInfo =
      input.informationCompletenessScore !== null && input.informationCompletenessScore > 0.7
    if (!highInfo || input.taskCount < 10) return

    const intensity = Math.min(1, (input.informationCompletenessScore ?? 0) + input.taskCount / 100)
    const severity = intensityToSeverity(intensity)
    const reqA: PhysicalCandidateRequirement = {
      summary: '信息要详尽以保证决策质量',
      context: `信息完整度 ${Math.round((input.informationCompletenessScore ?? 0) * 100)}%`,
      conditionRefs: ['cond_info_detailed'],
    }
    const reqB: PhysicalCandidateRequirement = {
      summary: '信息要简洁以便快速阅读和行动',
      context: `${input.taskCount} 个任务需要快速掌握`,
      conditionRefs: ['cond_info_concise'],
    }

    out.push(
      this.buildPhysicalCandidate(
        'PD-006',
        'information_completeness',
        severity,
        0.55,
        reqA,
        reqB,
        'stakeholder',
        intensity,
        {
          contextA: '管理层需要详尽信息做决策',
          contextB: '执行层需要简洁信息快速行动',
          conditionRefs: ['cond_info_detailed', 'cond_info_concise'],
          evidenceRefs: [...makeEvidenceRefs('task', input.taskCount, '任务规模驱动信息负载')],
          affectedScope: ['information_completeness'],
          warningCodes: [],
        },
      ),
    )
  }

  /** PD-007：风险既要降低又要控制成本。高风险项多且有成本压力。 */
  private rulePd007RiskLowVsCost(
    input: PhysicalAnalysisCollectorOutput,
    out: PhysicalContradictionCandidate[],
  ): void {
    if (input.highRiskCount < 2) return

    const intensity = Math.min(1, input.highRiskCount / 6)
    const severity = intensityToSeverity(intensity)
    const reqA: PhysicalCandidateRequirement = {
      summary: '风险水平要尽可能降低',
      context: `有 ${input.highRiskCount} 个高风险项`,
      conditionRefs: ['cond_risk_reduction'],
    }
    const reqB: PhysicalCandidateRequirement = {
      summary: '风险应对成本要控制',
      context: `资源利用率 ${Math.round((input.resourceUtilization ?? 0) * 100)}%，预算有限`,
      conditionRefs: ['cond_cost_control'],
    }

    out.push(
      this.buildPhysicalCandidate(
        'PD-007',
        'risk_level',
        severity,
        0.7,
        reqA,
        reqB,
        'condition',
        intensity,
        {
          contextA: '高风险暴露时需要全力降低',
          contextB: '成本受限时需要选择性应对',
          conditionRefs: ['cond_risk_reduction', 'cond_cost_control'],
          evidenceRefs: [...makeEvidenceRefs('risk', input.highRiskCount, '高风险项驱动应对投入')],
          affectedScope: ['risk_level', 'cost'],
          warningCodes: [],
        },
      ),
    )
  }

  private buildPhysicalCandidate(
    ruleId: PhysicalRuleId,
    parameterKey: ProjectParameterKey,
    severity: ContradictionSeverity,
    confidence: number,
    requirementA: PhysicalCandidateRequirement,
    requirementB: PhysicalCandidateRequirement,
    separationAxis: SeparationAxis,
    intensity: number,
    extras: {
      contextA: string
      contextB: string
      conditionRefs: string[]
      evidenceRefs: Array<{ entityType: string; entityId: number; lowSensitiveTitle: string }>
      affectedScope: string[]
      warningCodes: PhysicalWarningCode[]
    },
  ): PhysicalContradictionCandidate {
    const candidateKey = computePhysicalCandidateKey(
      ruleId,
      parameterKey,
      requirementA.summary,
      requirementB.summary,
    )

    // 确定性的原则建议
    const principleRefs = this.mapSeparationPrinciples(separationAxis, parameterKey)

    const rationaleSummary = this.buildDeterministicRationale(
      parameterKey,
      requirementA.summary,
      requirementB.summary,
      separationAxis,
    )

    const nowStr = new Date().toISOString()
    const impactScore = Number(Math.min(1, Math.max(0, intensity)).toFixed(2))

    return {
      candidateKey,
      ruleId,
      ruleVersion: PHYSICAL_RULESET_VERSION,
      status: 'unreviewed',
      parameterKey,
      requirementA,
      requirementB,
      separationAxis,
      contextA: extras.contextA,
      contextB: extras.contextB,
      conditionRefs: extras.conditionRefs,
      severity,
      confidence,
      impactScore,
      evidenceRefs: extras.evidenceRefs,
      affectedScope: extras.affectedScope,
      principleRefs,
      rationaleSummary,
      warningCodes: extras.warningCodes,
      sourceHashes: {},
      outputHash: '',
      reviewedBy: null,
      reviewedAt: null,
      aiExplanationRef: null,
      createdAt: nowStr,
      updatedAt: null,
    }
  }

  /** 确定性分离原则映射（复用 shared registry）。 */
  private mapSeparationPrinciples(
    axis: SeparationAxis,
    paramKey: ProjectParameterKey,
  ): Array<{ principleKey: string; name: string; relevance: number; advice: string }> {
    // 主要分离原则
    const axisToPrinciple: Partial<Record<SeparationAxis, string>> = {
      time: 'time_separation',
      space: 'space_separation',
      condition: 'condition_separation',
      stakeholder: 'stakeholder_separation',
      level: 'level_separation',
      phase: 'phase_separation',
      resource_state: 'resource_state_separation',
    }

    const results: Array<{
      principleKey: string
      name: string
      relevance: number
      advice: string
    }> = []

    // 首要原则
    const primary = axisToPrinciple[axis]
    if (primary) {
      const entry = getSeparationPrinciple(primary)
      if (entry) {
        const relevance = scoreSeparationPrincipleRelevance(axis, paramKey)
        results.push({
          principleKey: entry.principleKey,
          name: entry.name,
          relevance: Number(Math.min(1, relevance + 0.05).toFixed(2)),
          advice: entry.pmGuidance,
        })
      }
    }

    // 次要补充原则
    if (axis !== 'time' && results.length < 2) {
      const timeEntry = getSeparationPrinciple('time_separation')
      if (timeEntry) {
        results.push({
          principleKey: timeEntry.principleKey,
          name: timeEntry.name,
          relevance: 0.55,
          advice: timeEntry.pmGuidance,
        })
      }
    }

    if (axis !== 'condition' && results.length < 3) {
      const condEntry = getSeparationPrinciple('condition_separation')
      if (condEntry) {
        results.push({
          principleKey: condEntry.principleKey,
          name: condEntry.name,
          relevance: 0.4,
          advice: condEntry.pmGuidance,
        })
      }
    }

    return results
  }

  /** 确定性理由摘要（中文，advisory only）。 */
  private buildDeterministicRationale(
    parameterKey: ProjectParameterKey,
    reqA: string,
    reqB: string,
    axis: SeparationAxis,
  ): string {
    const axisLabels: Record<SeparationAxis, string> = {
      time: '时间',
      space: '空间',
      condition: '条件',
      stakeholder: '干系人',
      level: '层级',
      phase: '阶段',
      resource_state: '资源状态',
      none: '无明确维度',
    }

    const paramLabels: Partial<Record<ProjectParameterKey, string>> = {
      scope: '范围',
      duration: '工期/进度',
      resource_load: '资源负载',
      quality: '质量',
      stability: '稳定性',
      flexibility: '灵活性',
      risk_level: '风险水平',
      cost: '成本',
      information_completeness: '信息完整度',
      throughput: '交付吞吐',
      uncertainty: '不确定性',
      maintainability: '可维护性',
    }

    const paramLabel = paramLabels[parameterKey] ?? parameterKey
    const axisLabel = axisLabels[axis]

    return `该矛盾涉及${paramLabel}参数的相反要求：「${reqA}」与「${reqB}」。建议通过${axisLabel}分离：在不同${axisLabel}条件下分别满足这两个要求，而非试图同时满足。此为待人工审查的选项，不构成自动解决建议。`
  }
}
