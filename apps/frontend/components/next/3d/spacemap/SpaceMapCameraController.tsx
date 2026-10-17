'use client'

/**
 * 阻尼漫游相机控制器与星体拾取聚焦机位调度
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §3 (平滑机位飞越聚焦, 阻尼原生计算)
 * - design.md Decision 5, Performance Budget §3
 * - tasks.md 4.2
 * - RL-15 (防 Slop): 100% 采用 THREE.MathUtils.damp 原生阻尼，严禁引入 GSAP
 */

import * as React from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { StarVisualState } from './spacemap-state-mapper'

export interface SpaceMapCameraControllerProps {
  selectedStar?: StarVisualState | null
  tier?: 'high' | 'low' | 'fallback'
  defaultPosition?: [number, number, number]
  defaultTarget?: [number, number, number]
  /** 导演机位（缺省 overview）；数字键 1/2/3 亦可切换。 */
  shot?: CameraShotId
  /** 机位切换回调（键盘切换时回传，便于外部按钮同步）。 */
  onShotChange?: (shot: CameraShotId) => void
}

export const CAMERA_OVERVIEW_PRESET = {
  position: [0, 45, 105] as [number, number, number],
  target: [0, 0, 15] as [number, number, number],
  fov: 55,
}

/** 导演镜头组（Cinematic Camera Director，v3-next-cinematic-techniques-completion D4）：
 *  三个电影级机位（概览/星区巡游/特写凝视），数字键 1/2/3 调度，
 *  位置/目标/视场角全部由原生阻尼平滑过渡（严禁 GSAP，RL-15）。 */
export const CAMERA_SHOT_LIST = {
  overview: {
    id: 'overview',
    label: '全景概览',
    position: [0, 45, 105] as [number, number, number],
    target: [0, 0, 15] as [number, number, number],
    fov: 55,
  },
  sector: {
    id: 'sector',
    label: '星区巡游',
    position: [36, 22, 58] as [number, number, number],
    target: [6, 0, 10] as [number, number, number],
    fov: 48,
  },
  closeup: {
    id: 'closeup',
    label: '特写凝视',
    position: [10, 8, 26] as [number, number, number],
    target: [0, 0, 8] as [number, number, number],
    fov: 42,
  },
} as const

export type CameraShotId = keyof typeof CAMERA_SHOT_LIST

export function SpaceMapCameraController({
  selectedStar,
  tier = 'high',
  defaultPosition,
  defaultTarget,
  shot = 'overview',
  onShotChange,
}: SpaceMapCameraControllerProps) {
  const { camera, gl } = useThree()
  const activeShot = CAMERA_SHOT_LIST[shot] ?? CAMERA_SHOT_LIST.overview
  const basePosition = defaultPosition ?? activeShot.position
  const baseTarget = defaultTarget ?? activeShot.target
  const targetVec = React.useRef(new THREE.Vector3(...baseTarget))
  const isDragging = React.useRef(false)
  const previousPointer = React.useRef({ x: 0, y: 0 })
  const panOffset = React.useRef(new THREE.Vector2(0, 0))
  const zoomFactor = React.useRef(1.0)

  // 鼠标拖拽与缩放事件绑定
  React.useEffect(() => {
    const dom = gl?.domElement
    if (!dom || typeof dom.addEventListener !== 'function') return

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0) {
        isDragging.current = true
        previousPointer.current = { x: e.clientX, y: e.clientY }
      }
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDragging.current) return
      const dx = e.clientX - previousPointer.current.x
      const dy = e.clientY - previousPointer.current.y
      previousPointer.current = { x: e.clientX, y: e.clientY }

      panOffset.current.x -= dx * 0.08
      panOffset.current.y += dy * 0.08
    }

    const handlePointerUp = () => {
      isDragging.current = false
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY * 0.001
      zoomFactor.current = THREE.MathUtils.clamp(zoomFactor.current + delta, 0.4, 2.2)
    }

    dom.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    dom.addEventListener('wheel', handleWheel, { passive: false })

    // 导演机位键盘调度（1/2/3）：概览 / 星区巡游 / 特写凝视
    const handleShotKey = (e: KeyboardEvent) => {
      const keyMap: Record<string, CameraShotId> = {
        Digit1: 'overview',
        Digit2: 'sector',
        Digit3: 'closeup',
      }
      const next = keyMap[e.code]
      if (next) onShotChange?.(next)
    }
    window.addEventListener('keydown', handleShotKey)

    return () => {
      dom.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      dom.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleShotKey)
    }
  }, [gl, onShotChange])

  useFrame((_, delta) => {
    if (tier === 'fallback') return

    let desiredPos: THREE.Vector3
    let desiredTarget: THREE.Vector3

    if (selectedStar) {
      desiredPos = new THREE.Vector3(
        selectedStar.targetCameraPosition[0] + panOffset.current.x * 0.3,
        selectedStar.targetCameraPosition[1] + panOffset.current.y * 0.3,
        selectedStar.targetCameraPosition[2] * zoomFactor.current,
      )
      desiredTarget = new THREE.Vector3(...selectedStar.position)
    } else {
      desiredPos = new THREE.Vector3(
        (basePosition[0] + panOffset.current.x) * zoomFactor.current,
        (basePosition[1] + panOffset.current.y) * zoomFactor.current,
        basePosition[2] * zoomFactor.current,
      )
      desiredTarget = new THREE.Vector3(...baseTarget)
    }

    if (tier === 'low') {
      camera.position.copy(desiredPos)
      targetVec.current.copy(desiredTarget)
      camera.lookAt(targetVec.current)
      if (camera instanceof THREE.PerspectiveCamera && camera.fov !== activeShot.fov) {
        camera.fov = activeShot.fov
        camera.updateProjectionMatrix()
      }
    } else {
      // 原生阻尼插值 (THREE.MathUtils.damp)：位置/目标/视场角三线平滑过渡
      camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredPos.x, 4.5, delta)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredPos.y, 4.5, delta)
      camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredPos.z, 4.5, delta)

      targetVec.current.x = THREE.MathUtils.damp(targetVec.current.x, desiredTarget.x, 5.0, delta)
      targetVec.current.y = THREE.MathUtils.damp(targetVec.current.y, desiredTarget.y, 5.0, delta)
      targetVec.current.z = THREE.MathUtils.damp(targetVec.current.z, desiredTarget.z, 5.0, delta)

      camera.lookAt(targetVec.current)

      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = THREE.MathUtils.damp(camera.fov, activeShot.fov, 4.0, delta)
        camera.updateProjectionMatrix()
      }
    }
  })

  return null
}
