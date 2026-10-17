/**
 * 实时输出频道：意图分析、项目理解这类「一次性返回 JSON」的请求，
 * 在等待期间把模型逐块吐出的文字推给前端（经 GET /ai/live-output/:id 的 SSE 订阅）。
 *
 * - 只在进程内存里，不落库、不进审计；请求结束即关闭，闲置 10 分钟清理；
 * - 频道编号由前端生成（UUID），首个触达者（订阅或请求）即绑定归属（组织 + 用户），
 *   其他人读写都会被拒绝；
 * - 每条片段带调用编号与步骤名：一次分析可能串行调用多次模型（理解 → 修复 → 补选项），
 *   前端按调用分道展示，与草案生成的 generation.output 同一形状。
 */
import type { GenerateOptions, GenerateResult } from '#services/ai_m0/gateway'
import { LIVE_OUTPUT_FLUSH_CHARS, createOutputFlusher } from '#services/ai_draft/output_flusher'

export interface LiveOutputPiece {
  text: string
  callId: string
  label: string
  done?: boolean
  /** reasoning = 推理模型的思考过程；缺省为正文。 */
  kind?: 'reasoning'
  /** 这次调用的模型名（开道时带上，前端显示「某某模型正在思考」）。 */
  model?: string
}

interface Channel {
  owner: string
  pieces: LiveOutputPiece[]
  /** 因缓冲上限被丢弃的片段数（读偏移按「总序号」计）。 */
  dropped: number
  closed: boolean
  touchedAt: number
  waiters: Set<() => void>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
/** 每个频道最多缓冲的片段数（约 24 字一片，≈ 10 万字）。 */
const PIECE_LIMIT = 4_000
const IDLE_TTL_MS = 10 * 60_000

export function isLiveOutputId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export class LiveOutputHub {
  #channels = new Map<string, Channel>()

  /** 取得（必要时创建）频道；归属不符返回 null。 */
  claim(id: string, owner: string): Channel | null {
    this.#sweep()
    const existing = this.#channels.get(id)
    if (existing) {
      if (existing.owner !== owner) return null
      existing.touchedAt = Date.now()
      return existing
    }
    const channel: Channel = {
      owner,
      pieces: [],
      dropped: 0,
      closed: false,
      touchedAt: Date.now(),
      waiters: new Set(),
    }
    this.#channels.set(id, channel)
    return channel
  }

  push(id: string, piece: LiveOutputPiece) {
    const channel = this.#channels.get(id)
    if (!channel || channel.closed) return
    channel.pieces.push(piece)
    if (channel.pieces.length > PIECE_LIMIT) {
      const surplus = channel.pieces.length - PIECE_LIMIT
      channel.pieces.splice(0, surplus)
      channel.dropped += surplus
    }
    channel.touchedAt = Date.now()
    this.#wake(channel)
  }

  close(id: string) {
    const channel = this.#channels.get(id)
    if (!channel) return
    channel.closed = true
    channel.touchedAt = Date.now()
    this.#wake(channel)
  }

  /** 读取 from（总序号）之后的片段。 */
  read(id: string, owner: string, from: number) {
    const channel = this.#channels.get(id)
    if (!channel || channel.owner !== owner) return null
    const start = Math.max(0, from - channel.dropped)
    return {
      pieces: channel.pieces.slice(start),
      next: channel.dropped + channel.pieces.length,
      closed: channel.closed,
    }
  }

  /** 等到有新片段、频道关闭或超时。 */
  waitForChange(id: string, timeoutMs: number): Promise<void> {
    const channel = this.#channels.get(id)
    if (!channel || channel.closed) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        channel.waiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      channel.waiters.add(done)
    })
  }

  #wake(channel: Channel) {
    for (const waiter of [...channel.waiters]) waiter()
  }

  #sweep() {
    const now = Date.now()
    for (const [id, channel] of this.#channels) {
      if (now - channel.touchedAt > IDLE_TTL_MS) {
        channel.closed = true
        this.#wake(channel)
        this.#channels.delete(id)
      }
    }
  }
}

export const liveOutputHub = new LiveOutputHub()

export function liveOutputOwner(organizationId: number, userId: number) {
  return `${organizationId}:${userId}`
}

/**
 * 把一次模型调用的输出接到频道：开始即占一条道（空文本），逐块推送，结束标记 done。
 * 返回值与异常原样透传，频道只是旁路观察。
 */
export async function streamCallToLiveOutput<T>(
  id: string | null,
  label: string,
  callId: string,
  run: (onText: (text: string) => void, onReasoning: (text: string) => void) => Promise<T>,
  model?: string | null,
): Promise<T> {
  if (!id)
    return run(
      () => {},
      () => {},
    )
  const lane = { callId, label }
  const flusher = createOutputFlusher(LIVE_OUTPUT_FLUSH_CHARS)
  const reasoningFlusher = createOutputFlusher(LIVE_OUTPUT_FLUSH_CHARS)
  const emit = (pieces: string[], done = false) => {
    for (const text of pieces) liveOutputHub.push(id, { text, ...lane })
    if (done) liveOutputHub.push(id, { text: '', ...lane, done: true })
  }
  const emitReasoning = (pieces: string[]) => {
    for (const text of pieces) liveOutputHub.push(id, { text, ...lane, kind: 'reasoning' })
  }
  liveOutputHub.push(id, { text: '', ...lane, ...(model ? { model } : {}) })
  try {
    return await run(
      (text) => emit(flusher.push(text)),
      (text) => emitReasoning(reasoningFlusher.push(text)),
    )
  } finally {
    emitReasoning(reasoningFlusher.flush())
    emit(flusher.flush(), true)
  }
}

/** 包一层 generate()：每次调用自动成为频道里的一条道，步骤名取 options.sentence。 */
export function liveOutputGateway<
  G extends { generate(options: GenerateOptions): Promise<GenerateResult> },
>(gateway: G, id: string | null): G {
  if (!id) return gateway
  let seq = 0
  return new Proxy(gateway, {
    get(target, property) {
      if (property !== 'generate') {
        // AIGateway 用了私有字段（#adapter）：方法必须绑回原对象，经 Proxy 调用会读不到私有字段。
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
      const model = (target as { model?: unknown }).model
      return (options: GenerateOptions) =>
        streamCallToLiveOutput(
          id,
          options.sentence || '模型调用',
          String(++seq),
          (onText, onReasoning) => target.generate({ ...options, onText, onReasoning }),
          typeof model === 'string' ? model : null,
        )
    },
  })
}
