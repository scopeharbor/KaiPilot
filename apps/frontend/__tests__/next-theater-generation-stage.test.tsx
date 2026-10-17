/**
 * v3-ui-next-theater-generation tasks 2.5 —— 9 模块场景舞台矩阵与健康提示条。
 *
 * 覆盖：9 模块固定顺序渲染、moduleStatuses 独立驱动、stale / reconnecting 非阻塞
 * 提示条与已完成模块保留、精确档降级（data-immersion + CSS 停用规则）与文案红线。
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PROJECT_DRAFT_MODULES } from '@aiproj/types'
import {
  createDraftProgressProjection,
  type DraftProgressHealthState,
} from '@/lib/ai-draft/progress-projection'
import { TheaterGenerationStage } from '@/components/next/theater/TheaterGenerationStage'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useNextTrackStore } from '@/stores/next-track-store'

const FORBIDDEN_PHRASES = [
  '项目已创建',
  '项目已完成',
  '创建成功',
  '项目创建完毕',
  '正式项目已入库',
  '已写入数据库',
]

const defaultMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

function resetDraftStore() {
  useAiProjectDraftStore.setState({
    status: 'ready',
    rawInput: '测试意图',
    cards: [],
    answers: {},
    context: null,
    error: null,
    draftStatus: 'drafting',
    draftId: 'draft-test-1',
    draftVersion: 1,
    draft: null,
    draftMeta: null,
    draftFailure: null,
    validation: null,
    moduleStatuses: {},
    lastEventSequence: 0,
    progressProjection: createDraftProgressProjection({
      draftId: 'draft-test-1',
      version: 1,
      connection: 'live',
    }),
    streamOutput: '',
    streamOutputActive: false,
    pendingModifications: [],
  })
}

function setHealth(healthState: DraftProgressHealthState) {
  useAiProjectDraftStore.setState({
    progressProjection: {
      ...createDraftProgressProjection({ draftId: 'draft-test-1', version: 1, connection: 'live' }),
      healthState,
    },
  })
}

describe('components/next/theater/TheaterGenerationStage（v3-ui-next-theater-generation 任务 2.4-2.5）', () => {
  beforeEach(() => {
    useNextTrackStore.getState().reset()
    window.matchMedia = defaultMatchMedia
    document.documentElement.removeAttribute('data-immersion')
    resetDraftStore()
  })

  test('初始化：9 模块按契约固定顺序全置于蓝图待建态（3x3 响应式矩阵）', () => {
    const { container } = render(<TheaterGenerationStage />)

    const cards = container.querySelectorAll('[data-construct-card]')
    expect(cards).toHaveLength(9)
    const renderedModules = Array.from(cards).map((card) =>
      card.getAttribute('data-construct-module'),
    )
    expect(renderedModules).toEqual([...PROJECT_DRAFT_MODULES])
    for (const card of Array.from(cards)) {
      expect(card.getAttribute('data-construct-state')).toBe('pending')
    }
    expect(container.querySelector('[data-module-matrix]')?.className).toContain('grid-cols-1')
    expect(container.querySelector('[data-module-matrix]')?.className).toContain('md:grid-cols-3')
    // 零画布约束（RL-15）
    expect(container.querySelector('canvas')).toBeNull()
  })

  test('moduleStatuses 独立驱动：completed / generating / pending 混合呈现', () => {
    useAiProjectDraftStore.setState({
      moduleStatuses: {
        charter: 'completed',
        wbs: 'completed',
        tasks: 'generating',
        dependencies: 'failed',
      },
    })
    const { container } = render(<TheaterGenerationStage />)

    expect(
      container
        .querySelector('[data-construct-module="charter"]')
        ?.getAttribute('data-construct-state'),
    ).toBe('completed')
    expect(
      container
        .querySelector('[data-construct-module="wbs"]')
        ?.getAttribute('data-construct-state'),
    ).toBe('completed')
    expect(
      container
        .querySelector('[data-construct-module="tasks"]')
        ?.getAttribute('data-construct-state'),
    ).toBe('generating')
    expect(
      container
        .querySelector('[data-construct-module="dependencies"]')
        ?.getAttribute('data-construct-state'),
    ).toBe('failed')
    // 未在 statuses 中的键回退 pending
    expect(
      container
        .querySelector('[data-construct-module="acceptance"]')
        ?.getAttribute('data-construct-state'),
    ).toBe('pending')
    // 进度计数随真实状态归约（RL-07：无任何自增）
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByText(/已完成/).length).toBeGreaterThan(0)
  })

  test('生成中模块展示 service 事件驱动的流式 phase 子说明', () => {
    useAiProjectDraftStore.setState({
      moduleStatuses: { wbs: 'generating' },
      progressProjection: {
        ...createDraftProgressProjection({
          draftId: 'draft-test-1',
          version: 1,
          connection: 'live',
        }),
        phase: 'receiving',
      },
    })
    render(<TheaterGenerationStage />)

    const wbsDetail = document.querySelector(
      '[data-construct-module="wbs"] [data-construct-detail]',
    )
    expect(wbsDetail?.textContent).toBe('正在接收草案结构')
    // 读屏节点同步播报（aria-live 双通道）
    expect(document.querySelector('[data-stage-live]')?.textContent).toContain(
      '草案模块生成进度：正在建造工作分解结构，已完成 0 个，共 9 个模块。',
    )
  })

  test('停滞恢复提示条：stale 浮现「连接暂时停滞，正在尝试恢复连接」且已完成模块坚实保留', () => {
    useAiProjectDraftStore.setState({
      moduleStatuses: { charter: 'completed', wbs: 'completed', tasks: 'generating' },
    })
    setHealth('stale')
    const { container } = render(<TheaterGenerationStage />)

    const banner = container.querySelector('[data-health-banner="stale"]') as HTMLElement
    expect(banner).toBeTruthy()
    expect(banner.getAttribute('role')).toBe('status')
    expect(screen.getByText('连接暂时停滞，正在尝试恢复连接')).toBeInTheDocument()
    // 已完成模块不回退为空白蓝图（design D4 关键防御）
    expect(
      container
        .querySelector('[data-construct-module="charter"]')
        ?.getAttribute('data-construct-state'),
    ).toBe('completed')
    expect(
      container
        .querySelector('[data-construct-module="wbs"]')
        ?.getAttribute('data-construct-state'),
    ).toBe('completed')
    // 生成中模块保持脉冲建造态
    expect(
      container
        .querySelector('[data-construct-module="tasks"]')
        ?.getAttribute('data-construct-state'),
    ).toBe('generating')
  })

  test('reconnecting 浮现「正在重新建立进度连接」，healthy / long_running 不浮现提示条', () => {
    setHealth('reconnecting')
    const reconnecting = render(<TheaterGenerationStage />)
    expect(reconnecting.container.querySelector('[data-health-banner]')).toBeTruthy()
    expect(screen.getByText('正在重新建立进度连接')).toBeInTheDocument()
    reconnecting.unmount()

    resetDraftStore()
    setHealth('healthy')
    const healthy = render(<TheaterGenerationStage />)
    expect(healthy.container.querySelector('[data-health-banner]')).toBeNull()
    healthy.unmount()

    resetDraftStore()
    setHealth('long_running')
    const longRunning = render(<TheaterGenerationStage />)
    expect(longRunning.container.querySelector('[data-health-banner]')).toBeNull()
  })

  test('healthState 受控覆盖：装配层/测试可注入，优先于 store', () => {
    render(<TheaterGenerationStage healthState="reconnecting" />)
    expect(screen.getByText('正在重新建立进度连接')).toBeInTheDocument()
  })

  test('多生成模块：仅首个生成模块接收全局 phase 子说明，其余用模块缺省文案', () => {
    useAiProjectDraftStore.setState({
      moduleStatuses: { wbs: 'generating', tasks: 'generating' },
      progressProjection: {
        ...createDraftProgressProjection({
          draftId: 'draft-test-1',
          version: 1,
          connection: 'live',
        }),
        phase: 'validating',
      },
    })
    render(<TheaterGenerationStage />)

    expect(
      document.querySelector('[data-construct-module="wbs"] [data-construct-detail]')?.textContent,
    ).toBe('正在检查日期、依赖与完整性')
    expect(
      document.querySelector('[data-construct-module="tasks"] [data-construct-detail]')
        ?.textContent,
    ).toBe('正在生成任务条目')
  })

  test('精确档（precise）：舞台根回显 data-immersion，CSS 停用规则注入，阶段计数清晰直陈', () => {
    useNextTrackStore.getState().setImmersionTier('precise')
    const { container } = render(<TheaterGenerationStage />)

    expect(
      container.querySelector('[data-theater-generation-stage]')?.getAttribute('data-immersion'),
    ).toBe('precise')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
    const styleEl = container.querySelector('style[data-nx-theater-module-css]')
    expect(styleEl?.textContent).toContain("[data-immersion='precise'] .nx-construct-pulse")
    expect(styleEl?.textContent).toContain('animation: none !important')
    expect(styleEl?.textContent).toContain('@media (prefers-reduced-motion: reduce)')
  })

  test('系统减弱动效偏好自动降级为精确档（precise）', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const { container } = render(<TheaterGenerationStage />)
    expect(
      container.querySelector('[data-theater-generation-stage]')?.getAttribute('data-immersion'),
    ).toBe('precise')
  })

  test('summaries 覆盖：完成态微摘要由装配层投影（如「已生成 12 项任务」）', () => {
    useAiProjectDraftStore.setState({ moduleStatuses: { tasks: 'completed' } })
    render(<TheaterGenerationStage summaries={{ tasks: '已生成 12 项任务' }} />)
    expect(screen.getByText('已生成 12 项任务')).toBeInTheDocument()
  })

  test('文案审查红线：舞台全文本、ARIA 标签与读屏播报均无「项目已创建」类措辞', () => {
    useAiProjectDraftStore.setState({
      moduleStatuses: {
        charter: 'completed',
        wbs: 'generating',
        risk: 'failed',
      },
    })
    setHealth('stale')
    const { container } = render(<TheaterGenerationStage />)

    const text = container.textContent ?? ''
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(text).not.toContain(phrase)
    }
    const liveText = container.querySelector('[data-stage-live]')?.textContent ?? ''
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(liveText).not.toContain(phrase)
    }
  })
})
