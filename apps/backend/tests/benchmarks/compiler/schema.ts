/**
 * v2-5-compiler-execution-gap-benchmark —— 结果 JSON schema（tasks 1.1）。
 *
 * 机器可读输出必须通过本 schema 才允许写出（spec：「输出必须同时面向机器与评审者」）。
 * schema 与 `types.ts` 的 TS 类型一一对应，用 `satisfies` 在编译期锁死漂移。
 */

import { z } from 'zod'
import { CONFIDENCE_LEVELS, GAP_CLASSIFICATIONS } from './types.js'
import type { BenchmarkResult } from './types.js'

export const BENCHMARK_SCHEMA_VERSION = '1.0'
export const BENCHMARK_ID = 'compiler-execution-gap-benchmark'

const environmentSchema = z.object({
  gitSha: z.string().min(7),
  gitBranch: z.string().min(1),
  gitDirty: z.boolean(),
  nodeVersion: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  cpuModel: z.string().min(1),
  cpuCount: z.number().int().positive(),
  fixtureVersion: z.string().min(1),
  runCount: z.number().int().positive(),
  timeSource: z.string().min(1),
  generatedAt: z.string().min(1),
})

const staticEvidenceSchema = z.object({
  symbol: z.string().min(1),
  file: z.string().min(1),
  exists: z.boolean(),
  reachableFromProductionEntry: z.boolean(),
  productionCallSites: z.number().int().nonnegative(),
  note: z.string(),
})

const behaviorEvidenceSchema = z.object({
  observed: z.boolean(),
  attempted: z.boolean(),
  detail: z.string().min(1),
  fixtureIds: z.array(z.string()),
})

const observedStageStatusSchema = z.enum(['completed', 'failed', 'skipped'])

const cacheProbeSchema = z.object({
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  resultsIdentical: z.boolean(),
  inputHashStable: z.boolean(),
  computeCalls: z.number().int().nonnegative(),
})

const resumeProbeSchema = z.object({
  resumed: z.boolean(),
  checkpointVersion: z.number().int().nonnegative(),
  restoredCompletedStages: z.array(z.string()),
  reExecutedStages: z.array(z.string()),
  replayReplayed: z.boolean(),
  replayStages: z.number().int().nonnegative(),
  replayMissingArtifacts: z.array(z.string()),
})

const fixtureAggregateSchema = z.object({
  fixtureId: z.string().min(1),
  description: z.string().min(1),
  runCount: z.number().int().positive(),
  medianWallClockMs: z.number().nonnegative(),
  wallClockSamplesMs: z.array(z.number().nonnegative()).min(1),
  stageOrderStable: z.boolean(),
  stageOrder: z.array(z.string()),
  maxObservedConcurrency: z.number().int().nonnegative(),
  overlapObserved: z.boolean(),
  overlappingPairs: z.array(z.string()),
  attemptsByStage: z.record(z.string(), z.number().int().nonnegative()),
  statusByStage: z.record(z.string(), observedStageStatusSchema),
  checkpointCount: z.number().int().nonnegative(),
  artifactKinds: z.record(z.string(), z.number().int().nonnegative()),
  artifactHashStable: z.boolean(),
  artifactHashByStage: z.record(z.string(), z.string()),
  cacheHits: z.number().int().nonnegative(),
  cacheMisses: z.number().int().nonnegative(),
  eventStatusCounts: z.record(z.string(), z.number().int().nonnegative()),
  runTerminalStatus: z.string().nullable(),
  succeeded: z.boolean(),
  failedStages: z.array(z.string()),
  cacheProbe: cacheProbeSchema.nullable(),
  resumeProbe: resumeProbeSchema.nullable(),
})

const capabilityFindingSchema = z
  .object({
    capabilityId: z.string().min(1),
    title: z.string().min(1),
    classification: z.enum(GAP_CLASSIFICATIONS),
    confidence: z.enum(CONFIDENCE_LEVELS),
    evidence: z.object({
      static: z.array(staticEvidenceSchema).min(1),
      isolatedExecutor: behaviorEvidenceSchema,
      productionServicePath: behaviorEvidenceSchema,
    }),
    references: z.object({
      files: z.array(z.string()).min(1),
      symbols: z.array(z.string()).min(1),
      tests: z.array(z.string()),
      results: z.array(z.string()),
    }),
    limitations: z.array(z.string()),
  })
  // 置信度不是 high 时必须写明限制，避免"低置信度但无说明"的空结论。
  .refine((f) => f.confidence === 'high' || f.limitations.length > 0, {
    message: 'confidence 非 high 的结论必须提供至少一条 limitations',
    path: ['limitations'],
  })
  // D1 防越级：生产路径未观测到就不允许标 implemented。
  .refine(
    (f) =>
      f.classification !== 'implemented' ||
      (f.evidence.productionServicePath.observed &&
        f.evidence.static.some((s) => s.reachableFromProductionEntry)),
    {
      message: 'implemented 必须同时具备生产路径可达与生产路径行为证据',
      path: ['classification'],
    },
  )

const nextChangeScopeSchema = z.object({
  changeId: z.string().min(1),
  inScope: z.array(z.string()).min(1),
  nonGoals: z.array(z.string()).min(1),
})

export const benchmarkResultSchema = z.object({
  schemaVersion: z.literal(BENCHMARK_SCHEMA_VERSION),
  benchmarkId: z.literal(BENCHMARK_ID),
  environment: environmentSchema,
  fixtures: z.array(fixtureAggregateSchema).min(1),
  findings: z.array(capabilityFindingSchema).min(1),
  nextChangeScope: nextChangeScopeSchema,
})

/** 编译期锁：schema 推导类型必须与 `BenchmarkResult` 结构一致。 */
export type BenchmarkResultFromSchema = z.infer<typeof benchmarkResultSchema>

export function parseBenchmarkResult(value: unknown): BenchmarkResult {
  return benchmarkResultSchema.parse(value) satisfies BenchmarkResult
}
