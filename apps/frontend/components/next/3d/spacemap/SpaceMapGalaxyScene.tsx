'use client'

/**
 * 空间地图「项目星系」场景（嵌入式舞台用）。
 *
 * 旧场景把项目放在远处的「业务项目星区」（画面下方深处），画布又铺满全屏、被中间的大卡片挡住，
 * 只有两三个项目时用户只能看到底部一个小黑点，不知道星系在哪。这里改成一眼能读懂的布局：
 * - 中心一颗「组织核心」，项目恒星围绕它排成环（数量多时分多圈），相机按环半径自动取景；
 * - 恒星颜色 = 健康度，大小 = 任务数，外圈弧 = 完成进度；每颗星下方常驻名称与进度标签；
 * - 可拖拽旋转、滚轮缩放，空闲时缓慢自转；点击恒星选中并把视角拉近。
 *
 * 纯只读展示：零写入、零网络请求（数据由外层 useSpaceMapSceneState 提供）。
 */

import * as React from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard, OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import type { StarVisualState } from './spacemap-state-mapper'

export interface SpaceMapGalaxySceneProps {
  stars: StarVisualState[]
  selectedId?: number | null
  onSelectStar?: (projectId: number) => void
  onPointerOverStar?: (event: ThreeEvent<PointerEvent>, star: StarVisualState) => void
  onPointerOutStar?: (event: ThreeEvent<PointerEvent>) => void
  /** low 档：不自转、不闪烁（静态单帧渲染）。 */
  tier?: 'high' | 'low'
  /**
   * 标签 DOM 覆盖层 ref（外层 SpaceMap3DCanvas 渲染的兄弟节点）。
   * 场景内每帧把星体/核心的世界坐标投影为屏幕坐标写入该层内的标签位置。
   * 不用 drei Html：其嵌套 ReactDOM root 在卸载/StrictMode 重挂载时会产生
   * 「synchronously unmount a root」竞态与重复 createRoot 警告。
   */
  labelLayerRef?: React.RefObject<HTMLDivElement | null>
}

/** 每圈最多容纳的恒星数与圈间距。 */
const PER_RING = 10
const RING_GAP = 7

export interface GalaxyPlacement {
  projectId: number
  position: [number, number, number]
  size: number
}

/** 确定性环形布局：第 k 圈半径 10 + k·7，圈内均分角度，按圈错开相位并带轻微起伏。 */
export function layoutGalaxy(stars: readonly StarVisualState[]): {
  placements: GalaxyPlacement[]
  radius: number
} {
  const placements = stars.map((star, index) => {
    const ring = Math.floor(index / PER_RING)
    const inRing = Math.min(PER_RING, stars.length - ring * PER_RING)
    const slot = index % PER_RING
    const r = 10 + ring * RING_GAP
    // 从左侧（π）起排：两三个项目时左右展开，不会前后挡在同一条视线上
    const angle = (slot / inRing) * Math.PI * 2 + ring * 0.45 + Math.PI
    const y = Math.sin(angle * 2 + ring) * 1.2
    const tasks = star.stats?.taskCount ?? 0
    const size = 0.9 + Math.min(1.1, Math.log2(1 + tasks) * 0.15)
    return {
      projectId: star.projectId,
      position: [Math.cos(angle) * r, y, Math.sin(angle) * r] as [number, number, number],
      size,
    }
  })
  const rings = Math.max(1, Math.ceil(stars.length / PER_RING))
  return { placements, radius: 10 + (rings - 1) * RING_GAP }
}

function ProgressArc({ size, progress, color }: { size: number; progress: number; color: string }) {
  const inner = size * 1.55
  const outer = inner + 0.22
  const theta = Math.max(0.001, Math.min(1, progress / 100)) * Math.PI * 2
  return (
    <Billboard>
      {/* 底圈 */}
      <mesh>
        <ringGeometry args={[inner, outer, 64]} />
        <meshBasicMaterial color="#1e293b" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* 进度弧：从 12 点钟方向顺时针 */}
      <mesh rotation={[0, 0, Math.PI / 2]} scale={[-1, 1, 1]}>
        <ringGeometry args={[inner, outer, 64, 1, 0, theta]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
    </Billboard>
  )
}

function ProjectStar({
  star,
  placement,
  selected,
  hovered,
  onSelect,
  onOver,
  onOut,
  animate,
}: {
  star: StarVisualState
  placement: GalaxyPlacement
  selected: boolean
  hovered: boolean
  onSelect?: (projectId: number) => void
  onOver?: (event: ThreeEvent<PointerEvent>, star: StarVisualState) => void
  onOut?: (event: ThreeEvent<PointerEvent>) => void
  animate: boolean
}) {
  const haloRef = React.useRef<THREE.Mesh>(null)
  const dim = !star.isMatch
  const emphasis = selected ? 1.25 : hovered ? 1.12 : 1
  const size = placement.size * emphasis

  useFrame(({ clock }) => {
    if (!haloRef.current) return
    const pulse = animate && selected ? 1 + Math.sin(clock.elapsedTime * 3) * 0.08 : 1
    haloRef.current.scale.setScalar(pulse)
  })

  return (
    <group position={placement.position}>
      {/* 光晕 */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[size * 1.35, 24, 24]} />
        <meshBasicMaterial
          color={selected ? '#00f0ff' : star.color}
          transparent
          opacity={dim ? 0.04 : selected ? 0.28 : 0.14}
          depthWrite={false}
        />
      </mesh>
      {/* 恒星本体（命中区） */}
      <mesh
        userData={{ projectId: star.projectId }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          onSelect?.(star.projectId)
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
          onOver?.(e, star)
        }}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => onOver?.(e, star)}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          document.body.style.cursor = ''
          onOut?.(e)
        }}
      >
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial
          color={star.color}
          emissive={star.color}
          emissiveIntensity={dim ? 0.1 : 0.9}
          roughness={0.35}
          transparent
          opacity={dim ? 0.35 : 1}
        />
      </mesh>
      {!dim ? <ProgressArc size={size} progress={star.progressPercent} color={star.color} /> : null}
    </group>
  )
}

function OrganizationCore({ animate }: { animate: boolean }) {
  const ref = React.useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (animate && ref.current) ref.current.rotation.y += delta * 0.3
  })
  return (
    <group>
      <mesh ref={ref}>
        <icosahedronGeometry args={[2.2, 1]} />
        <meshStandardMaterial
          color="#facc15"
          emissive="#f59e0b"
          emissiveIntensity={0.8}
          wireframe
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[3.4, 24, 24]} />
        <meshBasicMaterial color="#facc15" transparent opacity={0.07} depthWrite={false} />
      </mesh>
    </group>
  )
}

function OrbitGuide({ radius }: { radius: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.04, radius + 0.04, 128]} />
      <meshBasicMaterial color="#38bdf8" transparent opacity={0.18} side={THREE.DoubleSide} />
    </mesh>
  )
}

/**
 * 标签投影器（Canvas 内）：每帧把核心与各星体标签锚点的世界坐标投影为屏幕坐标，
 * 写入外层标签覆盖层中对应 `data-galaxy-label` 元素的 transform。
 * 纯命令式 DOM 定位，零嵌套 React root。
 */
function GalaxyLabelProjector({
  placements,
  labelLayerRef,
}: {
  placements: GalaxyPlacement[]
  labelLayerRef?: React.RefObject<HTMLDivElement | null>
}) {
  const vec = React.useMemo(() => new THREE.Vector3(), [])
  const anchors = React.useMemo(() => {
    const list: Array<{ key: string; position: THREE.Vector3 }> = [
      { key: 'core', position: new THREE.Vector3(0, 4.2, 0) },
    ]
    for (const p of placements) {
      list.push({
        key: String(p.projectId),
        position: new THREE.Vector3(
          p.position[0],
          p.position[1] - (p.size * 1.55 + 1.2),
          p.position[2],
        ),
      })
    }
    return list
  }, [placements])

  useFrame(({ camera, size }) => {
    const layer = labelLayerRef?.current
    if (!layer) return
    camera.updateMatrixWorld()
    for (const anchor of anchors) {
      const el = layer.querySelector<HTMLElement>(`[data-galaxy-label="${anchor.key}"]`)
      if (!el) continue
      vec.copy(anchor.position).project(camera)
      // 背向相机（超出裁剪空间）时隐藏
      if (vec.z > 1 || vec.z < -1) {
        el.style.display = 'none'
        continue
      }
      el.style.display = ''
      const x = (vec.x * 0.5 + 0.5) * size.width
      const y = (-vec.y * 0.5 + 0.5) * size.height
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      el.style.opacity = '1'
    }
  })
  return null
}

/**
 * 星系标签 DOM 覆盖层（Canvas 外）：由 SpaceMap3DCanvas 在 stage 模式下渲染，
 * 内容为组织核心与各项目恒星的常驻名称/进度标签；位置由 GalaxyLabelProjector
 * 每帧命令式写入（transform/opacity/display 不进入 React 托管样式）。
 */
export function SpaceMapGalaxyLabelLayer({
  stars,
  selectedId,
  coreLabel,
}: {
  stars: StarVisualState[]
  selectedId?: number | null
  coreLabel?: string
}) {
  return (
    <>
      <div
        data-galaxy-label="core"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          opacity: 0,
          willChange: 'transform',
        }}
      >
        <div
          className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] tracking-wide"
          style={{
            transform: 'translate(-50%, -50%)',
            color: '#fde68a',
            background: 'rgba(8, 12, 22, 0.6)',
          }}
        >
          {coreLabel ?? '组织核心'}
        </div>
      </div>
      {stars.map((star) => {
        const dim = !star.isMatch
        const openSignals = star.signals.length
        return (
          <div
            key={star.projectId}
            data-galaxy-label={star.projectId}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              opacity: 0,
              willChange: 'transform',
            }}
          >
            <div
              className="whitespace-nowrap rounded-md border px-2 py-1 text-center text-[11px] leading-tight shadow-lg"
              style={{
                transform: 'translate(-50%, -50%)',
                opacity: dim ? 0.35 : 1,
                background: 'rgba(8, 12, 22, 0.82)',
                borderColor:
                  star.projectId === selectedId ? '#00f0ff' : 'rgba(148, 163, 184, 0.25)',
                color: '#e2e8f0',
                maxWidth: 180,
              }}
            >
              <div className="truncate font-medium" style={{ maxWidth: 170 }}>
                {star.name}
              </div>
              <div style={{ color: '#94a3b8' }}>
                进度 {star.progressPercent}%{star.stats ? ` · ${star.stats.taskCount} 任务` : ''}
                {openSignals > 0 ? (
                  <span style={{ color: '#f59e0b' }}> · ⚠ {openSignals}</span>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}

/** 轨道控制器上本场景用到的部分（drei OrbitControls 实例）。 */
interface OrbitControlsHandle {
  target: THREE.Vector3
  update: () => void
}

/** 选中恒星时把控制器目标平滑移到该星；取消选中回到中心。 */
function CameraRig({
  target,
  radius,
  controls,
}: {
  target: [number, number, number] | null
  radius: number
  controls: React.RefObject<OrbitControlsHandle | null>
}) {
  const { camera } = useThree()
  const goal = React.useMemo(() => new THREE.Vector3(), [])
  const want = React.useMemo(() => new THREE.Vector3(), [])
  const settled = React.useRef(false)

  React.useEffect(() => {
    settled.current = false
  }, [target, radius])

  useFrame((_, delta) => {
    const c = controls.current
    if (!c || settled.current) return
    goal.set(...(target ?? [0, 0, 0]))
    const t = 1 - Math.exp(-delta * 4)
    c.target.lerp(goal, t)
    // 选中时拉近到恒星斜上方；否则回到能看到整圈的位置
    if (target) {
      // 从星系外侧斜上方看向该星（背后是组织核心），距离约 16，整颗星与标签都在画面内
      const len = Math.hypot(target[0], target[2]) || 1
      want.set(target[0] + (target[0] / len) * 13, 9, target[2] + (target[2] / len) * 13)
    } else {
      want.set(0, radius * 0.95 + 6, radius * 1.9 + 10)
    }
    camera.position.lerp(want, t)
    c.update()
    if (c.target.distanceTo(goal) < 0.05 && camera.position.distanceTo(want) < 0.1) {
      settled.current = true
    }
  })
  return null
}

export function SpaceMapGalaxyScene({
  stars,
  selectedId = null,
  onSelectStar,
  onPointerOverStar,
  onPointerOutStar,
  tier = 'high',
  labelLayerRef,
}: SpaceMapGalaxySceneProps) {
  const controls = React.useRef<OrbitControlsHandle | null>(null)
  const [hoveredId, setHoveredId] = React.useState<number | null>(null)
  const { placements, radius } = React.useMemo(() => layoutGalaxy(stars), [stars])
  const byId = React.useMemo(() => new Map(placements.map((p) => [p.projectId, p])), [placements])
  const animate = tier === 'high'
  const selectedPlacement = selectedId != null ? (byId.get(selectedId) ?? null) : null
  const rings = Math.max(1, Math.ceil(stars.length / PER_RING))

  return (
    <>
      <color attach="background" args={['#05070d']} />
      <fog attach="fog" args={['#05070d', radius * 3.2, radius * 6 + 60]} />
      <ambientLight intensity={0.45} />
      <pointLight position={[0, 0, 0]} intensity={60} distance={radius * 4} color="#fde68a" />
      <directionalLight position={[20, 30, 20]} intensity={0.6} />
      <Stars
        radius={160}
        depth={60}
        count={animate ? 2500 : 800}
        factor={4}
        fade
        speed={animate ? 0.6 : 0}
      />

      <OrganizationCore animate={animate} />
      <GalaxyLabelProjector placements={placements} labelLayerRef={labelLayerRef} />
      {Array.from({ length: rings }, (_, k) => (
        <OrbitGuide key={k} radius={10 + k * RING_GAP} />
      ))}

      {stars.map((star) => {
        const placement = byId.get(star.projectId)
        if (!placement) return null
        return (
          <ProjectStar
            key={star.projectId}
            star={star}
            placement={placement}
            selected={star.projectId === selectedId}
            hovered={star.projectId === hoveredId}
            onSelect={onSelectStar}
            onOver={(e, s) => {
              setHoveredId(s.projectId)
              onPointerOverStar?.(e, s)
            }}
            onOut={(e) => {
              setHoveredId(null)
              onPointerOutStar?.(e)
            }}
            animate={animate}
          />
        )
      })}

      <OrbitControls
        ref={controls as never}
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={8}
        maxDistance={radius * 5 + 40}
        maxPolarAngle={Math.PI * 0.49}
        autoRotate={animate && selectedId == null && hoveredId == null}
        autoRotateSpeed={0.35}
      />
      <CameraRig target={selectedPlacement?.position ?? null} radius={radius} controls={controls} />
    </>
  )
}
