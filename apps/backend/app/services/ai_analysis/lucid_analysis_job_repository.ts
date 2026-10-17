import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import type { AiAnalysisJobState } from '@aiproj/types'
import {
  AnalysisJobService,
  type AnalysisJobOwner,
  type AnalysisJobRepository,
  type AnalysisJobRow,
} from './analysis_job_service.js'

const TABLE = 'ai_analysis_jobs'

/** 结果可能含签名澄清会话，使用 APP_KEY 派生的独立用途密钥加密，不存原请求/模型原输出。 */
function resultKey() {
  return createHash('sha256')
    .update(`ai-analysis-job:${String(env.get('APP_KEY'))}`)
    .digest()
}

function seal(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', resultKey(), iv)
  const content = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), content].map((part) => part.toString('base64')).join('.')
}

function open(value: string): unknown {
  const [iv, tag, content] = value.split('.').map((part) => Buffer.from(part, 'base64'))
  const cipher = createDecipheriv('aes-256-gcm', resultKey(), iv)
  cipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([cipher.update(content), cipher.final()]).toString('utf8'))
}

function decode(row: Record<string, unknown>): AnalysisJobRow {
  return {
    id: String(row.id),
    organizationId: Number(row.organization_id),
    userId: Number(row.user_id),
    requestKey: String(row.request_key),
    inputHash: String(row.input_hash),
    kind: row.kind as AnalysisJobRow['kind'],
    state: row.state as AiAnalysisJobState,
    liveOutputId: row.live_output_id ? String(row.live_output_id) : null,
    result: row.result_encrypted ? open(String(row.result_encrypted)) : null,
    error: row.error_code
      ? { code: String(row.error_code), message: String(row.error_message) }
      : null,
    createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms),
    leaseUntil: Number(row.lease_until_ms),
    expiresAt: Number(row.expires_at_ms),
  }
}

export class LucidAnalysisJobRepository implements AnalysisJobRepository {
  private scope(owner: AnalysisJobOwner) {
    return db
      .from(TABLE)
      .where('organization_id', owner.organizationId)
      .where('user_id', owner.userId)
  }

  async find(owner: AnalysisJobOwner, id: string) {
    const row = await this.scope(owner).where('id', id).first()
    return row ? decode(row) : null
  }

  async findRequest(owner: AnalysisJobOwner, requestKey: string) {
    const row = await this.scope(owner).where('request_key', requestKey).first()
    return row ? decode(row) : null
  }

  async insert(row: AnalysisJobRow) {
    await db
      .table(TABLE)
      .insert({
        id: row.id,
        organization_id: row.organizationId,
        user_id: row.userId,
        request_key: row.requestKey,
        input_hash: row.inputHash,
        kind: row.kind,
        state: row.state,
        live_output_id: row.liveOutputId,
        created_at_ms: row.createdAt,
        updated_at_ms: row.updatedAt,
        lease_until_ms: row.leaseUntil,
        expires_at_ms: row.expiresAt,
      })
      .onConflict(['organization_id', 'user_id', 'request_key'])
      .ignore()
    const saved = await this.findRequest(row, row.requestKey)
    if (!saved) throw new Error('AI analysis task could not be saved')
    return saved
  }

  async update(row: AnalysisJobRow, expectedState: AiAnalysisJobState, expiredBefore?: number) {
    const query = this.scope(row).where('id', row.id).where('state', expectedState)
    if (expiredBefore !== undefined) query.where('lease_until_ms', '<', expiredBefore)
    const changed = await query.update({
      state: row.state,
      updated_at_ms: row.updatedAt,
      lease_until_ms: row.leaseUntil,
      result_encrypted: row.result === null ? null : seal(row.result),
      error_code: row.error?.code ?? null,
      error_message: row.error?.message ?? null,
    })
    return Number(changed) > 0
  }

  async prune(now: number, owner: AnalysisJobOwner) {
    await this.scope(owner).where('expires_at_ms', '<=', now).delete()
  }
}

export const analysisJobs = new AnalysisJobService(
  new LucidAnalysisJobRepository(),
  Date.now,
  (_error, jobId) => logger.warn({ jobId }, '后台 AI 分析未能完成'),
)
