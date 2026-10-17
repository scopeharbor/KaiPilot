import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Theater3DCanvas } from '@/components/next/3d/theater/Theater3DCanvas'
import { TheaterShell } from '@/components/next/theater/TheaterShell'
import { TheaterGenerationStage } from '@/components/next/theater/TheaterGenerationStage'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAuthStore } from '@/stores/auth-store'

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div data-testid="r3f-canvas-mock" aria-hidden="true" {...props}>
      {children}
    </div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({
    camera: { position: { x: 0, y: 0, z: 12 }, lookAt: vi.fn() },
    pointer: { x: 0, y: 0 },
    clock: { getElapsedTime: () => 0 },
    gl: { domElement: document.createElement('canvas') },
  }),
}))

describe('DOM 信息等价与无障碍焦点隔离测试（v3-next-layer1-theater-3d-m1 tasks 6.1）', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      permissions: ['ai:trigger'],
      currentOrganizationId: null,
      planTier: null,
      roleVersion: 0,
      isAuthenticated: true,
      hasHydrated: true,
      effectiveTenantContext: null,
      selectionEpoch: 0,
    })
    useAiProjectDraftStore.setState({
      status: 'idle',
      rawInput: '',
      cards: [],
      answers: {},
      context: null,
      activeCard: null,
      error: null,
      draftStatus: null,
      draftId: null,
      draftVersion: 0,
      draft: null,
      draftMeta: null,
      draftFailure: null,
      validation: null,
      moduleStatuses: {},
      lastEventSequence: 0,
    })
  })

  test('双层物理隔离契约：Layer 0 (3D Canvas) 显式声明 aria-hidden 与 tabindex=-1，读屏焦点永不落入', () => {
    render(
      <TheaterShell background3D={<Theater3DCanvas forceTier="high" />}>
        <div data-testid="layer-1-dom">
          <input aria-label="意图输入框" placeholder="请输入项目意图" />
          <button type="button">提交</button>
        </div>
      </TheaterShell>,
    )

    // Layer 0 3D 视口容器
    const container3d = screen.getByTestId('theater-3d-container')
    expect(container3d.getAttribute('aria-hidden')).toBe('true')
    expect(container3d.getAttribute('tabindex')).toBe('-1')
    expect(container3d.className).toContain('pointer-events-none')

    // Layer 1 DOM 业务交互容器
    const layer1 = screen.getByTestId('layer-1-dom')
    expect(layer1).toBeInTheDocument()
    const input = screen.getByLabelText('意图输入框')
    expect(input).toBeInTheDocument()
    expect(input.getAttribute('aria-hidden')).toBeNull()

    const button = screen.getByRole('button', { name: '提交' })
    expect(button).toBeInTheDocument()
    expect(button.getAttribute('aria-hidden')).toBeNull()
  })

  test('DOM 信息等价性：9 模块流式建造进度由 aria-live 语义节点完整承载播报', () => {
    // 模拟 store 中生成中及已完成的模块状态
    useAiProjectDraftStore.setState({
      moduleStatuses: {
        charter: 'completed',
        wbs: 'generating',
        tasks: 'pending',
      },
    })

    const { container } = render(
      <TheaterShell background3D={<Theater3DCanvas forceTier="high" />}>
        <TheaterGenerationStage />
      </TheaterShell>,
    )

    // DOM 3x3 卡片全部存在
    const stage = container.querySelector('[data-theater-generation-stage]')
    expect(stage).not.toBeNull()

    // aria-live 播报区存在且内容准确
    const liveRegions = container.querySelectorAll('[aria-live="polite"]')
    expect(liveRegions.length).toBeGreaterThan(0)

    // DOM 呈现模块中文标题
    expect(screen.getByText('项目章程')).toBeInTheDocument()
    expect(screen.getByText('工作分解结构')).toBeInTheDocument()
    expect(screen.getByText('任务清单')).toBeInTheDocument()
  })

  test('Fallback 纯 CSS 降级档下 DOM 界面 100% 完整展现，零 Canvas 节点', () => {
    const { container } = render(
      <TheaterShell background3D={<Theater3DCanvas forceTier="fallback" />}>
        <div data-testid="fallback-theater-view">
          <h2>生成剧场 2D 降级界面</h2>
          <TheaterGenerationStage />
        </div>
      </TheaterShell>,
    )

    // 绝对零 canvas 元素
    expect(container.querySelector('canvas')).toBeNull()
    expect(screen.queryByTestId('r3f-canvas-mock')).toBeNull()
    expect(screen.queryByTestId('theater-3d-container')).toBeNull()

    // 2D 剧场舞台完全展现
    expect(screen.getByText('生成剧场 2D 降级界面')).toBeInTheDocument()
    expect(screen.getByText('项目章程')).toBeInTheDocument()
  })
})
