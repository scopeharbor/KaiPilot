import * as React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { PROJECT_DRAFT_MODULES } from '@aiproj/types'
import { TheaterModuleConstructNode } from '@/components/next/3d/theater/TheaterModuleConstructNode'
import { TheaterConstellationCore } from '@/components/next/3d/theater/TheaterConstellationCore'
import { MODULE_COLORS } from '@/components/next/3d/theater/theater-scene-mapper'

// R3F jsdom 隔离 Mock 层

/** 从 DOM 节点沿 React fiber 读取元素 props/userData（jsdom 将对象型 userData 渲染为
 *  userdata="[object Object]" 不可用；fiber 上保留原始 props，结构断言走此桥）。
 *  生产侧 R3F 元数据通道已统一为 userData（R3F 对自定义 data-* 会抛错）。 */
interface FiberLike {
  memoizedProps?: Record<string, unknown> & { userData?: Record<string, unknown> }
  return?: FiberLike | null
}

function fiberOf(el: Element | null): FiberLike | null {
  if (!el) return null
  const key = Object.keys(el).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  )
  if (!key) return null
  return (el as unknown as Record<string, FiberLike>)[key] ?? null
}

function fiberProps(el: Element | null): Record<string, unknown> | null {
  return fiberOf(el)?.memoizedProps ?? null
}

function fiberUserData(el: Element | null): Record<string, unknown> | null {
  let fiber = fiberOf(el)
  while (fiber && !fiber.memoizedProps?.userData) fiber = fiber.return ?? null
  return fiber?.memoizedProps?.userData ?? null
}
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

describe('9 模块三维装配构件与星座拓扑契约测试（v3-next-layer1-theater-3d-m1 tasks 3.1 / 3.2 / 3.3）', () => {
  test('9 模块构件节点能够全部正常挂载，对应专属几何体标签就位', () => {
    for (const mod of PROJECT_DRAFT_MODULES) {
      const { container } = render(
        <TheaterModuleConstructNode
          module={mod}
          moduleStatus="pending"
          sceneMode="generating"
          tier="high"
        />,
      )
      const group = container.querySelector(`[data-testid="module-node-${mod}"]`)
      expect(group, `模块 ${mod} 构件节点应存在`).not.toBeNull()
      expect(fiberUserData(group)?.status).toBe('pending')
      expect(fiberUserData(group)?.module).toBe(mod)
    }
  })

  test('pending 状态输出透明线框材质契约（wireframe=true, opacity=0.25）', () => {
    const { container } = render(
      <TheaterModuleConstructNode
        module="charter"
        moduleStatus="pending"
        sceneMode="generating"
        tier="high"
      />,
    )
    const mat = container.querySelector('meshStandardMaterial')
    expect(mat).not.toBeNull()
    expect(fiberProps(mat)?.wireframe).toBe(true)
    expect(mat?.getAttribute('opacity')).toBe('0.25')
    expect(mat?.getAttribute('color')).toBe(MODULE_COLORS.charter)
  })

  test('generating 状态输出高亮实体材质与呼吸外轮廓（wireframe=false, opacity=0.85）', () => {
    const { container } = render(
      <TheaterModuleConstructNode
        module="wbs"
        moduleStatus="generating"
        sceneMode="generating"
        tier="high"
      />,
    )
    const mat = container.querySelector('meshStandardMaterial')
    expect(mat).not.toBeNull()
    expect(fiberProps(mat)?.wireframe).toBe(false)
    expect(mat?.getAttribute('opacity')).toBe('0.85')

    // high 档 generating 态额外呼吸外轮廓 mesh 就位
    const basicMat = container.querySelector('meshBasicMaterial')
    expect(basicMat).not.toBeNull()
    expect(basicMat?.getAttribute('wireframe')).toBeNull()
  })

  test('completed 状态输出晶化实体锁定材质（wireframe=false, opacity=1）', () => {
    const { container } = render(
      <TheaterModuleConstructNode
        module="tasks"
        moduleStatus="completed"
        sceneMode="generating"
        tier="high"
      />,
    )
    const mat = container.querySelector('meshStandardMaterial')
    expect(mat).not.toBeNull()
    expect(fiberProps(mat)?.wireframe).toBe(false)
    expect(mat?.getAttribute('opacity')).toBe('1')
  })

  test('failed 状态输出暗红警示线框材质（color=#ef4444, wireframe=true）', () => {
    const { container } = render(
      <TheaterModuleConstructNode
        module="risk"
        moduleStatus="failed"
        sceneMode="disrupted"
        tier="high"
      />,
    )
    const mat = container.querySelector('meshStandardMaterial')
    expect(mat).not.toBeNull()
    expect(fiberProps(mat)?.wireframe).toBe(true)
    expect(mat?.getAttribute('color')).toBe('#ef4444')
  })

  test('TheaterConstellationCore 正常渲染中央核心与 9 条拓扑连线导轨', () => {
    const { container, unmount } = render(
      <TheaterConstellationCore
        sceneMode="generating"
        moduleStatuses={{
          charter: 'completed',
          wbs: 'generating',
          tasks: 'pending',
        }}
        tier="high"
      />,
    )

    // 中央核心
    const coreGroup = container.querySelector('[data-testid="constellation-core-group"]')
    expect(coreGroup).not.toBeNull()

    // 9 条拓扑连线全部挂载
    for (const mod of PROJECT_DRAFT_MODULES) {
      const rail = container.querySelector(`[data-testid="rail-${mod}"]`)
      expect(rail, `拓扑连线 rail-${mod} 应存在`).not.toBeNull()
    }

    // 卸载生命周期显存释放零异常抛出
    expect(() => unmount()).not.toThrow()
  })
})
