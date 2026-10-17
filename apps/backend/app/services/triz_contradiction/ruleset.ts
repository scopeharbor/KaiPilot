import type {
  CandidateContradiction,
  ContradictionEvidence,
  ContradictionInputSnapshot,
  ContradictionSeverity,
  ContradictionInputWarning,
  ProjectParameterKey,
} from '@aiproj/types'
import {
  CONTRADICTION_RULESET_VERSION,
  computeDedupeKey,
  computeOutputHash,
  compareCandidateContradiction,
} from '@aiproj/types'

export { CONTRADICTION_RULESET_VERSION as RULESET_VERSION }

/**
 * 矛盾检测规则集（v2-triz-contradiction-model-foundation D4）。
 *
 * 确定性规则：从只读输入快照派生候选矛盾（technical / physical）。
 * 不调用 LLM；结果可复现、可审计。严重度 + 置信度 + 稳定排序 + dedupe 合并。
 */

export interface RulesetResult {
  candidates: CandidateContradiction[]
  warnings: ContradictionInputWarning[]
  outputHash: string
  ruleVersion: string
}

const HIGH_RISK_THRESHOLD = 2
const HIGH_CRITICAL_DENSITY = 0.4
const HIGH_UTILIZATION = 0.85

/**
 * 把 0–1 强度映射到严重度（确定性）。
 */
function intensityToSeverity(intensity: number): ContradictionSeverity {
  if (intensity >= 0.75) return 'critical'
  if (intensity >= 0.5) return 'high'
  if (intensity >= 0.25) return 'medium'
  return 'low'
}

/** 规则命中时的派生证据（低敏，仅引用既有实体类型与计数）。 */
function countEvidence(entityType: string, count: number, detail: string): ContradictionEvidence[] {
  if (count <= 0) return []
  return [
    {
      entityType,
      entityId: 0,
      title: `${entityType} 聚合`,
      detail: `${detail}（共 ${count} 项）`,
      isVisible: true,
    },
  ]
}

export default class ContradictionDetectionRuleset {
  /**
   * 对输入快照执行全部规则，返回稳定排序、去重后的候选矛盾集合 + output hash。
   */
  evaluate(input: ContradictionInputSnapshot): RulesetResult {
    const warnings = [...input.warnings]
    const candidates: CandidateContradiction[] = []

    this.ruleCd001SchedulePressure(input, candidates)
    this.ruleCd002ResourceUtilization(input, candidates)
    this.ruleCd003ScopeVsDuration(input, candidates)
    this.ruleCd004RiskReductionCost(input, candidates)
    this.ruleCd005CriticalPathFlexibility(input, candidates)
    this.ruleCd006PhysicalScopeAllAndFast(input, candidates)

    // 去重：按 dedupeKey 合并，保留严重度/置信度更高者
    const deduped = this.dedupe(candidates, input.projectId)

    // 稳定排序：严重度 → 置信度 → ruleId → 标题
    deduped.sort(compareCandidateContradiction)

    const outputHash = computeOutputHash(deduped)

    return {
      candidates: deduped,
      warnings,
      outputHash,
      ruleVersion: CONTRADICTION_RULESET_VERSION,
    }
  }

  /** CD-001：工期压缩 ↔ 成本/风险/质量。逾期压力越高越严重。 */
  private ruleCd001SchedulePressure(
    input: ContradictionInputSnapshot,
    out: CandidateContradiction[],
  ): void {
    if (input.taskTotal === 0) return
    const overdueRatio = input.overdueTaskCount / input.taskTotal
    if (overdueRatio < 0.1 && input.overdueTaskCount === 0) return
    const intensity = Math.min(1, overdueRatio * 2 + (input.overdueTaskCount >= 3 ? 0.2 : 0))
    const severity = intensityToSeverity(intensity)
    const worseningKey: ProjectParameterKey = input.highRiskCount > 0 ? 'risk_level' : 'cost'
    out.push(
      this.technicalCandidate({
        ruleId: 'CD-001',
        severity,
        confidence: 0.7 + Math.min(0.25, overdueRatio),
        improvingParameterKey: 'duration',
        worseningParameterKey: worseningKey,
        improvingDirection: '为追赶工期压缩进度',
        worseningDirection:
          worseningKey === 'risk_level' ? '风险敞口扩大' : '赶工成本（加班/加资源）上升',
        title: `压缩工期会抬高${worstKeyLabel(worseningKey)}与质量风险`,
        evidence: countEvidence('task', input.overdueTaskCount, '逾期任务驱动工期压力'),
        affectedScope: ['schedule', worseningKey],
      }),
    )
  }

  /** CD-002：资源利用率↑ ↔ 负载/稳定性。利用率高或存在过载即命中。 */
  private ruleCd002ResourceUtilization(
    input: ContradictionInputSnapshot,
    out: CandidateContradiction[],
  ): void {
    const utilization = input.resourceUtilization
    if (utilization === null && input.resourceOverloadCount === 0) return
    const u = utilization ?? 0
    if (u < HIGH_UTILIZATION && input.resourceOverloadCount === 0) return
    const intensity = Math.min(1, u + Math.min(0.3, input.resourceOverloadCount * 0.15))
    out.push(
      this.technicalCandidate({
        ruleId: 'CD-002',
        severity: intensityToSeverity(intensity),
        confidence: 0.8,
        improvingParameterKey: 'resource_load',
        worseningParameterKey: 'stability',
        improvingDirection: '提高资源利用率',
        worseningDirection: '负载过载、计划稳定性下降',
        title: '提高资源利用率会降低计划稳定性',
        evidence: countEvidence(
          'resource',
          input.resourceOverloadCount,
          `平均利用率 ${Math.round(u * 100)}%`,
        ),
        affectedScope: ['resource', 'stability'],
      }),
    )
  }

  /** CD-003：范围↑ ↔ 工期/质量。范围广度大且任务多即命中。 */
  private ruleCd003ScopeVsDuration(
    input: ContradictionInputSnapshot,
    out: CandidateContradiction[],
  ): void {
    if (input.scopeItemCount < 15) return
    const intensity = Math.min(1, input.scopeItemCount / 60)
    out.push(
      this.technicalCandidate({
        ruleId: 'CD-003',
        severity: intensityToSeverity(intensity),
        confidence: 0.65,
        improvingParameterKey: 'scope',
        worseningParameterKey: input.overdueTaskCount > 0 ? 'duration' : 'quality',
        improvingDirection: '扩大交付范围、覆盖更全',
        worseningDirection: '工期延长或验收质量下降',
        title: '扩大范围会延长工期或降低质量',
        evidence: countEvidence('scope_item', input.scopeItemCount, '范围条目驱动范围广度'),
        affectedScope: ['scope', 'duration'],
      }),
    )
  }

  /** CD-004：风险降低 ↔ 成本/工期。高风险项多时，进一步降低需投入成本/工期。 */
  private ruleCd004RiskReductionCost(
    input: ContradictionInputSnapshot,
    out: CandidateContradiction[],
  ): void {
    if (input.highRiskCount < HIGH_RISK_THRESHOLD) return
    const intensity = Math.min(1, input.highRiskCount / 6)
    out.push(
      this.technicalCandidate({
        ruleId: 'CD-004',
        severity: intensityToSeverity(intensity),
        confidence: 0.7,
        improvingParameterKey: 'risk_level',
        worseningParameterKey: input.overdueTaskCount > 0 ? 'duration' : 'cost',
        improvingDirection: '进一步降低风险水平',
        worseningDirection: '应对投入抬高成本或工期',
        title: '进一步降低风险会抬高成本或工期',
        evidence: countEvidence('risk', input.highRiskCount, '高风险项驱动风险应对成本'),
        affectedScope: ['risk', 'cost'],
      }),
    )
  }

  /** CD-005：关键路径密度↑ ↔ 灵活性。关键路径占比高则灵活性低。 */
  private ruleCd005CriticalPathFlexibility(
    input: ContradictionInputSnapshot,
    out: CandidateContradiction[],
  ): void {
    if (input.taskTotal === 0 || input.criticalPathDensity < HIGH_CRITICAL_DENSITY) return
    const intensity = Math.min(1, input.criticalPathDensity)
    out.push(
      this.technicalCandidate({
        ruleId: 'CD-005',
        severity: intensityToSeverity(intensity),
        confidence: 0.75,
        improvingParameterKey: 'throughput',
        worseningParameterKey: 'flexibility',
        improvingDirection: '提升交付吞吐、压缩关键路径',
        worseningDirection: '计划灵活性下降、缓冲减少',
        title: '关键路径密度高会降低计划灵活性',
        evidence: countEvidence(
          'task',
          input.criticalPathTaskCount,
          `关键路径占比 ${Math.round(input.criticalPathDensity * 100)}%`,
        ),
        affectedScope: ['schedule', 'flexibility'],
      }),
    )
  }

  /** CD-006：物理矛盾——范围既要全又要快。范围广 + 工期短/逾期压力同时存在。 */
  private ruleCd006PhysicalScopeAllAndFast(
    input: ContradictionInputSnapshot,
    out: CandidateContradiction[],
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
    out.push({
      type: 'physical',
      ruleId: 'CD-006',
      severity: intensityToSeverity(intensity),
      confidence: 0.7,
      improvingParameterKey: null,
      worseningParameterKey: null,
      improvingDirection: null,
      worseningDirection: null,
      parameterKey: 'scope',
      requirementA: '范围要完整覆盖',
      requirementB: '交付要快速完成',
      title: '范围既要完整又要快速交付',
      evidence: countEvidence('scope_item', input.scopeItemCount, '范围广度与工期约束并存'),
      affectedScope: ['scope', 'duration'],
    })
  }

  /** 组装一条技术矛盾候选。 */
  private technicalCandidate(
    fields: Pick<
      CandidateContradiction,
      | 'ruleId'
      | 'severity'
      | 'confidence'
      | 'improvingParameterKey'
      | 'worseningParameterKey'
      | 'improvingDirection'
      | 'worseningDirection'
      | 'title'
      | 'evidence'
      | 'affectedScope'
    >,
  ): CandidateContradiction {
    return {
      type: 'technical',
      ruleId: fields.ruleId,
      severity: fields.severity,
      confidence: fields.confidence,
      improvingParameterKey: fields.improvingParameterKey,
      worseningParameterKey: fields.worseningParameterKey,
      improvingDirection: fields.improvingDirection,
      worseningDirection: fields.worseningDirection,
      parameterKey: null,
      requirementA: null,
      requirementB: null,
      title: fields.title,
      evidence: fields.evidence,
      affectedScope: fields.affectedScope,
    }
  }

  /** 按 dedupeKey 合并同逻辑矛盾，保留严重度/置信度更高者。 */
  private dedupe(
    candidates: CandidateContradiction[],
    projectId: number,
  ): CandidateContradiction[] {
    const seen = new Map<string, CandidateContradiction>()
    for (const c of candidates) {
      const dedupeKey = computeDedupeKey(projectId, c)
      const existing = seen.get(dedupeKey)
      if (!existing) {
        seen.set(dedupeKey, c)
        continue
      }
      // 合并：取更高严重度，证据并集（去重），affectedScope 并集
      const higher =
        c.severity === existing.severity
          ? c.confidence >= existing.confidence
            ? c
            : existing
          : severityRankCompare(c.severity, existing.severity) > 0
            ? c
            : existing
      const evidenceKeys = new Set(existing.evidence.map((e) => `${e.entityType}:${e.detail}`))
      const mergedEvidence = [...existing.evidence]
      for (const e of c.evidence) {
        const k = `${e.entityType}:${e.detail}`
        if (!evidenceKeys.has(k)) {
          evidenceKeys.add(k)
          mergedEvidence.push(e)
        }
      }
      seen.set(dedupeKey, {
        ...higher,
        evidence: mergedEvidence,
        affectedScope: Array.from(new Set([...existing.affectedScope, ...c.affectedScope])),
      })
    }
    return Array.from(seen.values())
  }
}

function severityRankCompare(a: ContradictionSeverity, b: ContradictionSeverity): number {
  const order: ContradictionSeverity[] = ['low', 'medium', 'high', 'critical']
  return order.indexOf(a) - order.indexOf(b)
}

function worstKeyLabel(key: ProjectParameterKey): string {
  const labels: Record<string, string> = {
    cost: '成本',
    risk_level: '风险',
    quality: '质量',
    duration: '工期',
    stability: '稳定性',
    flexibility: '灵活性',
    scope: '范围',
    resource_load: '资源负载',
    information_completeness: '信息完整度',
    maintainability: '可维护性',
    uncertainty: '不确定性',
    throughput: '吞吐',
  }
  return labels[key] ?? key
}
