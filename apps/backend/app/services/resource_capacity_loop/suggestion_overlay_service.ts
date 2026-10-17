// v3-resource-capacity-forecasting-closed-loop —— suggestion→editable scenario overlay 转换（任务 5.7）。
//
// 规则：
// - 只把既有候选投影转换为 capacity-delta overlay 草稿（按 unmet bucket、role/skill key）；
// - 保留原候选 ref / 缺口 evidence refs；
// - 恒标记 advisoryOnly=true / applied=false / confirmationRequired=true；
// - 隐藏 ref 注入（candidateRefId 不在给定候选集内）一律拒绝。

import type { ResourceCapacityLoopOverlay } from '@aiproj/types/resource-capacity-closed-loop'
import type { SuggestionProjectionOutput } from '@aiproj/types/resource-capacity-closed-loop-pure'

export interface OverlayDraftConversionInput {
  suggestion: SuggestionProjectionOutput
  /** 允许引用的候选 ref 集（由调用方从当前授权候选结果传入）。 */
  allowedCandidateRefIds: readonly string[]
}

export interface ScenarioOverlayDraft {
  overlays: ResourceCapacityLoopOverlay[]
  posture: {
    advisoryOnly: true
    applied: false
    confirmationRequired: true
  }
  sourceCandidateRefIds: string[]
  evidenceKeys: string[]
}

export function convertSuggestionToOverlayDraft(
  input: OverlayDraftConversionInput,
): { ok: true; value: ScenarioOverlayDraft } | { ok: false; reason: string } {
  const s = input.suggestion
  const allowed = new Set(input.allowedCandidateRefIds)

  const overlays: ResourceCapacityLoopOverlay[] = []
  const sourceRefs: string[] = []

  for (const c of s.candidates) {
    const p = c.projection
    if (!allowed.has(p.candidateRefId)) {
      return { ok: false, reason: `候选引用不可见或已失效：${p.candidateRefId}` }
    }
    sourceRefs.push(p.candidateRefId)
    // 每个有覆盖的桶生成一条 capacity-delta 假设容量。
    for (const cov of p.coveredHoursPerBucket) {
      if (cov.coveredHours <= 0) continue
      if (p.availabilityConflictBuckets.includes(cov.bucket)) continue
      overlays.push({
        kind: 'capacity-delta',
        role: s.unmetDimension === 'role' ? s.unmetDimensionKey : null,
        normalizedSkillKey: s.unmetDimension === 'skill' ? s.unmetDimensionKey : null,
        bucket: cov.bucket,
        deltaHours: Math.round(cov.coveredHours * 100) / 100,
      })
    }
  }

  const evidenceKeys = [
    ...new Set(s.candidates.flatMap((c) => c.projection.evidenceRefs.map((e) => e.evidenceKey))),
  ].sort()

  return {
    ok: true,
    value: {
      overlays,
      posture: { advisoryOnly: true, applied: false, confirmationRequired: true },
      sourceCandidateRefIds: sourceRefs,
      evidenceKeys,
    },
  }
}
