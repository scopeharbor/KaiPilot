'use client'

/**
 * 原生阻尼算法镜头导演控制器
 *
 * 规范遵循：v3-next-layer1-theater-3d-m1
 * - proposal.md §3 (原生数学阻尼平滑动画，坚决不引入 GSAP)
 * - design.md Decision 2 (各模式机位契约与俯角变换)
 * - RL-14: 确定性轨迹
 * - RL-15: 防 Slop，镜头运动仅在状态切换与微视差发生
 */

import * as React from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { ProjectDraftModule } from '@aiproj/types'
import { MODULE_POSITIONS, type TheaterSceneMode } from './theater-scene-mapper'

export interface CameraPreset {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

/**
 * 各场景模式确定性机位预设（design.md Decision 2）
 */
export const SCENE_CAMERA_PRESETS: Record<TheaterSceneMode, CameraPreset> = {
  idle: {
    position: [0, 0, 12],
    target: [0, 0, 0],
    fov: 60,
  },
  clarifying: {
    position: [0, 0, 9],
    target: [0, 0, 0],
    fov: 55,
  },
  ready: {
    position: [0, 1.5, 8],
    target: [0, 0, 0],
    fov: 58,
  },
  generating: {
    position: [0, 0.8, 9.5],
    target: [0, 0, 0],
    fov: 55,
  },
  review: {
    position: [0, 6, 14],
    target: [0, -0.5, 0],
    fov: 50,
  },
  settled: {
    position: [0, 2, 10],
    target: [0, 0, 0],
    fov: 52,
  },
  disrupted: {
    position: [0, 0, 11],
    target: [0, 0, 0],
    fov: 60,
  },
}

export interface TheaterSceneDirectorProps {
  sceneMode?: TheaterSceneMode
  activeModule?: ProjectDraftModule | null
  tier?: 'high' | 'low' | 'fallback'
}

export function TheaterSceneDirector({
  sceneMode = 'idle',
  activeModule = null,
  tier = 'high',
}: TheaterSceneDirectorProps) {
  const { camera, pointer } = useThree()
  const lookAtTargetRef = React.useRef(new THREE.Vector3(0, 0, 0))

  const preset = SCENE_CAMERA_PRESETS[sceneMode] || SCENE_CAMERA_PRESETS.idle

  useFrame((_, delta) => {
    if (tier === 'low') {
      // Low 档静态单帧直接就位，不做连续阻尼计算
      camera.position.set(preset.position[0], preset.position[1], preset.position[2])
      camera.lookAt(preset.target[0], preset.target[1], preset.target[2])
      return
    }

    // 焦点目标计算：generating 态向激活模块适度微倾
    let targetX = preset.target[0]
    let targetY = preset.target[1]
    const targetZ = preset.target[2]

    if (sceneMode === 'generating' && activeModule && MODULE_POSITIONS[activeModule]) {
      const modPos = MODULE_POSITIONS[activeModule]
      targetX += modPos[0] * 0.18
      targetY += modPos[1] * 0.18
    }

    // 鼠标指针微视差（RL-15: 克制有界，X 限幅 ±0.4，Y 限幅 ±0.25）
    const parallaxX = pointer.x * 0.4
    const parallaxY = pointer.y * 0.25

    const destX = preset.position[0] + parallaxX
    const destY = preset.position[1] + parallaxY
    const destZ = preset.position[2]

    // 原生数学阻尼平滑插值（THREE.MathUtils.damp，阻尼系数 3.5）
    camera.position.x = THREE.MathUtils.damp(camera.position.x, destX, 3.5, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, destY, 3.5, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, destZ, 3.5, delta)

    lookAtTargetRef.current.x = THREE.MathUtils.damp(lookAtTargetRef.current.x, targetX, 3.5, delta)
    lookAtTargetRef.current.y = THREE.MathUtils.damp(lookAtTargetRef.current.y, targetY, 3.5, delta)
    lookAtTargetRef.current.z = THREE.MathUtils.damp(lookAtTargetRef.current.z, targetZ, 3.5, delta)

    camera.lookAt(lookAtTargetRef.current)
  })

  return null
}
