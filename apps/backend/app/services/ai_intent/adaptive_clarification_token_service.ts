import crypto from 'node:crypto'
import env from '#start/env'
import {
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  type AdaptiveClarificationSession,
} from '@aiproj/types'
import { ValidationException } from '../../exceptions/api_exception.js'

const TOKEN_VERSION = 1
const TOKEN_TTL_MS = 4 * 60 * 60 * 1_000
const MAX_TOKEN_BYTES = 64_000

interface AdaptiveTokenPayload {
  v: typeof TOKEN_VERSION
  organizationId: number
  userId: number
  rawInputHash: string
  session: AdaptiveClarificationSession
  issuedAt: number
  expiresAt: number
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export default class AdaptiveClarificationTokenService {
  private readonly consumedMutationTokens = new Set<string>()
  constructor(
    private readonly secret = String(env.get('APP_KEY')),
    private readonly now: () => number = () => Date.now(),
  ) {}

  issue(input: {
    organizationId: number
    userId: number
    rawInput: string
    session: AdaptiveClarificationSession
  }): string {
    const payload: AdaptiveTokenPayload = {
      v: TOKEN_VERSION,
      organizationId: input.organizationId,
      userId: input.userId,
      rawInputHash: hash(input.rawInput),
      session: input.session,
      issuedAt: this.now(),
      expiresAt: this.now() + TOKEN_TTL_MS,
    }
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const signature = crypto.createHmac('sha256', this.secret).update(encoded).digest('base64url')
    const token = `${encoded}.${signature}`
    if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
      throw new ValidationException('澄清会话超过安全大小上限，请先生成人工复核草案')
    }
    return token
  }

  consume(
    token: string,
    scope: { organizationId: number; userId: number; rawInput: string },
  ): AdaptiveClarificationSession {
    if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) throw this.stale()
    const [encoded, signature, extra] = token.split('.')
    if (!encoded || !signature || extra) throw this.stale()
    const expected = crypto.createHmac('sha256', this.secret).update(encoded).digest('base64url')
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw this.stale()
    }
    try {
      const payload = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as AdaptiveTokenPayload
      if (
        payload.v !== TOKEN_VERSION ||
        payload.organizationId !== scope.organizationId ||
        payload.userId !== scope.userId ||
        payload.rawInputHash !== hash(scope.rawInput) ||
        payload.session?.schemaVersion !== ADAPTIVE_CLARIFICATION_SCHEMA_VERSION ||
        !Number.isInteger(payload.session.round) ||
        !Number.isInteger(payload.session.ledger?.revision) ||
        !Number.isFinite(payload.expiresAt) ||
        payload.expiresAt <= this.now()
      ) {
        throw this.stale()
      }
      return payload.session
    } catch (error) {
      if (error instanceof ValidationException) throw error
      throw this.stale()
    }
  }

  consumeForMutation(
    token: string,
    scope: { organizationId: number; userId: number; rawInput: string },
  ): AdaptiveClarificationSession {
    const key = hash(token)
    if (this.consumedMutationTokens.has(key)) throw this.stale()
    const session = this.consume(token, scope)
    this.consumedMutationTokens.add(key)
    // Bound the per-process replay guard. Old entries are also protected by token expiry.
    if (this.consumedMutationTokens.size > 5_000) {
      const oldest = this.consumedMutationTokens.values().next().value
      if (oldest) this.consumedMutationTokens.delete(oldest)
    }
    return session
  }

  /** 只在本次已消费但没有发布新会话的失败路径调用。 */
  releaseFailedMutation(token: string): void {
    this.consumedMutationTokens.delete(hash(token))
  }

  private stale(): ValidationException {
    return new ValidationException('QUESTION_PLAN_STALE：澄清内容已更新，请重新载入当前问题')
  }
}
