'use client'

/**
 * Cinematic Post Processing（免库后处理通道，v3-next-cinematic-techniques-completion D2）。
 *
 * 不引入 postprocessing/@react-three/postprocessing（守住 3D chunk ≤250KB 门禁）：
 * 手写 FBO 后处理——主场景渲染进帧缓冲，再用全屏三角形 shader 合成到屏幕：
 * - vignette：电影级暗角（径向平滑衰减，强度封顶 0.45，防过曝发黑）；
 * - bloom-lite：高亮度轻微外扩提升（非真模糊，luma 阈值的加法提升，克制）；
 * - film grain：细颗粒噪点（时间驱动 hash，强度 ≤0.06，不产生「脏屏」）；
 * - filmic curve：轻微 S 曲线对比（避免蓝紫渐变式的廉价感）。
 *
 * 仅 high 档启用；low/fallback 档不挂载（零额外 draw call）。
 * 防 Slop 纪律：全部效果参数来自 world-builder spec，硬编码上限保护。
 */

import * as React from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { WorldPostSpec } from '@/lib/next/3d/world-builder'

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uVignette;
uniform float uBloomLite;
uniform float uGrain;
uniform float uTime;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec3 color = texture2D(tDiffuse, vUv).rgb;

  // filmic S 曲线（克制对比，防廉价渐变感）
  color = mix(color, color * color * (3.0 - 2.0 * color), 0.18);

  // bloom-lite：高亮度区轻微提升（模拟辉光外扩而不做真模糊）
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color += color * smoothstep(0.62, 1.0, luma) * uBloomLite;

  // vignette 暗角（径向平滑，强度封顶）
  float dist = distance(vUv, vec2(0.5));
  float vig = smoothstep(0.86, 0.32, dist * (1.0 + uVignette));
  color *= mix(1.0, vig, clamp(uVignette, 0.0, 0.45));

  // film grain 细颗粒（强度封顶）
  float g = (hash(vUv * 913.0 + fract(uTime) * 17.0) - 0.5) * 2.0;
  color += g * min(uGrain, 0.06);

  gl_FragColor = vec4(color, 1.0);
}
`

export interface CinematicPostPassProps {
  post: WorldPostSpec
  tier?: 'high' | 'low' | 'fallback'
}

export function CinematicPostPass({ post, tier = 'high' }: CinematicPostPassProps) {
  const { gl, scene, camera, size } = useThree()
  const enabled = post.enabled && tier === 'high'

  const target = React.useMemo(() => {
    if (!enabled) return null
    return new THREE.WebGLRenderTarget(1, 1, {
      samples: 2,
      colorSpace: THREE.SRGBColorSpace,
    })
  }, [enabled])

  const postResources = React.useMemo(() => {
    if (!enabled) return null
    const postScene = new THREE.Scene()
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uVignette: { value: post.vignette },
        uBloomLite: { value: post.bloomLite },
        uGrain: { value: post.grain },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    // 全屏三角形（比 quad 少一个顶点、无接缝）
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    )
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    postScene.add(mesh)
    return { postScene, postCamera, material }
  }, [enabled, post.vignette, post.bloomLite, post.grain])

  React.useEffect(() => {
    if (!target || !size) return
    const width = Math.max(1, Math.floor(size.width * (gl?.getPixelRatio?.() ?? 1)))
    const height = Math.max(1, Math.floor(size.height * (gl?.getPixelRatio?.() ?? 1)))
    target.setSize(width, height)
    return () => {
      target.dispose()
    }
  }, [target, size, gl])

  // priority=1：接管最终渲染——主场景进 FBO，shader 合成上屏
  useFrame(({ gl: renderer }) => {
    if (!enabled || !target || !postResources) return
    postResources.material.uniforms.uTime!.value = performance.now() / 1000
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    postResources.material.uniforms.tDiffuse!.value = target.texture
    renderer.setRenderTarget(null)
    renderer.render(postResources.postScene, postResources.postCamera)
  }, 1)

  return null
}

export default CinematicPostPass
