'use client'

import * as React from 'react'
import { ProceduralNebula } from './ProceduralNebula'
import { InstancedStarfield } from './InstancedStarfield'
import { VolumetricCore } from './VolumetricCore'
import { CinematicDriftCamera } from './CinematicDriftCamera'
import { CinematicPostPass } from '../shared/CinematicPostPass'
import { LOGIN_WORLD_SPEC, buildWorldComposition } from '@/lib/next/3d/world-builder'

export interface LoginSpaceSceneProps {
  tier?: 'high' | 'low' | 'fallback'
  isFocused?: boolean
  isSubmitting?: boolean
}

/**
 * 登录页全景深空 3D 场景图底座
 *
 * 规范遵循：v3-next-layer1-login-3d-m0 design.md Decision 4 & Decision 5 +
 * v3-next-cinematic-techniques-completion（D1 世界构建器三段构图 + D2 免库后处理）。
 *
 * 三段空间构图（导演台本 LOGIN_WORLD_SPEC，背景→中景→前景）：
 * - background：程序化星云（Simplex Noise 远空体积感）；
 * - midground：单 Draw Call 实例化星野（2000/400 纵深微粒）；
 * - foreground：深空微光核心（缓动自转主视觉）+ DOM 前景剪纸（表单侧）。
 * 收镜：CinematicPostPass 免库后处理（暗角/微 bloom/胶片颗粒，仅 high 档）。
 */
export function LoginSpaceScene({
  tier = 'high',
  isFocused = false,
  isSubmitting = false,
}: LoginSpaceSceneProps) {
  const world = React.useMemo(() => buildWorldComposition(LOGIN_WORLD_SPEC), [])
  const { atmosphere } = world

  return (
    <>
      {/* 深空大气指数消隐雾效（世界构建器大气台本） */}
      <fogExp2 attach="fog" args={[atmosphere.fogColor, atmosphere.fogDensity]} />

      {/* 基础空间照明（大气台本参数） */}
      <ambientLight intensity={atmosphere.ambientIntensity} />
      <directionalLight
        position={atmosphere.directional.position}
        intensity={atmosphere.directional.intensity}
      />

      {/* background（z∈[-60,-30]）：程序化着色器星云 */}
      <group name="world-background">
        <ProceduralNebula tier={tier} />
      </group>

      {/* midground（z∈[-30,-8]）：实例化星野粒子群 */}
      <group name="world-midground">
        <InstancedStarfield
          count={tier === 'low' ? 400 : 2000}
          isSubmitting={isSubmitting}
          tier={tier}
        />
      </group>

      {/* foreground（z∈[-8,2]）：深空微光核心主视觉 */}
      <group name="world-foreground">
        <VolumetricCore tier={tier} />
      </group>

      {/* 阻尼镜头微交互 */}
      <CinematicDriftCamera isFocused={isFocused} tier={tier} />

      {/* Cinematic Post Processing（免库 FBO 通道：暗角/微 bloom/胶片颗粒，仅 high 档） */}
      <CinematicPostPass post={world.post} tier={tier} />
    </>
  )
}
