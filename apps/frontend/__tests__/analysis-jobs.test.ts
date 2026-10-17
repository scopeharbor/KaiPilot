import { createHash, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAnalysisJob } from '@/lib/api/analysis-jobs'
import { apiFetch } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
  apiErrorMessage: (error: { message?: string }, fallback: string) => error?.message ?? fallback,
}))

const fetchMock = vi.mocked(apiFetch)
const input = { rawInput: '我想筹办一场演唱会活动', modelId: 3, liveOutputId: 'first-live' }
function job(state: 'running' | 'completed' | 'failed', result?: unknown) {
  return {
    id: 'job-one',
    kind: 'intent',
    state,
    liveOutputId: 'first-live',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 60 * 60_000,
    progress: '分析中',
    ...(result ? { result } : {}),
    ...(state === 'failed'
      ? { error: { code: 'AI_SERVICE_ERROR', message: '模型暂时不可用' } }
      : {}),
  }
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  fetchMock.mockReset()
  useAuthStore.setState({ user: { id: 1, organizationId: 2 } as never, currentOrganizationId: 2 })
  vi.stubGlobal('crypto', {
    randomUUID,
    subtle: {
      digest: async (_algorithm: string, data: Uint8Array) =>
        Uint8Array.from(createHash('sha256').update(data).digest()).buffer,
    },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('后台分析前端查询与恢复', () => {
  it('短提交之后仅查询任务，取得最终结果', async () => {
    fetchMock
      .mockResolvedValueOnce(job('running'))
      .mockResolvedValueOnce(job('completed', { branch: 'clarify' }))
    const onProgress = vi.fn()
    const result = runAnalysisJob('intent', input, undefined, { onProgress })
    await flush()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/ai/project-intents/analyze/jobs')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toEqual({ branch: 'clarify' })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/ai/analysis-jobs/job-one')
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ liveOutputId: 'first-live' }))
  })

  it('提交响应丢失时同一请求编号重放，避免重复调用', async () => {
    fetchMock
      .mockRejectedValueOnce({ status: 524, message: '网关等待超时' })
      .mockResolvedValueOnce(job('completed', { ok: true }))
    const result = runAnalysisJob('intent', input)
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toEqual({ ok: true })
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    expect(bodies[0].requestKey).toBe(bodies[1].requestKey)
  })

  it('查询暂时失败只重查状态，不创建新任务', async () => {
    fetchMock
      .mockResolvedValueOnce(job('running'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(job('completed', { ok: true }))
    const result = runAnalysisJob('intent', input)
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await result).toEqual({ ok: true })
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
  })

  it('停止等待后的重试找回同一任务及原实时输出频道', async () => {
    fetchMock.mockResolvedValueOnce(job('running'))
    const controller = new AbortController()
    const result = runAnalysisJob('intent', input, controller.signal)
    const rejected = expect(result).rejects.toBeDefined()
    await flush()
    controller.abort()
    await rejected
    fetchMock.mockResolvedValueOnce(job('completed', { answered: 3 }))
    const onProgress = vi.fn()
    expect(
      await runAnalysisJob('intent', { ...input, liveOutputId: 'new-live' }, undefined, {
        onProgress,
      }),
    ).toEqual({ answered: 3 })
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/ai/analysis-jobs/job-one')
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ liveOutputId: 'first-live' }))
  })

  it('已完成结果重试直接恢复，不再次 POST', async () => {
    fetchMock.mockResolvedValue(job('completed', { ok: true }))
    await runAnalysisJob('intent', input)
    await runAnalysisJob('intent', input)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/ai/project-intents/analyze/jobs',
      '/ai/analysis-jobs/job-one',
    ])
  })

  it('服务端明确失败后，下一次人工重试使用新请求编号', async () => {
    fetchMock.mockResolvedValueOnce(job('failed'))
    await expect(runAnalysisJob('intent', input)).rejects.toMatchObject({
      message: '模型暂时不可用',
    })
    fetchMock.mockResolvedValueOnce(job('completed', { ok: true }))
    await runAnalysisJob('intent', input)
    const keys = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).requestKey)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('改变模型创建新的分析任务', async () => {
    fetchMock.mockResolvedValue(job('completed', { ok: true }))
    await runAnalysisJob('intent', input)
    await runAnalysisJob('intent', { ...input, modelId: 4 })
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(2)
  })

  it('切换组织后不读取原组织的恢复句柄', async () => {
    fetchMock.mockResolvedValue(job('completed', { ok: true }))
    await runAnalysisJob('intent', input)
    useAuthStore.setState({ currentOrganizationId: 7 })
    await runAnalysisJob('intent', input)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(2)
  })

  it('4xx 权限失败不自动重试或切回同步接口', async () => {
    fetchMock.mockRejectedValueOnce({ status: 403, message: '无权分析' })
    await expect(runAnalysisJob('intent', input)).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
