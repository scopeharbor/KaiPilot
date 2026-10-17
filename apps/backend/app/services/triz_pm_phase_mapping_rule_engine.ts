import type {
  PmPhaseId,
  PmSourceRef,
  PhaseSnapshot,
  PhaseGapDiagnostic,
  PhaseRecommendation,
  PhaseActionKind,
  PhaseHandoffTarget,
} from '@aiproj/types'
import {
  PM_PHASE_IDS,
  PM_PHASE_LABELS,
  trizSourceToPrimaryPhases,
  criticalSourcesForPhase,
  recommendedTrizToolsForPhase,
  computeReadiness,
  computeSourceFreshness,
  sortPhaseRecommendations,
  aggregatePhaseWarnings,
  maxWarningSeverity,
  generatePhaseSnapshotId,
  generateRecommendationId,
  buildSourceMappingKey,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'
import type { PmPhaseCollectorOutput } from './triz_pm_phase_input_collector.js'

/**
 * TRIZ-PM 阶段映射规则引擎（v3-triz-pm-phase-integration §4.9–§4.10）。
 *
 * 消费共享纯函数，将已授权来源映射为五个 PM 阶段的确定性快照。
 * 输出必须稳定排序、稳定 hash，不调用 AIGateway。
 */
@inject()
export default class TrizPmPhaseMappingRuleEngine {
  /**
   * 消费 InputCollector 输出，为每个 PM 阶段生成 PhaseSnapshot。
   */
  mapToPhaseSnapshots(input: PmPhaseCollectorOutput, runId: string): PhaseSnapshot[] {
    const { sourceRefs, warnings } = input

    // 按 phase 分组来源
    const phaseSourceMap = new Map<PmPhaseId, PmSourceRef[]>()
    for (const pid of PM_PHASE_IDS) {
      phaseSourceMap.set(pid, [])
    }

    for (const ref of sourceRefs) {
      const primaryPhases = trizSourceToPrimaryPhases(ref.sourceKind)
      for (const phase of primaryPhases) {
        const arr = phaseSourceMap.get(phase)
        if (arr) arr.push(ref)
      }
    }

    const snapshots: PhaseSnapshot[] = []

    for (const phaseId of PM_PHASE_IDS) {
      const phaseRefs = phaseSourceMap.get(phaseId) ?? []
      const phaseHashes: Record<string, string> = {}
      for (const ref of phaseRefs) {
        phaseHashes[buildSourceMappingKey(ref.sourceKind, ref.sourceId)] = ref.sourceHash
      }

      // 计算关键来源缺口
      const criticalKinds = criticalSourcesForPhase(phaseId)
      const missingCritical = criticalKinds.filter(
        (k) => !phaseRefs.some((r) => r.sourceKind === k),
      )

      // 缺口诊断
      const gaps: PhaseGapDiagnostic[] = missingCritical.map((mk) => ({
        missingSourceKind: mk,
        severity: 'medium' as const,
        description: `${PM_PHASE_LABELS[phaseId]} 阶段缺少关键来源: ${mk}`,
        recommendedAction: recommendedTrizToolsForPhase(phaseId)[0] ?? 'review_contradiction',
        requiresUserConfirmation: true,
        previewOnly: true,
      }))

      // 推荐审查动作
      const recommendedTools = recommendedTrizToolsForPhase(phaseId)
      const recommendations: PhaseRecommendation[] = recommendedTools.map((ak, idx) => ({
        recommendationId: generateRecommendationId(runId, phaseId, idx),
        actionKind: ak,
        title: `${PM_PHASE_LABELS[phaseId]} - ${actionLabel(ak)}`,
        description: actionDescription(ak, phaseId),
        sourceRefs: phaseRefs.slice(0, 3),
        handoffEligible: idx < 3,
        handoffTargets: actionToHandoffTargets(ak),
        priority: idx + 1,
        requiresUserConfirmation: true,
        previewOnly: true,
      }))

      // 计算 readiness
      const totalSources = phaseRefs.length + missingCritical.length
      const staleOrMissing = missingCritical.length
      const freshness = computeSourceFreshness(totalSources, staleOrMissing)
      const unresolvedDecisions = 0 // no real-time decision count in pure mapping
      const staleCount = 0
      const phaseWarnings = aggregatePhaseWarnings(
        warnings.filter(
          (w) =>
            phaseRefs.some((r) => r.sourceKind === w.sourceKind) ||
            missingCritical.some((mk) => mk === w.sourceKind),
        ),
      )
      const sevMax = maxWarningSeverity(phaseWarnings)
      const needsHuman = missingCritical.length > 0 || phaseWarnings.length > 0

      const readiness = computeReadiness(
        freshness,
        unresolvedDecisions,
        staleCount,
        missingCritical.length,
        sevMax,
        recommendations.length > 0,
        needsHuman,
      )

      const snapshot: PhaseSnapshot = {
        snapshotId: generatePhaseSnapshotId(runId, phaseId),
        runId,
        phaseId,
        phaseLabel: PM_PHASE_LABELS[phaseId],
        sourceRefs: phaseRefs,
        sourceHashes: phaseHashes,
        readiness,
        gaps,
        recommendations: sortPhaseRecommendations(recommendations),
        warnings: phaseWarnings,
        stale: false,
        methodologyHint: `固定五阶段通用 PM 方法论; ${phaseId}`,
      }

      snapshots.push(snapshot)
    }

    return snapshots
  }
}

// ─── Helper: Action Labels ────────────────────────────────────────────────

function actionLabel(ak: string): string {
  const labels: Record<string, string> = {
    review_contradiction: '审查矛盾分析',
    review_matrix: '查看矛盾矩阵',
    review_technical_analysis: '审查技术矛盾',
    review_physical_analysis: '审查物理矛盾',
    review_ifr: '审查 IFR 理想解',
    review_function_analysis: '审查功能分析',
    review_resource_analysis: '审查资源分析',
    review_evolution_trend: '审查进化趋势',
    open_workbench: '打开创新工作台',
    open_decision_center: '打开决策中心',
    open_draft_review: '审查草案',
    request_clarification: '请求澄清',
    review_risk: '审查风险',
    review_change: '审查变更',
    record_review: '记录审查',
  }
  return labels[ak] ?? ak
}

function actionDescription(ak: string, phaseId: PmPhaseId): string {
  const descs: Record<string, string> = {
    review_contradiction: '建议审查该阶段的矛盾分析结果',
    review_matrix: '建议查看矛盾矩阵中的相关参数对',
    review_technical_analysis: '建议审查技术矛盾分析候选',
    review_physical_analysis: '建议审查物理矛盾分析候选',
    review_ifr: '建议审查最终理想解方向',
    review_function_analysis: '建议审查功能分析图',
    review_resource_analysis: '建议审查资源分析中的未利用机会',
    review_evolution_trend: '建议审查进化趋势分析',
    open_workbench: '建议将候选方案加入创新工作台',
    open_decision_center: '建议打开决策中心审查相关项',
    open_draft_review: '建议审查 Draft Layer 就绪状态',
    request_clarification: '建议对缺口证据请求澄清',
    review_risk: '建议审查阶段风险',
    review_change: '建议审查变更管理候选',
    record_review: '建议记录本阶段人工审查结果',
  }
  return descs[ak] ?? `建议审查 ${PM_PHASE_LABELS[phaseId]} 阶段相关内容`
}

function actionToHandoffTargets(ak: PhaseActionKind): PhaseHandoffTarget[] {
  // 用 PhaseActionKind 做键：新增动作时缺映射会在编译期暴露
  const targets: Record<PhaseActionKind, PhaseHandoffTarget[]> = {
    review_contradiction: ['workbench', 'decision_center'],
    review_matrix: ['workbench'],
    review_technical_analysis: ['workbench', 'decision_center'],
    review_physical_analysis: ['workbench', 'decision_center'],
    review_ifr: ['workbench'],
    review_function_analysis: ['workbench'],
    review_resource_analysis: ['workbench', 'decision_center'],
    review_evolution_trend: ['workbench', 'decision_center'],
    open_workbench: ['workbench'],
    open_decision_center: ['decision_center'],
    open_draft_review: ['draft_layer'],
    request_clarification: ['clarification'],
    review_risk: ['risk_review'],
    review_change: ['change_review'],
    record_review: [],
  }
  return targets[ak]
}
