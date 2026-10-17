import * as React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import * as THREE from 'three'
import { LoginSpaceScene } from '@/components/next/3d/login/LoginSpaceScene'
import { ProceduralNebula } from '@/components/next/3d/login/ProceduralNebula'
import { InstancedStarfield } from '@/components/next/3d/login/InstancedStarfield'
import { VolumetricCore } from '@/components/next/3d/login/VolumetricCore'

// R3F jsdom 隔离 Mock 层（遵循 design.md Decision 8）
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div data-testid="r3f-canvas-mock" aria-hidden="true" {...props}>
      {children}
    </div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({
    camera: { position: { x: 0, y: 0, z: 5 }, lookAt: vi.fn() },
    pointer: { x: 0, y: 0 },
    clock: { getElapsedTime: () => 0 },
    gl: { domElement: document.createElement('canvas') },
  }),
}))

describe('深空场景图结构契约测试（v3-next-layer1-login-3d-m0 任务 3.3）', () => {
  test('深空场景底座集成基础环境光、方向光与深空指数雾', () => {
    const { container } = render(<LoginSpaceScene tier="high" />)

    // 验证指数雾 FogExp2 契约参数
    const fog = container.querySelector('fogExp2')
    expect(fog).not.toBeNull()
    expect(fog?.getAttribute('args')).toContain('#05070f')
    expect(fog?.getAttribute('args')).toContain('0.08')

    // 验证环境光与方向光
    const ambientLight = container.querySelector('ambientLight')
    expect(ambientLight).not.toBeNull()
    expect(ambientLight?.getAttribute('intensity')).toBe('0.4')

    const directionalLight = container.querySelector('directionalLight')
    expect(directionalLight).not.toBeNull()
    expect(directionalLight?.getAttribute('intensity')).toBe('0.8')
  })

  test('沉浸档（high）与轻量档（low）下的实例化粒子规模契约', () => {
    // 沉浸档：2000 个粒子
    const { container: highContainer } = render(<LoginSpaceScene tier="high" />)
    const highMesh = highContainer.querySelector('instancedMesh')
    expect(highMesh).not.toBeNull()
    expect(highMesh?.getAttribute('args')).toContain('2000')

    // 轻量档：降至 400 个粒子
    const { container: lowContainer } = render(<LoginSpaceScene tier="low" />)
    const lowMesh = lowContainer.querySelector('instancedMesh')
    expect(lowMesh).not.toBeNull()
    expect(lowMesh?.getAttribute('args')).toContain('400')
  })

  test('程序化星云 ProceduralNebula 材质契约：加法混合且禁用深度写入', () => {
    const { container } = render(<ProceduralNebula tier="high" />)
    const shaderMat = container.querySelector('shaderMaterial')
    expect(shaderMat).not.toBeNull()
    // 混合模式为加法混合（THREE.AdditiveBlending === 2）
    expect(shaderMat?.getAttribute('blending')).toBe(String(THREE.AdditiveBlending))
    // React DOM 中 depthWrite={false} 作为布尔属性不序列化，即为 null（禁用深度写入）
    expect(shaderMat?.getAttribute('depthwrite')).toBeNull()
  })

  test('实例化星野 InstancedStarfield 材质契约：加法混合且禁用深度写入', () => {
    const { container } = render(<InstancedStarfield count={2000} tier="high" />)
    const basicMat = container.querySelector('meshBasicMaterial')
    expect(basicMat).not.toBeNull()
    expect(basicMat?.getAttribute('blending')).toBe(String(THREE.AdditiveBlending))
    expect(basicMat?.getAttribute('depthwrite')).toBeNull()
  })

  test('深空核心 VolumetricCore 渲染双层几何结构与加法材质', () => {
    const { container } = render(<VolumetricCore tier="high" />)
    const meshes = container.querySelectorAll('mesh')
    expect(meshes.length).toBeGreaterThanOrEqual(2)

    const materials = container.querySelectorAll('meshBasicMaterial')
    materials.forEach((mat) => {
      expect(mat.getAttribute('blending')).toBe(String(THREE.AdditiveBlending))
      expect(mat.getAttribute('depthwrite')).toBeNull()
    })
  })
})
