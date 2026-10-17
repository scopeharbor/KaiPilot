/**
 * ai-structured-output-poc / M0 —— 测量夹具（前端留存资产）。
 *
 * 依据 spec「M0 报告结构化导出且含环境元数据」+ apply 决策 R=20, N=12：
 *   - `summarizeOutcomes` 汇总 R×N×3 策略的一次运行结果为三档分布 + 分位延迟；
 *   - `formatEnvMeta` 组装 `AiM0EnvironmentMetadata`（provider/model/temperature/rep/date/hash/isReal）；
 *   - 结果结构与 `gantt-m0/measure.ts` 类似：无随机源，纯函数。
 *
 * 用途：前端 sandbox 页可跑「N 条输入 × R 次重复」并本地生成一份轻量报告快照；
 *      正式 M0 门禁数字仍由后端评测入口（tasks 9.2）产出，两者结构对齐。
 */

import type {
  AiM0ConsistencyBucket,
  AiM0EnvironmentMetadata,
  AiM0ErrorKind,
  AiM0GenerationOutcome,
  AiM0Strategy,
} from '@aiproj/types'
import { AI_M0_CONSISTENCY_BUCKETS, AI_M0_STRATEGIES } from '@aiproj/types'

export interface OutcomeSummary {
  totalRuns: number
  perStrategy: Record<AiM0Strategy, StrategySummary>
  overall: StrategySummary
}

export interface StrategySummary {
  runs: number
  buckets: Record<AiM0ConsistencyBucket, number>
  landableRate: number // strict + repaired 占比
  strictRate: number
  markerCoverageAvg: number
  firstTokenMsP50: number
  firstTokenMsP95: number
  totalMsP50: number
  totalMsP95: number
  retriesAvg: number
  errorCounts: Record<AiM0ErrorKind, number>
}

const emptyBuckets = (): Record<AiM0ConsistencyBucket, number> => ({
  strict: 0,
  repaired: 0,
  failed: 0,
})
const emptyErrors = (): Record<AiM0ErrorKind, number> => ({
  truncated: 0,
  malformed_json: 0,
  field_missing_or_type_error: 0,
  token_limit_exceeded: 0,
  sse_interrupted: 0,
  model_refusal_or_empty: 0,
  repetition_loop: 0,
})

/**
 * 分位数（P50/P95）——线性内插，处理空数组返回 0。
 * 用户已确认阈值为 design 建议值（landableRate 0.95 / markerCoverage 1 / sseRecovery 0.95）。
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const loV = sorted[lo] ?? 0
  const hiV = sorted[hi] ?? 0
  if (lo === hi) return loV
  const w = idx - lo
  return loV * (1 - w) + hiV * w
}

export function summarizeOutcomes(outcomes: readonly AiM0GenerationOutcome[]): OutcomeSummary {
  const perStrategy = Object.fromEntries(
    AI_M0_STRATEGIES.map((s) => [s, buildEmptyStrategySummary()]),
  ) as Record<AiM0Strategy, StrategySummary>

  const byStrategy = new Map<AiM0Strategy, AiM0GenerationOutcome[]>()
  for (const s of AI_M0_STRATEGIES) byStrategy.set(s, [])
  for (const o of outcomes) byStrategy.get(o.strategy)?.push(o)

  for (const s of AI_M0_STRATEGIES) {
    const arr = byStrategy.get(s) ?? []
    perStrategy[s] = summarizeGroup(arr)
  }
  const overallSum = summarizeGroup([...outcomes])

  return {
    totalRuns: outcomes.length,
    perStrategy,
    overall: overallSum,
  }
}

function buildEmptyStrategySummary(): StrategySummary {
  return {
    runs: 0,
    buckets: emptyBuckets(),
    landableRate: 0,
    strictRate: 0,
    markerCoverageAvg: 0,
    firstTokenMsP50: 0,
    firstTokenMsP95: 0,
    totalMsP50: 0,
    totalMsP95: 0,
    retriesAvg: 0,
    errorCounts: emptyErrors(),
  }
}

function summarizeGroup(arr: AiM0GenerationOutcome[]): StrategySummary {
  const buckets = emptyBuckets()
  const errors = emptyErrors()
  const firstTokens: number[] = []
  const totals: number[] = []
  let coverageSum = 0
  let retriesSum = 0
  for (const o of arr) {
    buckets[o.bucket] += 1
    coverageSum += o.markerCoverage
    retriesSum += o.retries
    firstTokens.push(o.firstTokenMs)
    totals.push(o.totalMs)
    for (const e of o.triggeredErrors) errors[e] += 1
  }
  const runs = arr.length
  return {
    runs,
    buckets,
    landableRate: runs === 0 ? 0 : (buckets.strict + buckets.repaired) / runs,
    strictRate: runs === 0 ? 0 : buckets.strict / runs,
    markerCoverageAvg: runs === 0 ? 0 : coverageSum / runs,
    firstTokenMsP50: percentile(firstTokens, 0.5),
    firstTokenMsP95: percentile(firstTokens, 0.95),
    totalMsP50: percentile(totals, 0.5),
    totalMsP95: percentile(totals, 0.95),
    retriesAvg: runs === 0 ? 0 : retriesSum / runs,
    errorCounts: errors,
  }
}

/** 组装 env metadata；`isoDate` 由调用侧注入（禁用 `Date.now()`，保持确定性）。 */
export function formatEnvMeta(input: {
  provider: string
  model: string
  temperature: number
  repetitions: number
  isoDate: string
  inputSetHash: string
  usingRealAdapter: boolean
}): AiM0EnvironmentMetadata {
  return {
    provider: input.provider,
    model: input.model,
    temperature: input.temperature,
    repetitions: input.repetitions,
    measurementDate: input.isoDate,
    inputSetHash: input.inputSetHash,
    usingRealAdapter: input.usingRealAdapter,
  }
}

/** 供 CI 校验的桶总和不变式：每策略 buckets 相加 === runs。 */
export function assertBucketInvariant(summary: OutcomeSummary): void {
  for (const s of AI_M0_STRATEGIES) {
    const ss = summary.perStrategy[s]
    const sum = AI_M0_CONSISTENCY_BUCKETS.reduce((acc, b) => acc + ss.buckets[b], 0)
    if (sum !== ss.runs) {
      throw new Error(`bucket sum mismatch for strategy=${s}: runs=${ss.runs} sum=${sum}`)
    }
  }
}
