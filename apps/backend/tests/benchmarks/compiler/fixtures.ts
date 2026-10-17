/**
 * v2-5-compiler-execution-gap-benchmark —— deterministic fixtures（tasks 2.1-2.5）。
 *
 * design D2：五组固定 manifest。全部 Stage 均为 `deterministic` 类型，因此
 * `PipelineExecutor` 不会生成 Context Packet、不会触碰 `ContextCompilerService`，
 * 也就**结构性地不可能调用 AIGateway**（执行器只在 `type === 'llm' | 'hybrid'` 时走那条路）。
 *
 * handler 只做三件事：受控延迟、计数、返回 deterministic 输出。输出中不含时间戳或随机数，
 * 故 `computeContentHash(output)` 在多次运行间稳定——这是 cache fixture 的前提。
 *
 * ⚠️ 执行器的分组语义（决定 fixture 如何编排）：
 * `execute()` 先按 phase 分组顺序执行，phase 内再按 parallelGroup 分组；**同 phase 内没有
 * parallelGroup 的 step 会被排到所有 parallel group 之后**。因此依赖跨越并行分支时必须用
 * phase 边界隔开，否则下游会因依赖未完成而被判 `skipped`。
 */

import { z } from 'zod'
import type { StageDefinition } from '@aiproj/compiler-spec'
import type { StageBlueprint } from '#services/compiler/manifest_builder'
import type { CompilerContext } from '#services/compiler/context_scope_resolver'

// ── 公共 schema ──

/**
 * 执行器把整个 `CompilerContext` 当作 Stage 输入交给 `validateInput`，
 * 其中 `stageOutputs` 是 `Map`，不适合用结构化 zod 描述；本 benchmark 不测输入校验，
 * 故放行任意输入，把观测焦点留给编排行为。
 */
const anyInputSchema = z.any()

/** deterministic 输出：无时间戳、无随机数，保证 content hash 稳定。 */
export const fixtureOutputSchema = z.object({
  stageId: z.string().min(1),
  ok: z.literal(true),
  value: z.number().int(),
})

export type FixtureOutput = z.infer<typeof fixtureOutputSchema>

// ── 观测记录器 ──

export interface StageSpan {
  stageId: string
  startOffsetMs: number
  endOffsetMs: number
}

/**
 * handler 侧的行为记录器。
 *
 * 记录每个 handler 的真实进入/退出时刻与调用次数——这是 design D3 所说的
 * 「行为证据」：并行与重试的判定都来自这里，而不是 wall-clock 推测。
 */
export class StageRecorder {
  readonly spans: StageSpan[] = []
  readonly attempts = new Map<string, number>()
  maxConcurrency = 0

  #live = 0
  #t0 = 0

  reset(): void {
    this.spans.length = 0
    this.attempts.clear()
    this.maxConcurrency = 0
    this.#live = 0
    this.#t0 = performance.now()
  }

  get elapsedMs(): number {
    return performance.now() - this.#t0
  }

  begin(stageId: string): number {
    this.attempts.set(stageId, (this.attempts.get(stageId) ?? 0) + 1)
    this.#live++
    if (this.#live > this.maxConcurrency) this.maxConcurrency = this.#live
    return performance.now() - this.#t0
  }

  end(stageId: string, startOffsetMs: number): void {
    this.#live--
    this.spans.push({ stageId, startOffsetMs, endOffsetMs: performance.now() - this.#t0 })
  }

  attemptsOf(stageId: string): number {
    return this.attempts.get(stageId) ?? 0
  }

  /** 实际发生时间重叠的 stage 对（并行主证据）。 */
  overlappingPairs(): string[] {
    const pairs: string[] = []
    for (let i = 0; i < this.spans.length; i++) {
      for (let j = i + 1; j < this.spans.length; j++) {
        const a = this.spans[i]!
        const b = this.spans[j]!
        if (a.startOffsetMs < b.endOffsetMs && b.startOffsetMs < a.endOffsetMs) {
          pairs.push([a.stageId, b.stageId].sort().join('|'))
        }
      }
    }
    return [...new Set(pairs)].sort()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Stage 定义工厂 ──

interface StageSpec {
  stageId: string
  phase: StageDefinition['phase']
  dependsOn: string[]
  parallelGroup?: string
  delayMs: number
  value: number
  /** 前 N 次调用抛错；用于 fail-once fixture 探测执行器是否重试。 */
  failFirstAttempts?: number
}

function defineStage(spec: StageSpec): StageDefinition {
  return {
    stageId: spec.stageId,
    type: 'deterministic',
    phase: spec.phase,
    name: `benchmark ${spec.stageId}`,
    description: 'v2-5-compiler-execution-gap-benchmark deterministic fixture stage',
    inputSchema: anyInputSchema,
    outputSchema: fixtureOutputSchema,
    contextScope: ['run_metadata'],
    allowedTools: [],
    sideEffects: {
      writesArtifact: true,
      updatesManifest: true,
      updatesLedger: false,
      callsLlm: false,
    },
    dependsOn: spec.dependsOn,
    parallelGroup: spec.parallelGroup,
    timeoutMs: 0,
  }
}

function toBlueprint(spec: StageSpec): StageBlueprint {
  return {
    stageId: spec.stageId,
    phase: spec.phase,
    dependsOn: spec.dependsOn,
    parallelGroup: spec.parallelGroup,
    entities: [{ entityId: `E_${spec.stageId}`, kind: 'work_package' }],
  }
}

// ── Fixture 定义 ──

export interface CompilerFixture {
  fixtureId: string
  description: string
  specs: StageSpec[]
  /** 预期 stage 完成顺序（同一 parallel group 内顺序不保证，故只列组边界）。 */
  expected: {
    /** 预期最大并发（1 = 纯串行）。 */
    maxConcurrency: number
    /** 预期成功完成的 stage。 */
    completed: string[]
    /** 预期失败的 stage。 */
    failed: string[]
    /** 预期被跳过（依赖未满足）的 stage。 */
    skipped: string[]
  }
}

/** 2.1 serial-3：单 phase、无 parallelGroup、线性依赖链。 */
export const serial3Fixture: CompilerFixture = {
  fixtureId: 'serial-3',
  description: '三段线性依赖 DAG（同 phase、无 parallelGroup），验证串行顺序与逐 Stage checkpoint',
  specs: [
    { stageId: 's1', phase: 'intake', dependsOn: [], delayMs: 12, value: 1 },
    { stageId: 's2', phase: 'intake', dependsOn: ['s1'], delayMs: 12, value: 2 },
    { stageId: 's3', phase: 'intake', dependsOn: ['s2'], delayMs: 12, value: 3 },
  ],
  expected: { maxConcurrency: 1, completed: ['s1', 's2', 's3'], failed: [], skipped: [] },
}

/**
 * 2.2 diamond-parallel：A →（B ‖ C）→ D。
 *
 * B/C 同 phase 同 parallelGroup；A 与 D 各占独立 phase——若把它们塞进同一 phase，
 * 执行器会先跑 parallel group 再跑无组 step，导致 B/C 依赖未完成而被跳过。
 */
export const diamondParallelFixture: CompilerFixture = {
  fixtureId: 'diamond-parallel',
  description: '钻石 DAG：A →（B ‖ C）→ D，验证同 parallelGroup 的真实并发与重叠',
  specs: [
    { stageId: 'a', phase: 'intake', dependsOn: [], delayMs: 8, value: 10 },
    {
      stageId: 'b',
      phase: 'understanding',
      dependsOn: ['a'],
      parallelGroup: 'branch',
      delayMs: 40,
      value: 11,
    },
    {
      stageId: 'c',
      phase: 'understanding',
      dependsOn: ['a'],
      parallelGroup: 'branch',
      delayMs: 40,
      value: 12,
    },
    { stageId: 'd', phase: 'analysis', dependsOn: ['b', 'c'], delayMs: 8, value: 13 },
  ],
  expected: { maxConcurrency: 2, completed: ['a', 'b', 'c', 'd'], failed: [], skipped: [] },
}

/**
 * 2.3 fail-once：f2 的 handler 第 1 次抛错、第 2 次会成功。
 *
 * 本 fixture 是**探针**：若执行器具备重试，f2 应最终 completed 且 attempts=2；
 * 若不具备，f2 停在 failed 且 attempts=1，下游 f3 因依赖未满足被跳过。
 * 预期值按当前实现的**实际**行为填写，任何偏离都会被 2.6 的预期结果测试抓到。
 */
export const failOnceFixture: CompilerFixture = {
  fixtureId: 'fail-once',
  description: 'f2 首次失败、二次可成功的探针 DAG，测量执行器是否发起第二次 attempt',
  specs: [
    { stageId: 'f1', phase: 'intake', dependsOn: [], delayMs: 6, value: 20 },
    {
      stageId: 'f2',
      phase: 'intake',
      dependsOn: ['f1'],
      delayMs: 6,
      value: 21,
      failFirstAttempts: 1,
    },
    { stageId: 'f3', phase: 'intake', dependsOn: ['f2'], delayMs: 6, value: 22 },
  ],
  expected: { maxConcurrency: 1, completed: ['f1'], failed: ['f2'], skipped: ['f3'] },
}

/**
 * 2.4 checkpoint-resume：r2 失败使 run 停在中途，随后从 checkpoint 恢复。
 *
 * 预期恢复点：最新 checkpoint 应记录 r1 已完成；resume 后 r1 状态必须是 completed。
 */
export const checkpointResumeFixture: CompilerFixture = {
  fixtureId: 'checkpoint-resume',
  description: 'r2 失败后从最近 checkpoint 恢复，验证恢复点与 replay 的 artifact 完整性',
  specs: [
    { stageId: 'r1', phase: 'intake', dependsOn: [], delayMs: 6, value: 30 },
    {
      stageId: 'r2',
      phase: 'intake',
      dependsOn: ['r1'],
      delayMs: 6,
      value: 31,
      failFirstAttempts: 99,
    },
    { stageId: 'r3', phase: 'intake', dependsOn: ['r2'], delayMs: 6, value: 32 },
  ],
  expected: { maxConcurrency: 1, completed: ['r1'], failed: ['r2'], skipped: ['r3'] },
}

/** 2.5 cache-repeat：单 Stage，重复执行相同输入，检查稳定 hash 与缓存复用。 */
export const cacheRepeatFixture: CompilerFixture = {
  fixtureId: 'cache-repeat',
  description: '同一 Stage 相同输入重复执行，验证输入/产物 hash 稳定与执行器是否复用缓存',
  specs: [{ stageId: 'k1', phase: 'intake', dependsOn: [], delayMs: 6, value: 40 }],
  expected: { maxConcurrency: 1, completed: ['k1'], failed: [], skipped: [] },
}

export const ALL_FIXTURES: CompilerFixture[] = [
  serial3Fixture,
  diamondParallelFixture,
  failOnceFixture,
  checkpointResumeFixture,
  cacheRepeatFixture,
]

// ── 构建物 ──

export function fixtureDefinitions(fixture: CompilerFixture): StageDefinition[] {
  return fixture.specs.map(defineStage)
}

export function fixtureBlueprints(fixture: CompilerFixture): StageBlueprint[] {
  return fixture.specs.map(toBlueprint)
}

/**
 * 构建 handler。
 *
 * `recorder` 跨 attempt 累计调用次数，`failFirstAttempts` 据此决定是否抛错，
 * 因此「第二次会成功」是真实可达的——若执行器重试，fixture 一定能观测到。
 */
export function fixtureHandler(
  spec: StageSpec,
  recorder: StageRecorder,
): (input: unknown) => Promise<FixtureOutput> {
  return async () => {
    const start = recorder.begin(spec.stageId)
    try {
      await sleep(spec.delayMs)
      const attempt = recorder.attemptsOf(spec.stageId)
      if (spec.failFirstAttempts !== undefined && attempt <= spec.failFirstAttempts) {
        throw new Error(`fixture stage ${spec.stageId} failed on attempt ${attempt}`)
      }
      return { stageId: spec.stageId, ok: true as const, value: spec.value }
    } finally {
      recorder.end(spec.stageId, start)
    }
  }
}

/** benchmark 用的最小 CompilerContext（无用户数据、无正式项目引用）。 */
export function fixtureContext(fixtureId: string): CompilerContext {
  return {
    userInput: { fixture: fixtureId },
    runMetadata: { fixture: fixtureId, benchmark: true },
    stageOutputs: new Map<string, unknown>(),
    blueprints: {},
    fullDraft: {},
  }
}
