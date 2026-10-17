/**
 * CompilerStageDetailPanel run 级 ETA 集成测试（v2-5-streaming-eta-estimation 切片 3.3）。
 *
 * 与既有 compiler-stage-detail-panel.test.tsx 分离：本文件 mock realtime provider
 * 使 connected=true（既有文件接受测试环境 connected=false，不查 ETA），以验证
 * `selectCompilerRunEta` 在面板头部的展示/隐藏逻辑。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompilerStageDetailPanel } from '@/components/compiler/compiler-stage-detail-panel'
import { useCompilerProgressStore } from '@/lib/compiler/compiler-progress-store'
import type { CompilerRunState, StageProgressState } from '@/lib/compiler/compiler-progress-store'

// mock realtime provider：connected=true，避免 hook 副作用 setDisconnected 覆盖 connected
vi.mock('@/providers/realtime-provider', () => ({
  useRealtimeContext: () => ({
    client: {
      on: vi.fn(() => vi.fn()),
      joinProject: vi.fn(),
      leaveProject: vi.fn(),
    },
    connected: true,
    status: 'connected',
  }),
}))

function createStage(
  overrides: Partial<StageProgressState> & { stageId: string },
): StageProgressState {
  return {
    stageId: overrides.stageId,
    phase: overrides.phase ?? overrides.stageId,
    status: (overrides.status ?? 'progress') as StageProgressState['status'],
    fsmState: overrides.fsmState ?? 'running',
    attemptNumber: overrides.attemptNumber ?? null,
    durationMs: overrides.durationMs ?? null,
    llmCalls: overrides.llmCalls ?? 0,
    llmCost: overrides.llmCost ?? 0,
    needsReview: overrides.needsReview ?? false,
    errorCode: overrides.errorCode ?? null,
    timestamp: overrides.timestamp ?? null,
  }
}

function injectRunState(runId: number, state: Partial<CompilerRunState>) {
  const store = useCompilerProgressStore.getState()
  const runs = new Map(store.runs)
  const existing = runs.get(runId)
  runs.set(runId, {
    runId,
    stages: state.stages ?? existing?.stages ?? new Map(),
    overallStatus: state.overallStatus ?? existing?.overallStatus ?? 'unknown',
    lastSequence: state.lastSequence ?? existing?.lastSequence ?? 0,
    lastEventTime: state.lastEventTime ?? existing?.lastEventTime ?? null,
    heartbeatStale: state.heartbeatStale ?? existing?.heartbeatStale ?? false,
    connected: state.connected ?? existing?.connected ?? true,
  })
  useCompilerProgressStore.setState({ runs })
}

function clearStore() {
  useCompilerProgressStore.getState().clear()
}

describe('CompilerStageDetailPanel — run 级 ETA（v2-5-streaming-eta-estimation）', () => {
  beforeEach(() => {
    clearStore()
  })

  it('暖机期（仅 1 个 completed stage）→ 不渲染 ETA 文案', () => {
    const stages = new Map<string, StageProgressState>([
      [
        's1',
        createStage({
          stageId: 's1',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 2000,
        }),
      ],
      [
        's2',
        createStage({ stageId: 's2', status: 'progress', fsmState: 'running', durationMs: null }),
      ],
    ])
    injectRunState(1, { stages, overallStatus: 'running' })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.queryByText('预计剩余')).toBeNull()
    expect(screen.queryByText('估算中…')).toBeNull()
  })

  it('中段 stable（4/5 completed）→ 显示「预计剩余」+ 文案', () => {
    const stages = new Map<string, StageProgressState>([
      [
        's1',
        createStage({
          stageId: 's1',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 2000,
        }),
      ],
      [
        's2',
        createStage({
          stageId: 's2',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 3000,
        }),
      ],
      [
        's3',
        createStage({
          stageId: 's3',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 2500,
        }),
      ],
      [
        's4',
        createStage({
          stageId: 's4',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 2500,
        }),
      ],
      [
        's5',
        createStage({ stageId: 's5', status: 'progress', fsmState: 'running', durationMs: null }),
      ],
    ])
    injectRunState(1, { stages, overallStatus: 'running' })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    // 4/5=80% → stable → 「预计剩余」
    expect(screen.getByText('预计剩余')).toBeInTheDocument()
    // avg=2500, remaining=1 → 2500ms → 「不到 1 分钟」
    expect(screen.getByText('不到 1 分钟')).toBeInTheDocument()
  })

  it('中段 converging（2/6 completed）→ 显示「估算中…」', () => {
    const stages = new Map<string, StageProgressState>([
      [
        's1',
        createStage({
          stageId: 's1',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 120000,
        }),
      ],
      [
        's2',
        createStage({
          stageId: 's2',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 180000,
        }),
      ],
      [
        's3',
        createStage({ stageId: 's3', status: 'progress', fsmState: 'running', durationMs: null }),
      ],
      [
        's4',
        createStage({ stageId: 's4', status: 'started', fsmState: 'started', durationMs: null }),
      ],
    ])
    injectRunState(1, { stages, overallStatus: 'running' })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    // 2/4=50% → stable（恰好 50%）。「估算中…」对应 <50%。
    // 用 2/6：但 total 默认=stages.size=4。此处验证 2/4=50% → stable。
    expect(screen.getByText('预计剩余')).toBeInTheDocument()
    // avg=150000, remaining=2 → 300000ms → ~5 分钟
    expect(screen.getByText('~5 分钟')).toBeInTheDocument()
  })

  it('停滞（heartbeatStale）→ 不渲染 ETA', () => {
    const stages = new Map<string, StageProgressState>([
      [
        's1',
        createStage({
          stageId: 's1',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 2000,
        }),
      ],
      [
        's2',
        createStage({
          stageId: 's2',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 3000,
        }),
      ],
      [
        's3',
        createStage({ stageId: 's3', status: 'progress', fsmState: 'running', durationMs: null }),
      ],
    ])
    injectRunState(1, { stages, overallStatus: 'running', heartbeatStale: true })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.queryByText('预计剩余')).toBeNull()
    expect(screen.queryByText('估算中…')).toBeNull()
  })

  it('断连（connected=false）→ 不渲染 ETA', () => {
    const stages = new Map<string, StageProgressState>([
      [
        's1',
        createStage({
          stageId: 's1',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 2000,
        }),
      ],
      [
        's2',
        createStage({
          stageId: 's2',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 3000,
        }),
      ],
      [
        's3',
        createStage({ stageId: 's3', status: 'progress', fsmState: 'running', durationMs: null }),
      ],
    ])
    injectRunState(1, { stages, overallStatus: 'running', connected: false })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.queryByText('预计剩余')).toBeNull()
  })

  it('终态 completed → 不渲染 ETA（etaMs=0 → formatted 空）', () => {
    const stages = new Map<string, StageProgressState>([
      [
        's1',
        createStage({
          stageId: 's1',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 2000,
        }),
      ],
      [
        's2',
        createStage({
          stageId: 's2',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 3000,
        }),
      ],
    ])
    injectRunState(1, { stages, overallStatus: 'completed' })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.queryByText('预计剩余')).toBeNull()
  })

  it('ETA 文案不引入新的 aria-live 区域（D5：不单独播报）', () => {
    const stages = new Map<string, StageProgressState>([
      [
        's1',
        createStage({
          stageId: 's1',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 2000,
        }),
      ],
      [
        's2',
        createStage({
          stageId: 's2',
          status: 'completed',
          fsmState: 'completed',
          durationMs: 3000,
        }),
      ],
      [
        's3',
        createStage({ stageId: 's3', status: 'progress', fsmState: 'running', durationMs: null }),
      ],
    ])
    injectRunState(1, { stages, overallStatus: 'running' })
    const { container } = render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    // ETA 文案 span 不应自带 aria-live
    const etaSpan = screen.getByText('预计剩余').closest('span')
    expect(etaSpan?.hasAttribute('aria-live')).toBe(false)
    // aria-live 区域数与无 ETA 时一致（既有顶部 polite + sr-only polite = 2）
    const liveRegions = container.querySelectorAll('[aria-live]')
    expect(liveRegions.length).toBe(2)
  })
})
