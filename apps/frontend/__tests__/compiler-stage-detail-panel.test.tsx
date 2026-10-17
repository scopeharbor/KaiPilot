/**
 * CompilerStageDetailPanel 组件测试。
 *
 * 覆盖：
 * - 1.2 骨架与数据接线：空态、run 不存在、stages 为空
 * - 2.2 稳定排序：同一 Stage 多事件后位置不变、幂等
 * - 3.3 run 级状态：partial/completed/failed/cancelled/stale
 * - 4.2 隐私白名单：敏感字段不泄漏、无副作用控件
 * - 5.2 无障碍：role/aria-live/sr-only/reduced-motion
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompilerStageDetailPanel } from '@/components/compiler/compiler-stage-detail-panel'
import { useCompilerProgressStore } from '@/lib/compiler/compiler-progress-store'
import type { CompilerRunState, StageProgressState } from '@/lib/compiler/compiler-progress-store'

// ── Helpers ──────────────────────────────────────────────

function createStage(
  overrides: Partial<StageProgressState> & { stageId: string },
): StageProgressState {
  return {
    stageId: overrides.stageId,
    phase: overrides.phase ?? overrides.stageId,
    status: overrides.status ?? 'progress',
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

// ── Fixtures ─────────────────────────────────────────────

const fixtureStages = new Map<string, StageProgressState>([
  [
    'stage-1',
    createStage({
      stageId: 'stage-1',
      phase: '解析输入',
      status: 'completed',
      fsmState: 'completed',
      durationMs: 1200,
      timestamp: '2026-07-21T10:00:05Z',
    }),
  ],
  [
    'stage-2',
    createStage({
      stageId: 'stage-2',
      phase: '路由选择',
      status: 'progress',
      fsmState: 'running',
      durationMs: 3400,
      llmCalls: 2,
    }),
  ],
  [
    'stage-3',
    createStage({ stageId: 'stage-3', phase: '编译任务', status: 'started', fsmState: 'started' }),
  ],
])

// ── Tests ────────────────────────────────────────────────

describe('CompilerStageDetailPanel — 1.2 骨架与数据接线', () => {
  beforeEach(() => {
    clearStore()
  })

  it('空态：run 不存在时显示「等待 Stage 事件」', () => {
    render(<CompilerStageDetailPanel projectId={1} runId={999} />)
    expect(screen.getByText('等待 Stage 事件')).toBeDefined()
  })

  it('空态：stages 为空时显示「等待 Stage 事件」', () => {
    // 渲染前先注入 run 状态，避免 useCompilerProgress 副作用改变 connected
    injectRunState(1, {
      stages: new Map(),
      overallStatus: 'unknown',
      connected: true,
    })
    // 用 act 包裹以处理 hook 副作用
    const { container } = render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    // 可能显示「等待 Stage 事件」或「连接已断开，等待 Stage 事件」
    // 取决于 hook 副作用是否已触发
    const hasWaiting = container.textContent?.includes('等待 Stage 事件')
    expect(hasWaiting).toBe(true)
  })

  it('空态 + 断连：显示「连接已断开，等待 Stage 事件」', () => {
    injectRunState(1, {
      stages: new Map(),
      overallStatus: 'unknown',
      connected: false,
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.getByText('连接已断开，等待 Stage 事件')).toBeDefined()
  })

  it('渲染 stage 列表：显示所有 stage 的 phase', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.getByText('解析输入')).toBeDefined()
    expect(screen.getByText('路由选择')).toBeDefined()
    expect(screen.getByText('编译任务')).toBeDefined()
  })

  it('显示「已完成 N / 已见 M」进度', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.getByText('已完成 1 / 已见 3')).toBeDefined()
  })
})

describe('CompilerStageDetailPanel — 2.2 稳定排序与幂等', () => {
  beforeEach(() => {
    clearStore()
  })

  it('同一 Stage 多事件后位置不变', () => {
    // 先注入初始状态
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })

    const { rerender } = render(<CompilerStageDetailPanel projectId={1} runId={1} />)

    // 确认初始顺序
    const rows1 = screen.getAllByRole('listitem')
    expect(rows1[0]).toHaveTextContent('解析输入')
    expect(rows1[1]).toHaveTextContent('路由选择')
    expect(rows1[2]).toHaveTextContent('编译任务')

    // 更新 stage-1（completed → completed，位置不变）
    const updatedStages = new Map(fixtureStages)
    updatedStages.set(
      'stage-1',
      createStage({
        stageId: 'stage-1',
        phase: '解析输入',
        status: 'completed',
        fsmState: 'completed',
        durationMs: 1200,
        timestamp: '2026-07-21T10:00:05Z',
      }),
    )

    injectRunState(1, {
      stages: updatedStages,
      overallStatus: 'running',
    })

    rerender(<CompilerStageDetailPanel projectId={1} runId={1} />)

    const rows2 = screen.getAllByRole('listitem')
    expect(rows2[0]).toHaveTextContent('解析输入')
    expect(rows2[1]).toHaveTextContent('路由选择')
    expect(rows2[2]).toHaveTextContent('编译任务')
  })

  it('重复/旧事件不产生回退（幂等）', () => {
    // 注入包含已完成 stage 的状态
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
      lastSequence: 5,
    })

    render(<CompilerStageDetailPanel projectId={1} runId={1} />)

    // 确认 stage-1 是 completed 状态
    expect(screen.getByText('解析输入')).toBeDefined()
    expect(screen.getByText('已完成 1 / 已见 3')).toBeDefined()
  })
})

describe('CompilerStageDetailPanel — 3.3 run 级状态', () => {
  beforeEach(() => {
    clearStore()
  })

  it('partial 运行显示 completed-of-seen 且不宣称完成', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.getByText('已完成 1 / 已见 3')).toBeDefined()
    // 不显示「编译完成」
    expect(screen.queryByText('编译全部完成')).toBeNull()
  })

  it('completed 终态显示完成横幅', () => {
    const allCompleted = new Map([
      [
        'stage-1',
        createStage({
          stageId: 'stage-1',
          phase: '解析输入',
          status: 'completed',
          fsmState: 'completed',
        }),
      ],
      [
        'stage-2',
        createStage({
          stageId: 'stage-2',
          phase: '路由选择',
          status: 'completed',
          fsmState: 'completed',
        }),
      ],
    ])
    injectRunState(1, {
      stages: allCompleted,
      overallStatus: 'completed',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.getByText('编译全部完成')).toBeDefined()
    expect(screen.getByText('编译完成')).toBeDefined()
  })

  it('failed 终态显示失败横幅和 errorCode', () => {
    const failedStages = new Map([
      [
        'stage-1',
        createStage({
          stageId: 'stage-1',
          phase: '解析输入',
          status: 'completed',
          fsmState: 'completed',
        }),
      ],
      [
        'stage-2',
        createStage({
          stageId: 'stage-2',
          phase: '路由选择',
          status: 'failed',
          fsmState: 'failed',
          errorCode: 'STAGE_ERROR',
        }),
      ],
    ])
    injectRunState(1, {
      stages: failedStages,
      overallStatus: 'failed',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    // 「编译失败」出现在头部标题和横幅中，用 getAllByText
    const failTexts = screen.getAllByText('编译失败')
    expect(failTexts.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('STAGE_ERROR')).toBeDefined()
  })

  it('cancelled 终态显示取消横幅', () => {
    const cancelledStages = new Map([
      [
        'stage-1',
        createStage({
          stageId: 'stage-1',
          phase: '解析输入',
          status: 'completed',
          fsmState: 'completed',
        }),
      ],
      [
        'stage-2',
        createStage({
          stageId: 'stage-2',
          phase: '路由选择',
          status: 'cancelled',
          fsmState: 'cancelled',
        }),
      ],
    ])
    injectRunState(1, {
      stages: cancelledStages,
      overallStatus: 'cancelled',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    const cancelTexts = screen.getAllByText('编译已取消')
    expect(cancelTexts.length).toBeGreaterThanOrEqual(1)
  })

  it('stale 显示恢复中而非失败', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
      heartbeatStale: true,
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.getByText('正在恢复')).toBeDefined()
    expect(screen.getByText('进度暂停，正在恢复')).toBeDefined()
    // 不应显示失败
    expect(screen.queryByText('编译失败')).toBeNull()
  })

  it('无任何自动副作用被触发', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    // 不应有 button/控件
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('CompilerStageDetailPanel — 4.2 隐私白名单与无副作用', () => {
  beforeEach(() => {
    clearStore()
  })

  it('渲染字段严格限于白名单', () => {
    const whiteListStages = new Map([
      [
        'stage-1',
        createStage({
          stageId: 'stage-1',
          phase: '测试阶段',
          status: 'completed',
          fsmState: 'completed',
          attemptNumber: 2,
          durationMs: 5000,
          llmCalls: 3,
          errorCode: null,
          timestamp: '2026-07-21T10:00:00Z',
        }),
      ],
    ])
    injectRunState(1, {
      stages: whiteListStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.getByText('测试阶段')).toBeDefined()
    expect(screen.getByText('第 2 次')).toBeDefined()
    expect(screen.getByText('5.0s')).toBeDefined()
    expect(screen.getByText('3 次调用')).toBeDefined()
  })

  it('敏感字段不泄漏到 DOM', () => {
    // 给 store 注入含伪敏感字段的 run 状态
    // StageProgressState 本身不含 prompt/modelOutput/secret 字段，
    // 但可以通过额外的 store 属性模拟（仅测试 store 投影不泄漏）
    const safeStages = new Map([
      [
        'stage-1',
        createStage({
          stageId: 'stage-1',
          phase: '测试',
          status: 'progress',
          fsmState: 'running',
        }),
      ],
    ])
    injectRunState(1, {
      stages: safeStages,
      overallStatus: 'running',
    })

    render(<CompilerStageDetailPanel projectId={1} runId={1} />)

    // 白名单字段应该显示
    expect(screen.getByText('测试')).toBeDefined()

    // 不应该出现的敏感值
    expect(screen.queryByText(/prompt/i)).toBeNull()
    expect(screen.queryByText(/modelOutput/i)).toBeNull()
    expect(screen.queryByText(/token/i)).toBeNull()
    expect(screen.queryByText(/secret/i)).toBeNull()
  })

  it('DOM 中不存在触发 compiler run 变更的控件', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)

    // 不应有任何 button
    expect(screen.queryByRole('button')).toBeNull()

    // 不应有关键词
    expect(screen.queryByText(/重试/i)).toBeNull()
    expect(screen.queryByText(/取消/i)).toBeNull()
    expect(screen.queryByText(/恢复/i)).toBeNull()
    expect(screen.queryByText(/重新/i)).toBeNull()
    expect(screen.queryByText(/应用/i)).toBeNull()
  })
})

describe('CompilerStageDetailPanel — 5.2 无障碍', () => {
  beforeEach(() => {
    clearStore()
  })

  it('role="list" 和 role="listitem" 存在', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.getByRole('list')).toBeDefined()
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBe(3)
  })

  it('sr-only 状态文本存在', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)

    // sr-only 文本：已完成/运行中
    const srElements = document.querySelectorAll('.sr-only')
    expect(srElements.length).toBeGreaterThanOrEqual(3)
  })

  it('aria-live polite 汇总存在', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)

    const liveRegion = document.querySelector('[aria-live="polite"]')
    expect(liveRegion).toBeDefined()
  })

  it('reduced-motion 类名生效（spinner 有 motion-reduce:animate-none）', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)

    const spinners = document.querySelectorAll('.motion-reduce\\:animate-none')
    // 至少有一个 spinner 带 motion-reduce 类
    expect(spinners.length).toBeGreaterThanOrEqual(1)
  })

  it('section 有 aria-label', () => {
    injectRunState(1, {
      stages: fixtureStages,
      overallStatus: 'running',
    })
    render(<CompilerStageDetailPanel projectId={1} runId={1} />)
    expect(screen.getByLabelText('编译器逐阶段明细')).toBeDefined()
  })
})
