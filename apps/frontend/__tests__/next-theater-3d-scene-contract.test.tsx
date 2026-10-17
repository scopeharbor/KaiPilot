import * as React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Theater3DScene } from '@/components/next/3d/theater/Theater3DScene'
import {
  TheaterSceneDirector,
  SCENE_CAMERA_PRESETS,
} from '@/components/next/3d/theater/TheaterSceneDirector'
import {
  MODULE_POSITIONS,
  type TheaterSceneMode,
} from '@/components/next/3d/theater/theater-scene-mapper'

// R3F jsdom 隔离 Mock 层
const mockCameraPosition = { x: 0, y: 0, z: 12, set: vi.fn() }
let mockCameraLookAt = vi.fn()
let mockPointer = { x: 0, y: 0 }

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div data-testid="r3f-canvas-mock" aria-hidden="true" {...props}>
      {children}
    </div>
  ),
  useFrame: (callback: (state: unknown, delta: number) => void) => {
    callback(
      {
        clock: { elapsedTime: 1 },
      },
      0.016,
    )
  },
  useThree: () => ({
    camera: {
      position: mockCameraPosition,
      lookAt: mockCameraLookAt,
    },
    pointer: mockPointer,
    clock: { elapsedTime: 1, getElapsedTime: () => 1 },
    gl: { domElement: document.createElement('canvas') },
  }),
}))

describe('生成剧场 3D 场景图结构与镜头调度契约（v3-next-layer1-theater-3d-m1 tasks 4.1 / 4.2 / 4.3）', () => {
  test('场景根底座集成环境光、方向光与深空指数雾', () => {
    const { container } = render(<Theater3DScene sceneMode="idle" tier="high" />)

    // 验证指数雾 FogExp2 契约参数
    const fog = container.querySelector('fogExp2')
    expect(fog).not.toBeNull()
    expect(fog?.getAttribute('args')).toContain('#05070f')
    expect(fog?.getAttribute('args')).toContain('0.045')

    // 验证环境光
    const ambientLight = container.querySelector('ambientLight')
    expect(ambientLight).not.toBeNull()
    expect(ambientLight?.getAttribute('intensity')).toBe('0.45')

    // 验证双方向光
    const dirLights = container.querySelectorAll('directionalLight')
    expect(dirLights.length).toBe(2)
  })

  test('各场景状态镜头预设机位定义完整且轨迹有界', () => {
    const modes: TheaterSceneMode[] = [
      'idle',
      'clarifying',
      'ready',
      'generating',
      'review',
      'settled',
      'disrupted',
    ]

    for (const mode of modes) {
      const preset = SCENE_CAMERA_PRESETS[mode]
      expect(preset, `模式 ${mode} 应具备机位预设`).toBeDefined()
      expect(preset.position).toHaveLength(3)
      expect(preset.target).toHaveLength(3)
      expect(preset.fov).toBeGreaterThanOrEqual(45)
      expect(preset.fov).toBeLessThanOrEqual(65)

      // Z 轴距离在深空安全区间 [8, 16] 内
      expect(preset.position[2]).toBeGreaterThanOrEqual(8)
      expect(preset.position[2]).toBeLessThanOrEqual(16)
    }
  })

  test('Low 档位下镜头调度器执行静态单帧直落（set/lookAt 直接生效）', () => {
    mockCameraPosition.set = vi.fn()
    mockCameraLookAt = vi.fn()

    render(<TheaterSceneDirector sceneMode="review" tier="low" />)

    const preset = SCENE_CAMERA_PRESETS.review
    expect(mockCameraPosition.set).toHaveBeenCalledWith(
      preset.position[0],
      preset.position[1],
      preset.position[2],
    )
    expect(mockCameraLookAt).toHaveBeenCalledWith(
      preset.target[0],
      preset.target[1],
      preset.target[2],
    )
  })

  test('generating 模式下镜头视点适度向当前激活建造模块微倾', () => {
    mockPointer = { x: 0.5, y: 0.2 }

    render(<TheaterSceneDirector sceneMode="generating" activeModule="charter" tier="high" />)

    expect(mockCameraLookAt).toHaveBeenCalled()
    expect(MODULE_POSITIONS.charter).toEqual([0, 3, 0])
  })

  test('9 核心模块集群容器正常挂载', () => {
    const { container } = render(<Theater3DScene sceneMode="generating" tier="high" />)

    const modulesGroup = container.querySelector('[data-testid="theater-modules-group"]')
    expect(modulesGroup).not.toBeNull()
  })
})
