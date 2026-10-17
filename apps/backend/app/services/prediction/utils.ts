/**
 * v2-ai-risk-progress-prediction — 预测工具函数。
 *
 * 输入签名、输出 hash、sourceHash、证据引用和幂等键的工具函数。
 */
import { createHash } from 'node:crypto'
import type { PredictionSignalInput } from '@aiproj/types'

/**
 * 基于输入数据计算 sourceHash。
 */
export function computeSourceHash(data: Record<string, unknown>): string {
  const hash = createHash('sha256')
  hash.update(JSON.stringify(data, Object.keys(data).sort()))
  return hash.digest('hex').substring(0, 16)
}

/**
 * 基于输出信号计算 outputHash。
 */
export function computeOutputHash(signals: PredictionSignalInput[]): string {
  const hash = createHash('sha256')
  for (const s of signals) {
    hash.update(`${s.ruleId}:${s.ruleVersion}:${s.signalType}:${s.score}`)
  }
  return hash.digest('hex').substring(0, 16)
}

/**
 * 构建幂等键（项目 + 窗口 + 输入签名 + 规则版本）。
 */
export function buildIdempotencyKey(
  projectId: number,
  window: number,
  inputSignature: string,
  ruleVersion: string,
): string {
  return `${projectId}-${window}-${inputSignature}-${ruleVersion}`
}

/**
 * 构建证据引用（低敏化）。
 */
export function buildEvidenceRef(
  entityType: string,
  entityId: number,
  summary: string,
  visibility: 'full' | 'summary_only' | 'forbidden' = 'summary_only',
): {
  entityType: string
  entityId: number
  summaryHash: string
  displaySummary: string
  visibility: 'full' | 'summary_only' | 'forbidden'
} {
  const hash = createHash('sha256')
  hash.update(`${entityType}:${entityId}:${summary}`)
  return {
    entityType,
    entityId,
    summaryHash: hash.digest('hex').substring(0, 8),
    displaySummary: summary.length > 200 ? summary.substring(0, 200) + '…' : summary,
    visibility,
  }
}
