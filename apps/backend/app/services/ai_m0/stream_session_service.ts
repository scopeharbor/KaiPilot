import { randomUUID } from 'node:crypto'
import ApiException from '#exceptions/api_exception'
import type { AiM0ErrorKind } from '@aiproj/types'
import type { AIGateway, GenerateOptions } from './gateway.ts'

export interface StreamSessionEvent {
  seq: number
  event: 'chunk' | 'error' | 'done'
  data: Record<string, unknown>
}

interface StreamSession {
  id: string
  events: StreamSessionEvent[]
  complete: boolean
  expiresAt: number
  waiters: Set<() => void>
}

interface StartOptions {
  gateway: AIGateway
  generate: GenerateOptions
  finish: (value: {
    rawText: string
    triggeredErrors: AiM0ErrorKind[]
    firstTokenMs: number
    totalMs: number
  }) => Record<string, unknown>
}

const SESSION_TTL_MS = 15 * 60 * 1000
const MAX_SESSIONS = 20

export class AiM0StreamSessionService {
  private sessions = new Map<string, StreamSession>()

  start(options: StartOptions): string {
    this.cleanup()
    const id = randomUUID()
    const session: StreamSession = {
      id,
      events: [],
      complete: false,
      expiresAt: Date.now() + SESSION_TTL_MS,
      waiters: new Set(),
    }
    this.sessions.set(id, session)
    void this.consume(session, options)
    return id
  }

  read(streamId: string, afterSeq: number): StreamSessionEvent[] {
    this.cleanup()
    const session = this.sessions.get(streamId)
    if (!session) {
      throw new ApiException('流式会话已过期，请开始新会话', {
        status: 410,
        code: 'STREAM_EXPIRED',
      })
    }
    return session.events.filter((event) => event.seq > afterSeq)
  }

  isComplete(streamId: string): boolean {
    return this.sessions.get(streamId)?.complete ?? true
  }

  async waitForChange(streamId: string, timeoutMs = 15_000): Promise<void> {
    const session = this.sessions.get(streamId)
    if (!session || session.complete) return
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        session.waiters.delete(finish)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      session.waiters.add(finish)
    })
  }

  clearForTests() {
    this.sessions.clear()
  }

  private append(
    session: StreamSession,
    event: StreamSessionEvent['event'],
    data: Record<string, unknown>,
  ) {
    session.events.push({ seq: session.events.length + 1, event, data })
    for (const waiter of session.waiters) waiter()
    session.waiters.clear()
  }

  private async consume(session: StreamSession, options: StartOptions) {
    const startedAt = performance.now()
    let firstTokenMs = 0
    let sawFirstToken = false
    const parts: string[] = []
    const triggeredErrors: AiM0ErrorKind[] = []
    try {
      for await (const chunk of options.gateway.stream(options.generate)) {
        if (chunk.kind === 'text' && chunk.text) {
          if (!sawFirstToken) {
            firstTokenMs = performance.now() - startedAt
            sawFirstToken = true
          }
          parts.push(chunk.text)
          this.append(session, 'chunk', { text: chunk.text })
        } else if (chunk.kind === 'error') {
          if (chunk.errorKind) triggeredErrors.push(chunk.errorKind)
          this.append(session, 'error', {
            errorKind: chunk.errorKind,
            errorMessage: chunk.errorMessage,
          })
        }
      }
      this.append(
        session,
        'done',
        options.finish({
          rawText: parts.join(''),
          triggeredErrors,
          firstTokenMs,
          totalMs: performance.now() - startedAt,
        }),
      )
    } catch (error) {
      this.append(session, 'error', {
        errorKind: 'sse_interrupted',
        errorMessage: (error as Error).message,
      })
    } finally {
      session.complete = true
      session.expiresAt = Date.now() + SESSION_TTL_MS
      for (const waiter of session.waiters) waiter()
      session.waiters.clear()
    }
  }

  private cleanup() {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id)
    }
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value as string | undefined
      if (!oldest) break
      this.sessions.delete(oldest)
    }
  }
}

/** 进程内 dev-only 注册表；跨请求共享，后端重启后明确过期。 */
export const aiM0StreamSessions = new AiM0StreamSessionService()
