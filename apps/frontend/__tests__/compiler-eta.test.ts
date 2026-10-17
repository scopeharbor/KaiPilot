import { describe, expect, it } from 'vitest'
import { selectCompilerRunEta } from '@/lib/compiler/compiler-eta'
import type { CompilerRunState, StageProgressState } from '@/lib/compiler/compiler-progress-store'
import type { StreamingEventType } from '@aiproj/types/progress-streaming'

function makeStage(opts: Partial<StageProgressState> & { stageId: string }): StageProgressState {
  return {
    stageId: opts.stageId,
    phase: opts.phase ?? opts.stageId,
    status: (opts.status ?? 'completed') as StreamingEventType,
    fsmState: opts.fsmState ?? 'completed',
    attemptNumber: opts.attemptNumber ?? null,
    durationMs: opts.durationMs ?? null,
    llmCalls: opts.llmCalls ?? 0,
    llmCost: opts.llmCost ?? 0,
    needsReview: opts.needsReview ?? false,
    errorCode: opts.errorCode ?? null,
    timestamp: opts.timestamp ?? null,
  }
}

function makeRun(
  stages: StageProgressState[],
  opts: Partial<CompilerRunState> = {},
): CompilerRunState {
  const map = new Map<string, StageProgressState>()
  stages.forEach((s) => map.set(s.stageId, s))
  return {
    runId: opts.runId ?? 1,
    stages: map,
    overallStatus: opts.overallStatus ?? 'running',
    lastSequence: opts.lastSequence ?? 0,
    lastEventTime: opts.lastEventTime ?? null,
    heartbeatStale: opts.heartbeatStale ?? false,
    connected: opts.connected ?? true,
  }
}

describe('selectCompilerRunEta', () => {
  describe('均值计算（D6）', () => {
    it('spec scenario：10 stage 完成 4，durationMs [2000,3000,2500,2500] → 15000ms', () => {
      const stages = [
        makeStage({ stageId: 's1', durationMs: 2000 }),
        makeStage({ stageId: 's2', durationMs: 3000 }),
        makeStage({ stageId: 's3', durationMs: 2500 }),
        makeStage({ stageId: 's4', durationMs: 2500 }),
      ]
      const run = makeRun(stages)
      const r = selectCompilerRunEta(run, 10)
      // 均值 2500 × 剩余 6 = 15000
      expect(r.etaMs).toBe(15_000)
      expect(r.confidence).toBe('converging') // 4/10=40%<50%
      expect(r.formatted).toBe('不到 1 分钟') // 15000ms < 60000
    })

    it('5/10（50%）→ stable', () => {
      const stages = Array.from({ length: 5 }, (_, i) =>
        makeStage({ stageId: `s${i}`, durationMs: 3000 }),
      )
      const run = makeRun(stages)
      const r = selectCompilerRunEta(run, 10)
      expect(r.confidence).toBe('stable')
      // 均值 3000 × 剩余 5 = 15000
      expect(r.etaMs).toBe(15_000)
    })
  })

  describe('暖机期（<2 stage）返回 null', () => {
    it('仅完成 1 个 stage → null（spec: Compiler 暖机期）', () => {
      const run = makeRun([makeStage({ stageId: 's1', durationMs: 2000 })])
      expect(selectCompilerRunEta(run, 10).etaMs).toBeNull()
    })

    it('完成 0 个 stage → null', () => {
      const run = makeRun([
        makeStage({ stageId: 's1', fsmState: 'running', durationMs: null, status: 'progress' }),
      ])
      expect(selectCompilerRunEta(run, 10).etaMs).toBeNull()
    })
  })

  describe('全完成返回 0', () => {
    it('completed 总态 → etaMs=0', () => {
      const stages = Array.from({ length: 4 }, (_, i) =>
        makeStage({ stageId: `s${i}`, durationMs: 2000 }),
      )
      const run = makeRun(stages, { overallStatus: 'completed' })
      const r = selectCompilerRunEta(run, 4)
      expect(r.etaMs).toBe(0)
      expect(r.confidence).toBe('stable')
    })

    it('completed 数 === total → 0（即便 overallStatus 仍 running）', () => {
      const stages = Array.from({ length: 4 }, (_, i) =>
        makeStage({ stageId: `s${i}`, durationMs: 2000 }),
      )
      const run = makeRun(stages)
      const r = selectCompilerRunEta(run, 4)
      expect(r.etaMs).toBe(0)
    })
  })

  describe('无 durationMs 数据时 null', () => {
    it('已完成 stage 的 durationMs 全为 null → null', () => {
      const stages = [
        makeStage({ stageId: 's1', durationMs: null }),
        makeStage({ stageId: 's2', durationMs: null }),
      ]
      const run = makeRun(stages)
      expect(selectCompilerRunEta(run, 10).etaMs).toBeNull()
    })

    it('部分 durationMs 为 null → 仅用有 durationMs 的计算', () => {
      const stages = [
        makeStage({ stageId: 's1', durationMs: 2000 }),
        makeStage({ stageId: 's2', durationMs: null }),
        makeStage({ stageId: 's3', durationMs: 4000 }),
      ]
      const run = makeRun(stages)
      const r = selectCompilerRunEta(run, 10)
      // completedUnits=3（含 null 的也算 completed）
      // sumDuration=2000+4000=6000（仅非 null），avg=3000，剩余 7 → 21000
      expect(r.etaMs).toBe(21_000)
      expect(r.confidence).toBe('converging')
    })

    it('durationMs 为 0 的 stage 被排除（completedWithDuration 过滤 ≤0）', () => {
      const stages = [
        makeStage({ stageId: 's1', durationMs: 0 }),
        makeStage({ stageId: 's2', durationMs: 0 }),
      ]
      const run = makeRun(stages)
      expect(selectCompilerRunEta(run, 10).etaMs).toBeNull()
    })
  })

  describe('异常状态守卫', () => {
    it('heartbeatStale → null', () => {
      const stages = Array.from({ length: 4 }, (_, i) =>
        makeStage({ stageId: `s${i}`, durationMs: 2000 }),
      )
      const run = makeRun(stages, { heartbeatStale: true })
      expect(selectCompilerRunEta(run, 10).etaMs).toBeNull()
    })

    it('!connected → null', () => {
      const stages = Array.from({ length: 4 }, (_, i) =>
        makeStage({ stageId: `s${i}`, durationMs: 2000 }),
      )
      const run = makeRun(stages, { connected: false })
      expect(selectCompilerRunEta(run, 10).etaMs).toBeNull()
    })

    it('overallStatus=failed → null', () => {
      const stages = Array.from({ length: 4 }, (_, i) =>
        makeStage({ stageId: `s${i}`, durationMs: 2000 }),
      )
      const run = makeRun(stages, { overallStatus: 'failed' })
      expect(selectCompilerRunEta(run, 10).etaMs).toBeNull()
    })

    it('overallStatus=cancelled → null', () => {
      const stages = Array.from({ length: 4 }, (_, i) =>
        makeStage({ stageId: `s${i}`, durationMs: 2000 }),
      )
      const run = makeRun(stages, { overallStatus: 'cancelled' })
      expect(selectCompilerRunEta(run, 10).etaMs).toBeNull()
    })
  })

  describe('默认 total = stages.size（不传 totalStages）', () => {
    it('不传 total → 用已见数；中段仍可算', () => {
      // 已见 6 个，已完成 4
      const stages = [
        makeStage({ stageId: 's1', durationMs: 2000 }),
        makeStage({ stageId: 's2', durationMs: 3000 }),
        makeStage({ stageId: 's3', durationMs: 2500 }),
        makeStage({ stageId: 's4', durationMs: 2500 }),
        makeStage({ stageId: 's5', fsmState: 'running', durationMs: null, status: 'progress' }),
        makeStage({ stageId: 's6', fsmState: 'initial', durationMs: null, status: 'started' }),
      ]
      const run = makeRun(stages)
      const r = selectCompilerRunEta(run) // total=6, completed=4
      // sum=10000, avg=2500, remaining=2 → 5000
      expect(r.etaMs).toBe(5_000)
      expect(r.confidence).toBe('stable') // 4/6=66%>50%
    })
  })

  describe('零 state 变更', () => {
    it('调用 selector 不修改 runState', () => {
      const stages = Array.from({ length: 4 }, (_, i) =>
        makeStage({ stageId: `s${i}`, durationMs: 2000 }),
      )
      const run = makeRun(stages)
      const snapshot = JSON.stringify({
        ...run,
        stages: [...run.stages.entries()],
      })
      selectCompilerRunEta(run, 10)
      const after = JSON.stringify({ ...run, stages: [...run.stages.entries()] })
      expect(after).toBe(snapshot)
    })
  })
})
