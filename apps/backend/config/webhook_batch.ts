/**
 * v2-5-webhook-batched-delivery -- 出站 webhook 批量投递配置（design D7）。
 *
 * 从环境变量读取批量投递参数，暴露惰性 getter。
 * 运行时直读 process.env，与 webhook_allowlist.ts 同一理由：测试中可热切换。
 * env.ts 仍声明 schema 作 boot 校验与文档。
 */

import { DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG } from '@aiproj/types'

function readEnabled(): boolean {
  const raw = process.env.OUTGOING_WEBHOOK_BATCH_ENABLED
  return raw === 'true' || raw === '1'
}

function readWindowSeconds(): number {
  const raw = process.env.OUTGOING_WEBHOOK_BATCH_WINDOW_SECONDS
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 1 && n <= 3600) return n
  }
  return DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.windowSeconds
}

function readMaxEntries(): number {
  const raw = process.env.OUTGOING_WEBHOOK_BATCH_MAX_ENTRIES
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 1 && n <= 1000) return n
  }
  return DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxEntries
}

function readMaxPayloadBytes(): number {
  const raw = process.env.OUTGOING_WEBHOOK_BATCH_MAX_PAYLOAD_BYTES
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 1024 && n <= 10 * 1024 * 1024) return n
  }
  return DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG.maxPayloadBytes
}

const outgoingWebhookBatchConfig = {
  get enabled(): boolean {
    return readEnabled()
  },
  get windowSeconds(): number {
    return readWindowSeconds()
  },
  get maxEntries(): number {
    return readMaxEntries()
  },
  get maxPayloadBytes(): number {
    return readMaxPayloadBytes()
  },
}

export default outgoingWebhookBatchConfig
