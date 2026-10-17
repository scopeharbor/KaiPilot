'use client'

import { useRouter } from 'next/navigation'

/**
 * v2-ai-smart-recommendations — 推荐深链跳转辅助工具。
 */

/** 跳转到项目推荐工作台，可选定位到特定推荐。 */
export function navigateToRecommendation(
  router: ReturnType<typeof useRouter>,
  projectId: number,
  recId?: number,
) {
  const base = `/projects/${projectId}/recommendations`
  if (recId) {
    router.push(`${base}?rec=${recId}`)
  } else {
    router.push(base)
  }
}

/** 构建推荐跳转 URL。 */
export function buildRecommendationUrl(projectId: number, recId?: number): string {
  const base = `/projects/${projectId}/recommendations`
  return recId ? `${base}?rec=${recId}` : base
}
