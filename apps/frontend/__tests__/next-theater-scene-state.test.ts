import { describe, expect, test } from 'vitest'
import { PROJECT_DRAFT_MODULES } from '@aiproj/types'
import {
  mapDraftStateToSceneMode,
  getModuleConstructVisualState,
  MODULE_POSITIONS,
  MODULE_COLORS,
  MODULE_LABELS,
} from '@/components/next/3d/theater/theater-scene-mapper'

describe('生成剧场 3D 场景状态机映射器（v3-next-layer1-theater-3d-m1 tasks 2.1 / 2.2）', () => {
  describe('mapDraftStateToSceneMode 纯函数确定性状态流转', () => {
    test('初始与意图解析阶段映射为 idle 场景模式', () => {
      expect(mapDraftStateToSceneMode('idle', null, null)).toBe('idle')
      expect(mapDraftStateToSceneMode('analyzing', null, null)).toBe('idle')
    })

    test('多轮澄清问答进行中映射为 clarifying 场景模式', () => {
      expect(mapDraftStateToSceneMode('clarifying', null, null)).toBe('clarifying')
    })

    test('人工确认就绪态映射为 ready 场景模式', () => {
      expect(mapDraftStateToSceneMode('ready', null, null)).toBe('ready')
    })

    test('SSE 流式生成中（draftStatus=drafting）映射为 generating 场景模式', () => {
      expect(mapDraftStateToSceneMode('ready', 'drafting', null)).toBe('generating')
      expect(mapDraftStateToSceneMode('idle', 'drafting', null)).toBe('generating')
    })

    test('审查与编辑态（draftStatus=reviewing / editing）映射为 review 场景模式', () => {
      expect(mapDraftStateToSceneMode('idle', 'reviewing', null)).toBe('review')
      expect(mapDraftStateToSceneMode('ready', 'reviewing', null)).toBe('review')
      expect(mapDraftStateToSceneMode('idle', 'editing', null)).toBe('review')
    })

    test('人工确认转正态（draftStatus=confirmed）映射为 settled 场景模式', () => {
      expect(mapDraftStateToSceneMode('idle', 'confirmed', null)).toBe('settled')
      expect(mapDraftStateToSceneMode('ready', 'confirmed', null)).toBe('settled')
    })

    test('异常失败分支（status=error / draftStatus=error / failureDetail 存在）确定性映射为 disrupted 场景模式', () => {
      expect(mapDraftStateToSceneMode('error', null, null)).toBe('disrupted')
      expect(mapDraftStateToSceneMode('idle', 'error', null)).toBe('disrupted')
      expect(
        mapDraftStateToSceneMode('ready', 'drafting', {
          errorCode: 'STREAM_FAILED',
          message: 'Connection dropped',
          consistency: 'failed',
          sequence: 12,
        }),
      ).toBe('disrupted')
    })
  })

  describe('9 模块构件三维视觉语义与四态映射 (getModuleConstructVisualState)', () => {
    test('9 模块定义完整性：包含全部 PROJECT_DRAFT_MODULES', () => {
      expect(PROJECT_DRAFT_MODULES).toHaveLength(9)
      for (const mod of PROJECT_DRAFT_MODULES) {
        expect(MODULE_POSITIONS[mod]).toBeDefined()
        expect(MODULE_COLORS[mod]).toBeDefined()
        expect(MODULE_LABELS[mod]).toBeDefined()
        expect(MODULE_POSITIONS[mod]).toHaveLength(3)
      }
    })

    test('pending 状态输出透明线框微发光视觉属性', () => {
      for (const mod of PROJECT_DRAFT_MODULES) {
        const visual = getModuleConstructVisualState(mod, 'pending', 'generating')
        expect(visual.module).toBe(mod)
        expect(visual.status).toBe('pending')
        expect(visual.wireframe).toBe(true)
        expect(visual.opacity).toBe(0.25)
        expect(visual.scale).toBe(0.95)
        expect(visual.glowIntensity).toBe(0.1)
        expect(visual.position).toEqual(MODULE_POSITIONS[mod])
        expect(visual.color).toBe(MODULE_COLORS[mod])
      }
    })

    test('generating 状态输出高亮呼吸与生长中视觉属性', () => {
      for (const mod of PROJECT_DRAFT_MODULES) {
        const visual = getModuleConstructVisualState(mod, 'generating', 'generating')
        expect(visual.status).toBe('generating')
        expect(visual.wireframe).toBe(false)
        expect(visual.opacity).toBe(0.85)
        expect(visual.scale).toBe(1.05)
        expect(visual.glowIntensity).toBe(0.8)
      }
    })

    test('completed 状态输出实体晶化锁定与稳定辉光视觉属性', () => {
      for (const mod of PROJECT_DRAFT_MODULES) {
        const visual = getModuleConstructVisualState(mod, 'completed', 'generating')
        expect(visual.status).toBe('completed')
        expect(visual.wireframe).toBe(false)
        expect(visual.opacity).toBe(1.0)
        expect(visual.scale).toBe(1.0)
        expect(visual.glowIntensity).toBe(0.4)
      }
    })

    test('failed 状态输出暗红警示线框视觉属性', () => {
      for (const mod of PROJECT_DRAFT_MODULES) {
        const visual = getModuleConstructVisualState(mod, 'failed', 'disrupted')
        expect(visual.status).toBe('failed')
        expect(visual.wireframe).toBe(true)
        expect(visual.color).toBe('#ef4444')
        expect(visual.opacity).toBe(0.6)
        expect(visual.scale).toBe(0.9)
        expect(visual.glowIntensity).toBe(0.2)
      }
    })

    test('缺省 moduleStatus 时默认降级为 pending 状态', () => {
      const visual = getModuleConstructVisualState('charter', undefined, 'idle')
      expect(visual.status).toBe('pending')
      expect(visual.wireframe).toBe(true)
      expect(visual.opacity).toBe(0.25)
    })
  })
})
