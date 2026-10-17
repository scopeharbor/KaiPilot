'use client'

import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

export interface CinematicDriftCameraProps {
  isFocused?: boolean
  tier?: 'high' | 'low' | 'fallback'
}

/**
 * 原生阻尼微交互镜头控制器
 *
 * 规范遵循：v3-next-layer1-login-3d-m0 design.md Decision 5
 * 零 GSAP / 零 Framer Motion，基于 THREE.MathUtils.damp 实现平滑物理阻尼。
 */
export function CinematicDriftCamera({
  isFocused = false,
  tier = 'high',
}: CinematicDriftCameraProps) {
  const { camera, pointer } = useThree()

  useFrame((state, delta) => {
    // 降级档或静态 low 档固定机位，不产生持续漂移
    if (tier === 'fallback' || tier === 'low') {
      camera.position.set(0, 0, 5.0)
      camera.lookAt(0, 0, 0)
      return
    }

    // 1. 常态慢速漂移（微小扰动）
    const time = state.clock ? state.clock.getElapsedTime() : 0
    const driftX = Math.sin(time * 0.15) * 0.1
    const driftY = Math.cos(time * 0.2) * 0.08

    // 2. 表单聚焦时沿 Z 轴微推（基准 z=5.0，聚焦推入至 4.6）
    const targetZ = isFocused ? 4.6 : 5.0
    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetZ, 3.5, delta)

    // 3. 鼠标微幅视差响应 (Parallax)
    const pointerX = pointer?.x ?? 0
    const pointerY = pointer?.y ?? 0
    const targetX = driftX + pointerX * 0.2
    const targetY = driftY + pointerY * 0.15
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 2.0, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, 2.0, delta)

    camera.lookAt(0, 0, 0)
  })

  return null
}
