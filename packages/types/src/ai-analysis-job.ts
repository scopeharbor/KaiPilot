/** 后台分析只产出确认上下文，不创建正式项目。任务仅对原组织的发起人可见。 */
export type AiAnalysisJobKind = 'intent' | 'understanding'
export type AiAnalysisJobState = 'queued' | 'running' | 'completed' | 'failed'

export interface AiAnalysisJob<T = unknown> {
  id: string
  kind: AiAnalysisJobKind
  state: AiAnalysisJobState
  liveOutputId: string | null
  createdAt: number
  updatedAt: number
  expiresAt: number
  /** 阶段说明，不用虚构百分比。 */
  progress: string
  result?: T
  error?: { code: string; message: string }
}
