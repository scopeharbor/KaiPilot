/**
 * Cinematic 技术补齐专项测试（v3-next-cinematic-techniques-completion）。
 *
 * 覆盖：
 * - 登录场景三段命名空间构图（world-background / world-midground / world-foreground）；
 * - 三档 tier 下场景均可渲染不崩（后处理仅在 high 档生效，low/fallback 守卫）；
 * - 前景剪纸层（ForegroundCutout）DOM 契约：存在、aria-hidden、pointer-events-none；
 * - 电影级品牌排版块（data-login-brand）：存在且含品牌语义；
 * - 导演镜头组契约（CAMERA_SHOT_LIST）：三机位、fov 递减、参数合法。
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { LoginSpaceScene } from '@/components/next/3d/login/LoginSpaceScene'
import { ForegroundCutout } from '@/components/next/3d/shared/ForegroundCutout'
import { NextLoginForm } from '@/components/next/auth/NextLoginForm'
import { CAMERA_SHOT_LIST } from '@/components/next/3d/spacemap/SpaceMapCameraController'

// R3F jsdom 隔离 Mock 层（与 next-space-scene-contract 同款）
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

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('登录场景三段空间构图（Cinematic World Builder 落地）', () => {
  test('场景包含 背景/中景/前景 三段命名空间（导演台本层次）', () => {
    const { container } = render(<LoginSpaceScene tier="high" />)
    expect(container.querySelector('group[name="world-background"]')).not.toBeNull()
    expect(container.querySelector('group[name="world-midground"]')).not.toBeNull()
    expect(container.querySelector('group[name="world-foreground"]')).not.toBeNull()
  })

  test('三档 tier 场景均可渲染（后处理 low/fallback 守卫不崩）', () => {
    for (const tier of ['high', 'low', 'fallback'] as const) {
      const { container, unmount } = render(<LoginSpaceScene tier={tier} />)
      expect(container.querySelector('group[name="world-background"]')).not.toBeNull()
      unmount()
    }
  })
})

describe('前景剪纸层（Foreground Cutout）', () => {
  test('剪纸层存在且为纯氛围（aria-hidden + pointer-events-none）', () => {
    const { container } = render(<ForegroundCutout />)
    const layer = container.querySelector('[data-foreground-cutout]')
    expect(layer).not.toBeNull()
    expect(layer?.getAttribute('aria-hidden')).toBe('true')
    expect(layer?.className).toContain('pointer-events-none')
  })

  test('登录页挂载剪纸层与品牌排版块', () => {
    const { container } = render(<NextLoginForm />)
    expect(container.querySelector('[data-foreground-cutout]')).not.toBeNull()
    const brand = container.querySelector('[data-login-brand]')
    expect(brand).not.toBeNull()
    expect(brand?.textContent).toContain('开项')
    expect(brand?.textContent).toContain('KAIPILOT')
    expect(brand?.textContent).toContain('一句话启动项目')
  })
})

describe('导演镜头组契约（Cinematic Camera Director）', () => {
  test('三机位齐备且 fov 递增收敛（概览→巡游→特写）', () => {
    const shots = Object.values(CAMERA_SHOT_LIST)
    expect(shots.map((shot) => shot.id)).toEqual(['overview', 'sector', 'closeup'])
    expect(shots.map((shot) => shot.label)).toEqual(['全景概览', '星区巡游', '特写凝视'])
    const fovs = shots.map((shot) => shot.fov)
    expect(fovs[0]).toBeGreaterThan(fovs[1]!)
    expect(fovs[1]).toBeGreaterThan(fovs[2]!)
    shots.forEach((shot) => {
      expect(shot.position).toHaveLength(3)
      expect(shot.target).toHaveLength(3)
      expect(shot.fov).toBeGreaterThan(30)
      expect(shot.fov).toBeLessThan(70)
    })
  })
})
