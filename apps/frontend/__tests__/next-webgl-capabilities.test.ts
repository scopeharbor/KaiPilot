import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { probeWebGLCapabilities } from '@/lib/next/3d/webgl-capabilities'

describe('设备 WebGL 能力探测探针（v3-next-layer1-login-3d-m0 任务 2.2/2.3）', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    document.documentElement.removeAttribute('data-immersion')
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext
    window.matchMedia = originalMatchMedia
    document.documentElement.removeAttribute('data-immersion')
    vi.restoreAllMocks()
  })

  function createMockGL(rendererString: string, isWebGL2 = true) {
    const mockExtension = {
      UNMASKED_RENDERER_WEBGL: 37446,
    }
    const mockContext = {
      getExtension: vi.fn((extName: string) => {
        if (extName === 'WEBGL_debug_renderer_info') {
          return mockExtension
        }
        return null
      }),
      getParameter: vi.fn((pname: number) => {
        if (pname === 37446) {
          return rendererString
        }
        return null
      }),
    }
    return { mockContext, isWebGL2 }
  }

  test('主流独立显卡/支持 WebGL2：探测输出 high 沉浸档', () => {
    const { mockContext } = createMockGL(
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090, OpenGL 4.6)',
      true,
    )

    HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
      if (contextId === 'webgl2') return mockContext as unknown as RenderingContext
      return null
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext

    const caps = probeWebGLCapabilities()
    expect(caps).toEqual({
      supported: true,
      isSoftwareRenderer: false,
      reducedMotion: false,
      tier: 'high',
    })
  })

  test('主流 Apple Silicon GPU：探测输出 high 沉浸档', () => {
    const { mockContext } = createMockGL('Apple M3 Max', true)

    HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
      if (contextId === 'webgl2') return mockContext as unknown as RenderingContext
      return null
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext

    const caps = probeWebGLCapabilities()
    expect(caps.tier).toBe('high')
    expect(caps.supported).toBe(true)
  })

  test('低端移动端 GPU（如 Adreno 505 / Mali-400）：降为 low 轻量档', () => {
    const { mockContext } = createMockGL('Adreno 505', true)

    HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
      if (contextId === 'webgl2') return mockContext as unknown as RenderingContext
      return null
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext

    const caps = probeWebGLCapabilities()
    expect(caps).toEqual({
      supported: true,
      isSoftwareRenderer: false,
      reducedMotion: false,
      tier: 'low',
    })
  })

  test('仅支持 WebGL1 不支持 WebGL2：降为 low 轻量档', () => {
    const { mockContext } = createMockGL('Mali-G78', false)

    HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
      if (contextId === 'webgl2') return null
      if (contextId === 'webgl') return mockContext as unknown as RenderingContext
      return null
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext

    const caps = probeWebGLCapabilities()
    expect(caps.tier).toBe('low')
    expect(caps.supported).toBe(true)
  })

  test('CPU 软渲染器（SwiftShader / llvmpipe / Basic Render）：降为 low 静态帧档（可见但零持续开销）', () => {
    const softwareRenderers = [
      'Google SwiftShader',
      'llvmpipe (LLVM 12.0.0, 256 bits)',
      'Microsoft Basic Render Driver',
      'Software Rasterizer',
    ]

    for (const renderer of softwareRenderers) {
      const { mockContext } = createMockGL(renderer, true)
      HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
        if (contextId === 'webgl2') return mockContext as unknown as RenderingContext
        return null
      }) as unknown as typeof HTMLCanvasElement.prototype.getContext

      const caps = probeWebGLCapabilities()
      expect(caps, `预期软渲染降 low 静态帧档: ${renderer}`).toEqual({
        supported: true,
        isSoftwareRenderer: true,
        reducedMotion: false,
        tier: 'low',
      })
    }
  })

  test('环境无 WebGL 支持（getContext 返回 null）：输出 fallback 降级档', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null)

    const caps = probeWebGLCapabilities()
    expect(caps).toEqual({
      supported: false,
      isSoftwareRenderer: false,
      reducedMotion: false,
      tier: 'fallback',
    })
  })

  test('开启 prefers-reduced-motion 减弱动效：强制切入 fallback 降级档', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
    })

    const caps = probeWebGLCapabilities()
    expect(caps.tier).toBe('fallback')
    expect(caps.reducedMotion).toBe(true)
  })

  test('开启 data-immersion="precise" 精确模式：强制切入 fallback 降级档', () => {
    document.documentElement.setAttribute('data-immersion', 'precise')

    const caps = probeWebGLCapabilities()
    expect(caps.tier).toBe('fallback')
  })

  test('探针执行耗时约束：单次同步执行 < 2ms', () => {
    const { mockContext } = createMockGL('NVIDIA GeForce RTX 3080', true)
    HTMLCanvasElement.prototype.getContext = vi
      .fn()
      .mockReturnValue(mockContext as unknown as RenderingContext)

    const start = performance.now()
    for (let i = 0; i < 50; i++) {
      probeWebGLCapabilities()
    }
    const elapsed = performance.now() - start
    const averageTime = elapsed / 50

    expect(averageTime).toBeLessThan(2.0)
  })

  test('getContext 抛错（如 jsdom 未实现或权限策略阻拦）：捕获异常并返回 fallback 降级档', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(() => {
      throw new Error('Not implemented: HTMLCanvasElement.prototype.getContext')
    })

    expect(() => {
      const caps = probeWebGLCapabilities()
      expect(caps).toEqual({
        supported: false,
        isSoftwareRenderer: false,
        reducedMotion: false,
        tier: 'fallback',
      })
    }).not.toThrow()
  })
})
