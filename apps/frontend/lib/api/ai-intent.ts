import { apiFetch, apiRawFetch } from '@/lib/api-client'
import type { AnalyzeProjectIntentRequest, AnalyzeProjectIntentResponse } from '@aiproj/types'
import { runAnalysisJob, type AnalysisJobOptions } from './analysis-jobs'

/** 「我不了解这道题」的一次追问。history 由前端持有，服务端不存这段解释对话。 */
export interface ExplainClarificationTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ExplainClarificationRequest {
  rawInput: string
  adaptiveSessionToken: string
  /** 留空表示「先整体解释一下这道题」。 */
  question?: string
  history?: ExplainClarificationTurn[]
  connectionId?: number
  modelId?: number
}

export interface RequirementAttachmentResult {
  fileName: string
  kind: 'text' | 'docx' | 'pdf' | 'image'
  method: 'text' | 'docx' | 'pdf_text' | 'ocr'
  text: string
  chars: number
  pages: number | null
  ocrModel: string | null
  warnings: string[]
}

export const aiIntentApi = {
  // signal：澄清轮次要能被用户主动取消，也要能被前端超时兜底——模型端无响应时
  // 不能让整张问题卡片永远停在禁用态。
  analyze: (
    input: AnalyzeProjectIntentRequest,
    signal?: AbortSignal,
    options?: AnalysisJobOptions,
  ) =>
    runAnalysisJob<AnalyzeProjectIntentResponse>(
      'intent',
      input as unknown as Record<string, unknown>,
      signal,
      options,
    ),

  /**
   * 流式解释当前澄清问题。只读端点：不推进澄清、不写 ledger，
   * 所以在这里问什么都不会被记成答案。
   */
  /** 长需求整理（超过 8,000 字时）：逐条保留具体事项、标注段落出处；带 liveOutputId 时实时推送。 */
  brief: (input: {
    rawInput: string
    connectionId?: number
    modelId?: number
    liveOutputId?: string
  }) =>
    apiFetch<{ brief: string; rawLength: number }>('/ai/project-intents/brief', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 需求附件读成文字（Word / PDF / 文本 / 图片识别）；只返回文字，不落库。 */
  attachment: (input: {
    fileName: string
    dataBase64: string
    connectionId?: number
    modelId?: number
  }) =>
    apiFetch<RequirementAttachmentResult>('/ai/project-intents/attachment', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  explainStream: async (
    input: ExplainClarificationRequest,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const response = await apiRawFetch('/ai/project-intents/explain', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    })
    if (!response.body) throw new Error('解释流没有返回内容')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let failure: string | null = null

    const handleFrame = (frame: string) => {
      let event = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length === 0) return
      let payload: { text?: string; message?: string }
      try {
        payload = JSON.parse(dataLines.join('\n'))
      } catch {
        return
      }
      if (event === 'explain.delta' && payload.text) onDelta(payload.text)
      if (event === 'explain.failed') failure = payload.message ?? '解释失败，请稍后重试'
    }

    try {
      while (!signal?.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) handleFrame(frame)
      }
      if (buffer.trim()) handleFrame(buffer)
    } finally {
      reader.cancel().catch(() => undefined)
    }
    if (failure) throw new Error(failure)
  },
}

export const aiIntentKeys = {
  all: ['ai-intent'] as const,
  analyze: (organizationId: number | null, rawInput: string) =>
    [...aiIntentKeys.all, 'analyze', organizationId, rawInput] as const,
}
