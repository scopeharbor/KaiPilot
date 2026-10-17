/**
 * v2-triz-ai-clarification-cards —— Validation feedback artifacts (tasks 4.4)
 *
 * 验证反馈 artifact schema，用于记录校验失败、反幻觉未通过、过期回答和预算降级。
 * 这些 artifact 只保存在 Compiler 运行态，不写入正式业务表。
 */

export type ValidationFeedbackType =
  'source_validation_failed' | 'hallucination_failed' | 'stale_answer_detected' | 'budget_fallback'

export interface ValidationFeedbackEntry {
  type: ValidationFeedbackType
  cardId?: string
  message: string
  details: string[]
  sourceHash?: string
}

export interface ValidationFeedbackArtifact {
  schemaVersion: string
  projectId: number
  runId: number
  feedback: ValidationFeedbackEntry[]
  createdAt: string
  summary: {
    totalChecks: number
    passed: number
    failed: number
    fallbacks: number
  }
}

export function createValidationFeedbackArtifact(
  entries: ValidationFeedbackEntry[],
  projectId: number,
  runId: number,
): ValidationFeedbackArtifact {
  const passed = entries.filter(
    (e) =>
      !e.type.includes('failed') &&
      e.type !== 'budget_fallback' &&
      e.type !== 'stale_answer_detected',
  ).length
  const failed = entries.filter((e) => e.type.includes('failed')).length
  const fallbacks = entries.filter((e) => e.type === 'budget_fallback').length

  return {
    schemaVersion: '1.0',
    projectId,
    runId,
    feedback: entries,
    createdAt: new Date().toISOString(),
    summary: {
      totalChecks: entries.length,
      passed,
      failed,
      fallbacks,
    },
  }
}
