import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnalysisJobService,
  ANALYSIS_JOB_TIMEOUT_MS,
  type AnalysisJobOwner,
  type AnalysisJobRow,
  type AnalysisJobRepository,
} from '#services/ai_analysis/analysis_job_service'
import type { AiAnalysisJobState } from '@aiproj/types'

class MemoryRepository implements AnalysisJobRepository {
  rows = new Map<string, AnalysisJobRow>()
  async find(owner: AnalysisJobOwner, id: string) {
    const row = this.rows.get(id)
    return row?.organizationId === owner.organizationId && row.userId === owner.userId
      ? structuredClone(row)
      : null
  }
  async findRequest(owner: AnalysisJobOwner, key: string) {
    for (const row of this.rows.values())
      if (
        row.organizationId === owner.organizationId &&
        row.userId === owner.userId &&
        row.requestKey === key
      )
        return structuredClone(row)
    return null
  }
  async insert(row: AnalysisJobRow) {
    const existing = await this.findRequest(row, row.requestKey)
    if (existing) return existing
    // 同步唯一键判定，模拟数据库原子插入。
    for (const saved of this.rows.values())
      if (
        saved.organizationId === row.organizationId &&
        saved.userId === row.userId &&
        saved.requestKey === row.requestKey
      )
        return structuredClone(saved)
    this.rows.set(row.id, structuredClone(row))
    return structuredClone(row)
  }
  async update(row: AnalysisJobRow, state: AiAnalysisJobState, expiredBefore?: number) {
    const existing = this.rows.get(row.id)
    if (
      !existing ||
      existing.state !== state ||
      (expiredBefore !== undefined && existing.leaseUntil >= expiredBefore)
    )
      return false
    this.rows.set(row.id, structuredClone(row))
    return true
  }
  async prune(now: number, owner: AnalysisJobOwner) {
    for (const [id, row] of this.rows)
      if (
        row.organizationId === owner.organizationId &&
        row.userId === owner.userId &&
        row.expiresAt <= now
      )
        this.rows.delete(id)
  }
}

const owner = { organizationId: 1, userId: 2 }
const base = {
  owner,
  requestKey: 'request-one',
  kind: 'intent' as const,
  input: { rawInput: '我想筹办一场演唱会活动', modelId: 3 },
  liveOutputId: 'live-one',
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
afterEach(() => vi.useRealTimers())

describe('后台分析任务', () => {
  it('提交立即返回，长任务在响应后继续并保存结果', async () => {
    const repo = new MemoryRepository()
    const service = new AnalysisJobService(repo)
    let finish!: (value: unknown) => void
    const run = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const job = await service.submit({ ...base, run })
    await flush()
    expect(job.id).toBeTruthy()
    const running = await service.show(owner, job.id)
    expect(running.state).toBe('running')
    finish({ branch: 'clarify' })
    await flush()
    expect(await service.show(owner, job.id)).toMatchObject({
      state: 'completed',
      result: { branch: 'clarify' },
    })
  })

  it('并发重复提交及丢失响应的重放只执行一次模型', async () => {
    const repo = new MemoryRepository()
    const service = new AnalysisJobService(repo)
    const run = vi.fn(async () => ({ answer: 'ok' }))
    const jobs = await Promise.all([
      service.submit({ ...base, run }),
      service.submit({ ...base, run }),
    ])
    await flush()
    expect(jobs[0]!.id).toBe(jobs[1]!.id)
    expect(run).toHaveBeenCalledTimes(1)
    const replay = await service.submit({ ...base, run })
    expect(replay.result).toEqual({ answer: 'ok' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('服务实例重建后可恢复已完成结果，不调用模型', async () => {
    const repo = new MemoryRepository()
    const first = new AnalysisJobService(repo)
    await first.submit({ ...base, run: async () => ({ answered: 3 }) })
    await flush()
    const run = vi.fn(async () => null)
    const restored = await new AnalysisJobService(repo).submit({ ...base, run })
    expect(restored.result).toEqual({
      answered: 3,
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('任务 ID 不能跨组织或跨用户读取', async () => {
    const service = new AnalysisJobService(new MemoryRepository())
    const job = await service.submit({ ...base, run: async () => 'ok' })
    await expect(service.show({ ...owner, organizationId: 9 }, job.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    })
    await expect(service.show({ ...owner, userId: 9 }, job.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    })
    await flush()
  })

  it('同一请求编号不能被用于不同模型或不同输入', async () => {
    const service = new AnalysisJobService(new MemoryRepository())
    await service.submit({ ...base, run: async () => 'ok' })
    await flush()
    await expect(
      service.submit({
        ...base,
        input: { rawInput: '另一个项目', modelId: 4 },
        run: async () => 'changed',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('失败持久化安全错误，不把 provider secret 或原输出交给页面', async () => {
    const service = new AnalysisJobService(new MemoryRepository())
    const run = vi.fn(async () => {
      throw new Error('secret provider response')
    })
    const job = await service.submit({ ...base, run })
    await flush()
    const saved = await service.show(owner, job.id)
    expect(saved).toMatchObject({ state: 'failed', error: { code: 'AI_SERVICE_ERROR' } })
    expect(JSON.stringify(saved)).not.toContain('secret')
    await service.submit({ ...base, run })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('运行任务保持租约；超过任务上限会中止模型调用', async () => {
    vi.useFakeTimers()
    const service = new AnalysisJobService(new MemoryRepository())
    let signal!: AbortSignal
    const job = await service.submit({
      ...base,
      run: (arg) => {
        signal = arg
        return new Promise((_, reject) =>
          arg.addEventListener('abort', () => reject(arg.reason), { once: true }),
        )
      },
    })
    await vi.advanceTimersByTimeAsync(130_000)
    const running = await service.show(owner, job.id)
    expect(running.state).toBe('running')
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(ANALYSIS_JOB_TIMEOUT_MS - 130_000)
    expect(signal.aborted).toBe(true)
    expect(await service.show(owner, job.id)).toMatchObject({
      state: 'failed',
      error: { code: 'AI_ANALYSIS_TIMEOUT' },
    })
  })

  it('丢失运行租约时明确中断，不自动重新调用模型', async () => {
    const repo = new MemoryRepository()
    let now = Date.now()
    const service = new AnalysisJobService(repo, () => now)
    const job = await service.submit({ ...base, run: async () => 'done' })
    await flush()
    const saved = repo.rows.get(job.id)!
    repo.rows.set(job.id, { ...saved, state: 'running', result: null })
    now += 61_000
    expect(await service.show(owner, job.id)).toMatchObject({
      state: 'failed',
      error: { code: 'AI_ANALYSIS_INTERRUPTED' },
    })
  })

  it('过期结果不可恢复，要求重新分析', async () => {
    const repo = new MemoryRepository()
    let now = Date.now()
    const service = new AnalysisJobService(repo, () => now)
    const job = await service.submit({ ...base, run: async () => 'ok' })
    await flush()
    now = job.expiresAt + 1
    await expect(service.show(owner, job.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
  })
})
