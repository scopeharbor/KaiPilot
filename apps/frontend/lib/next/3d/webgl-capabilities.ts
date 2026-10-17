/**
 * 设备 WebGL 能力探测探针与三档降级决策
 *
 * 规范遵循：v3-next-layer1-login-3d-m0 design.md Decision 3
 * 执行耗时严格控制在 < 2ms 内，不阻塞任何 DOM 渲染。
 */

export interface WebGLCapabilities {
  supported: boolean
  isSoftwareRenderer: boolean
  reducedMotion: boolean
  tier: 'high' | 'low' | 'fallback'
}

export function probeWebGLCapabilities(): WebGLCapabilities {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      isSoftwareRenderer: false,
      reducedMotion: false,
      tier: 'fallback',
    }
  }

  const reducedMotion =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false

  const isPreciseMode =
    typeof document !== 'undefined' && Boolean(document.documentElement)
      ? document.documentElement.getAttribute('data-immersion') === 'precise'
      : false

  // 无障碍或精确模式直接切入降级档（零 Canvas 零 WebGL）
  if (reducedMotion || isPreciseMode) {
    return {
      supported: true,
      isSoftwareRenderer: false,
      reducedMotion,
      tier: 'fallback',
    }
  }

  let gl2: WebGL2RenderingContext | null = null
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null

  try {
    const canvas = document.createElement('canvas')
    gl2 = canvas.getContext('webgl2')
    gl = gl2 || canvas.getContext('webgl')
  } catch {
    return {
      supported: false,
      isSoftwareRenderer: false,
      reducedMotion: false,
      tier: 'fallback',
    }
  }

  if (!gl) {
    return {
      supported: false,
      isSoftwareRenderer: false,
      reducedMotion: false,
      tier: 'fallback',
    }
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  let renderer = ''
  if (debugInfo) {
    renderer = (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string) || ''
  }

  // CPU 软件模拟渲染器（SwiftShader / llvmpipe / Software Rasterizer / Microsoft Basic Render）：
  // 降为 low 静态帧档（DPR 1.0 + 400 粒子 + frameloop demand 单帧冻结）——让 3D 在软渲染
  // 环境依然可见（否则无独显/远程桌面用户永远看不到 Layer 1 场景，误以为 3D 不存在）；
  // 单帧渲染后渲染循环冻结，软渲染也不产生持续 CPU 开销。
  const isSoftware = /swiftshader|llvmpipe|software rasterizer|microsoft basic render/i.test(
    renderer,
  )
  if (isSoftware) {
    return {
      supported: true,
      isSoftwareRenderer: true,
      reducedMotion: false,
      tier: 'low',
    }
  }

  // 移动端低端芯片或仅支持 WebGL1 降为 low 档
  const isLowTierGpu = !gl2 || /mali-4|adreno (3|4|505)|apple a[7-9]/i.test(renderer)
  return {
    supported: true,
    isSoftwareRenderer: false,
    reducedMotion: false,
    tier: isLowTierGpu ? 'low' : 'high',
  }
}
