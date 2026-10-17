import { createHash, randomUUID } from 'node:crypto'
import type { AiAnalysisJob, AiAnalysisJobKind, AiAnalysisJobState } from '@aiproj/types'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'

export interface AnalysisJobOwner {
  organizationId: number
  userId: number
}
export interface AnalysisJobRow extends AnalysisJobOwner {
  id: string
  requestKey: string
  inputHash: string
  kind: AiAnalysisJobKind
  state: AiAnalysisJobState
  liveOutputId: string | null
  result: unknown | null
  error: { code: string; message: string } | null
  createdAt: number
  updatedAt: number
  leaseUntil: number
  expiresAt: number
}

export interface AnalysisJobRepository {
  find(owner: AnalysisJobOwner, id: string): Promise<AnalysisJobRow | null>
  findRequest(owner: AnalysisJobOwner, requestKey: string): Promise<AnalysisJobRow | null>
  /** 原子唯一键插入；并发请求返回同一任务。 */
  insert(row: AnalysisJobRow): Promise<AnalysisJobRow>
  update(
    row: AnalysisJobRow,
    expectedState: AiAnalysisJobState,
    expiredBefore?: number,
  ): Promise<boolean>
  prune(now: number, owner: AnalysisJobOwner): Promise<void>
}

/** 对象键排序，运输字段不影响任务身份；输入内容绝不进入日志。 */
export function analysisInputHash(input: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      )
    }
    return value
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(input)))
    .digest('hex')
}

const LEASE_MS = 60_000
export const ANALYSIS_JOB_TTL_MS = 4 * 60 * 60_000
export const ANALYSIS_JOB_TIMEOUT_MS = 25 * 60_000

/** HTTP 断开只停止前端等待，后台任务继续；结果持久化，任务丢失明确失败、不自动重复计费。 */
export class AnalysisJobService {
  constructor(
    private readonly repository: AnalysisJobRepository,
    private readonly now: () => number = Date.now,
    private readonly reportFailure: (error: unknown, jobId: string) => void = () => {},
  ) {}

  async submit<T>(args: {
    owner: AnalysisJobOwner
    requestKey: string
    kind: AiAnalysisJobKind
    input: unknown
    liveOutputId: string | null
    run: (signal: AbortSignal) => Promise<T>
  }): Promise<AiAnalysisJob<T>> {
    await this.repository.prune(this.now(), args.owner)
    const hash = analysisInputHash(args.input)
    const previous = await this.repository.findRequest(args.owner, args.requestKey)
    if (previous) {
      if (previous.inputHash !== hash || previous.kind !== args.kind) {
        throw new ValidationException('任务输入已变化，请使用新的请求编号。')
      }
      return this.show<T>(args.owner, previous.id)
    }
    const now = this.now()
    const candidate: AnalysisJobRow = {
      ...args.owner,
      id: randomUUID(),
      requestKey: args.requestKey,
      inputHash: hash,
      kind: args.kind,
      state: 'queued',
      liveOutputId: args.liveOutputId,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      leaseUntil: now + LEASE_MS,
      expiresAt: now + ANALYSIS_JOB_TTL_MS,
    }
    const row = await this.repository.insert(candidate)
    if (row.inputHash !== hash || row.kind !== args.kind) {
      throw new ValidationException('任务输入已变化，请使用新的请求编号。')
    }
    if (row.id === candidate.id) {
      // 不等待模型。捕获所有 rejection，避免后台失败成为 unhandled rejection。
      void this.execute(row, args.run).catch((error) => this.reportFailure(error, row.id))
    }
    return this.view<T>(row)
  }

  async show<T>(owner: AnalysisJobOwner, id: string): Promise<AiAnalysisJob<T>> {
    const row = await this.repository.find(owner, id)
    if (!row || row.expiresAt <= this.now())
      throw new ResourceNotFoundException('分析任务不存在或已过期，请重新分析。')
    if ((row.state === 'running' || row.state === 'queued') && row.leaseUntil < this.now()) {
      const previousState = row.state
      row.state = 'failed'
      row.updatedAt = this.now()
      row.error = {
        code: 'AI_ANALYSIS_INTERRUPTED',
        message: '后台分析已中断，输入与已答内容仍保留。请重试分析。',
      }
      await this.repository.update(row, previousState, this.now())
      // 竞争中另一进程可能刚完成，重新取权威状态。
      return this.view<T>((await this.repository.find(owner, id)) ?? row)
    }
    return this.view<T>(row)
  }

  private view<T>(row: AnalysisJobRow): AiAnalysisJob<T> {
    return {
      id: row.id,
      kind: row.kind,
      state: row.state,
      liveOutputId: row.liveOutputId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
      progress:
        row.state === 'queued'
          ? '已提交后台分析'
          : row.state === 'running'
            ? row.kind === 'intent'
              ? '正在理解项目并准备问题'
              : '正在梳理项目理解'
            : row.state === 'completed'
              ? '分析已完成'
              : '分析未能完成',
      ...(row.state === 'completed' ? { result: row.result as T } : {}),
      ...(row.error ? { error: row.error } : {}),
    }
  }

  private async execute<T>(row: AnalysisJobRow, run: (signal: AbortSignal) => Promise<T>) {
    row.state = 'running'
    row.updatedAt = this.now()
    if (!(await this.repository.update(row, 'queued'))) return
    const controller = new AbortController()
    let heartbeatInFlight = false
    const heartbeat = setInterval(() => {
      if (heartbeatInFlight || controller.signal.aborted) return
      heartbeatInFlight = true
      const beat = { ...row, updatedAt: this.now(), leaseUntil: this.now() + LEASE_MS }
      void this.repository
        .update(beat, 'running')
        .then((updated) => {
          if (!updated) controller.abort(new Error('AI_ANALYSIS_INTERRUPTED'))
        })
        .catch((error) => {
          controller.abort(error)
        })
        .finally(() => {
          heartbeatInFlight = false
        })
    }, 10_000)
    heartbeat.unref?.()
    const timeout = setTimeout(
      () => controller.abort(new Error('AI_ANALYSIS_TIMEOUT')),
      ANALYSIS_JOB_TIMEOUT_MS,
    )
    timeout.unref?.()
    let rejectAbort: (reason?: unknown) => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject
    })
    const onAbort = () => rejectAbort(controller.signal.reason)
    controller.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const result = await Promise.race([run(controller.signal), aborted])
      controller.signal.throwIfAborted()
      clearInterval(heartbeat)
      row.result = result
      row.state = 'completed'
      row.updatedAt = this.now()
      await this.repository.update(row, 'running')
    } catch (error) {
      clearInterval(heartbeat)
      this.reportFailure(error, row.id)
      const failure = error as { code?: unknown; message?: unknown }
      row.state = 'failed'
      row.updatedAt = this.now()
      row.error = controller.signal.aborted
        ? {
            code: 'AI_ANALYSIS_TIMEOUT',
            message: '后台分析达到等待上限或已中断，输入与已答内容仍保留。请重试。',
          }
        : {
            code: typeof failure?.code === 'string' ? failure.code : 'AI_SERVICE_ERROR',
            message:
              failure?.code === 'VALIDATION_ERROR' || failure?.code === 'PERMISSION_DENIED'
                ? String(failure.message)
                : '模型分析未能完成，输入与已答内容仍保留。请重试，或切换模型后分析。',
          }
      await this.repository.update(row, 'running')
    } finally {
      clearInterval(heartbeat)
      clearTimeout(timeout)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }
}
