import { QueryClient } from '@tanstack/react-query'
import type { AiAnalysisJob, AiAnalysisJobKind } from '@aiproj/types'
import { apiFetch, apiErrorMessage } from '@/lib/api-client'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

interface JobHandle {
  fingerprint: string
  requestKey: string
  jobId?: string
  liveOutputId?: string | null
  expiresAt: number
}

export interface AnalysisJobOptions {
  queryClient?: QueryClient
  onProgress?: (job: AiAnalysisJob) => void
}

const STORAGE_PREFIX = 'aiproj:analysis-job:'
const RETENTION_MS = 4 * 60 * 60_000
const REQUEST_TIMEOUT_MS = 20_000

function scope() {
  const state = useAuthStore.getState()
  return `${state.user?.id ?? 'anonymous'}:${selectEffectiveOrganizationId(state) ?? 'none'}`
}

function readHandle(key: string): JobHandle | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as JobHandle | null
    if (value && value.expiresAt > Date.now()) return value
  } catch {
    /* 存储不可用仍可完成当前任务 */
  }
  return null
}

function saveHandle(key: string, value: JobHandle | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value))
    else sessionStorage.removeItem(key)
  } catch {
    /* 存储不可用不影响当前任务 */
  }
}

/** 用户明确重新开始时才丢弃恢复句柄，普通重试保留。 */
export function clearAnalysisJobHandles() {
  for (const kind of ['intent', 'understanding'])
    saveHandle(`${STORAGE_PREFIX}${scope()}:${kind}`, null)
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    )
  return value
}

async function fingerprint(input: Record<string, unknown>) {
  const { liveOutputId: _live, adaptiveSession: _session, ...identity } = input
  void _live
  void _session
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical(identity))),
  )
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 1_000)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** 提交是短请求；查询经 TanStack Query，断线只重查同一任务，不重复提交模型调用。 */
export async function runAnalysisJob<T>(
  kind: AiAnalysisJobKind,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  options: AnalysisJobOptions = {},
): Promise<T> {
  const owner = scope()
  const key = `${STORAGE_PREFIX}${owner}:${kind}`
  const hash = await fingerprint(input)
  const existing = readHandle(key)
  const handle: JobHandle =
    existing?.fingerprint === hash
      ? existing
      : {
          fingerprint: hash,
          requestKey: crypto.randomUUID(),
          expiresAt: Date.now() + RETENTION_MS,
        }
  saveHandle(key, handle)
  const lifetime = AbortSignal.timeout(25 * 60_000)
  const waiting = signal ? AbortSignal.any([signal, lifetime]) : lifetime
  const assertScope = () => {
    waiting.throwIfAborted()
    if (scope() !== owner) throw new Error('组织或账号已切换，本次分析等待已停止。')
  }
  const client = options.queryClient ?? new QueryClient()
  const path =
    kind === 'intent' ? '/ai/project-intents/analyze/jobs' : '/ai/project-drafts/understanding/jobs'
  const request = (url: string, init: RequestInit = {}) =>
    apiFetch<AiAnalysisJob<T>>(url, {
      ...init,
      signal: AbortSignal.any([waiting, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    })
  const queryKey = ['ai-analysis-job', owner, kind, handle.requestKey] as const
  let networkFailures = 0
  let retryDelay = false
  try {
    while (true) {
      assertScope()
      if (retryDelay) await waitForPoll(waiting)
      let job: AiAnalysisJob<T>
      try {
        job = await client.fetchQuery({
          queryKey,
          staleTime: 0,
          retry: false,
          gcTime: 0,
          queryFn: () =>
            handle.jobId
              ? request(`/ai/analysis-jobs/${encodeURIComponent(handle.jobId)}`)
              : request(path, {
                  method: 'POST',
                  body: JSON.stringify({ ...input, requestKey: handle.requestKey }),
                }),
        })
        networkFailures = 0
      } catch (failure) {
        assertScope()
        const status = (failure as { status?: number })?.status
        if (status === 404) saveHandle(key, null)
        if (status && status < 500 && status !== 429) throw failure
        // 提交响应丢失时用同一 requestKey 重放；已经有 jobId 时只重查状态。
        if (++networkFailures > 5)
          throw new Error(
            `${apiErrorMessage(failure, '进度连接暂时中断')} 后台任务可能仍在运行；重试会找回同一任务。`,
            { cause: failure },
          )
        retryDelay = true
        continue
      }
      assertScope()
      handle.jobId = job.id
      handle.liveOutputId = job.liveOutputId
      handle.expiresAt = job.expiresAt
      saveHandle(key, handle)
      options.onProgress?.(job)
      if (job.state === 'completed') {
        if (job.result === undefined) throw new Error('分析结果缺失，请重新查询。')
        return job.result
      }
      if (job.state === 'failed') {
        // 只有服务端明确终止后，下次人工重试才创建新任务。
        saveHandle(key, null)
        throw {
          status: 502,
          code: job.error?.code ?? 'AI_SERVICE_ERROR',
          message: job.error?.message ?? '模型分析未能完成，请重试。',
        }
      }
      retryDelay = true
    }
  } finally {
    client.removeQueries({ queryKey, exact: true })
  }
}
