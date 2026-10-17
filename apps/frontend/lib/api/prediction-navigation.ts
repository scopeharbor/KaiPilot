'use client'

import { useRouter } from 'next/navigation'

/**
 * v2-ai-risk-progress-prediction — 预测深链跳转辅助工具（8.3 P1）。
 *
 * 通知和报表深链跳转：通过项目 ID 和预测快照 ID 构建目标 URL，
 * 跳转到项目预测工作台并滚动到指定快照。
 */

/** 跳转到项目预测工作台，可选定位到特定快照。 */
export function navigateToPrediction(
  router: ReturnType<typeof useRouter>,
  projectId: number,
  snapshotId?: number,
) {
  const base = `/projects/${projectId}/predictions`
  if (snapshotId) {
    router.push(`${base}?snapshot=${snapshotId}`)
  } else {
    router.push(base)
  }
}

/** 构建预测跳转 URL（用于通知目标字段）。 */
export function buildPredictionUrl(projectId: number, snapshotId?: number): string {
  const base = `/projects/${projectId}/predictions`
  return snapshotId ? `${base}?snapshot=${snapshotId}` : base
}

/** 构建预测 AI 解释跳转 URL。 */
export function buildAiExplanationUrl(projectId: number, snapshotId: number): string {
  return `/projects/${projectId}/predictions?snapshot=${snapshotId}&tab=ai-explanation`
}
