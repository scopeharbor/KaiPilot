'use client'

import { ProjectPredictionPanel } from '@/components/views/predictions/ProjectPredictionPanel'
import { useParams } from 'next/navigation'

/**
 * v2-ai-risk-progress-prediction — 项目预测页面路由。
 */
export default function ProjectPredictionsPage() {
  const projectId = Number(useParams().id)

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col px-4 py-6 md:px-8 lg:px-10">
      <ProjectPredictionPanel projectId={projectId} />
    </main>
  )
}
