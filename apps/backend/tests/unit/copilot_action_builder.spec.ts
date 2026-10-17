/**
 * CopilotActionBuilder 单元测试（v3-copilot-action-and-preview-boundary 任务 3.x）。
 *
 * 覆盖：
 * - 3.4 目标实体引用映射（任务/WBS/依赖/资源/风险/里程碑/排期/项目字段）
 * - 3.5 逐条 change 的 confidence 写入
 * - 3.3/3.6/3.7 源码级守卫：动作模块未导入任何领域仓储或模型写入 API；
 *   未经确认提交动作产生零领域写入；不存在绕过 preview/diff/dry-run 的直写路径
 * - 3.8 session 关系策略裁决：每个动作批次新建独立会话（design 未决问题裁决）
 *
 * 纯本地：零网络、零数据库、零 provider。核心经相对路径导入，vitest 直跑。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildCopilotActionChangeRows,
  buildCopilotActionSessionPayload,
  COPILOT_TARGET_REF_PREFIX_TO_ENTITY,
  deriveCopilotActionSessionHash,
  mapCopilotTargetRefToDraftTarget,
  type CopilotActionChangeInput,
  type CopilotActionMaterializeInput,
} from '../../app/services/copilot_action/action_builder_core.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const readSource = (rel: string) => readFileSync(resolve(currentDir, rel), 'utf-8')

// 领域写入 API 清单（源码级守卫的禁止导入面）
const DOMAIN_WRITE_IMPORT_MARKERS = [
  '#models/project',
  '#models/task',
  '#models/wbs_node',
  '#models/milestone',
  '#models/risk',
  '#models/resource',
  '#models/dependency',
  '#models/acceptance_criterion',
  'task_service',
  'project_service',
  'resource_suggestion_service',
  'risk_service',
  'wbs_tree_service',
]

describe('3.4 动作目标 → 草案层实体引用映射', () => {
  it('任务/WBS/依赖/资源/风险/里程碑/项目字段引用正确映射', () => {
    expect(mapCopilotTargetRefToDraftTarget('task:1201')).toEqual({
      entityType: 'task',
      entityId: '1201',
      fieldPath: null,
    })
    expect(mapCopilotTargetRefToDraftTarget('wbs:3')).toEqual({
      entityType: 'wbs_node',
      entityId: '3',
      fieldPath: null,
    })
    expect(mapCopilotTargetRefToDraftTarget('dependency:9')).toEqual({
      entityType: 'dependency',
      entityId: '9',
      fieldPath: null,
    })
    expect(mapCopilotTargetRefToDraftTarget('resource:7')).toEqual({
      entityType: 'resource',
      entityId: '7',
      fieldPath: null,
    })
    expect(mapCopilotTargetRefToDraftTarget('risk:5')).toEqual({
      entityType: 'risk',
      entityId: '5',
      fieldPath: null,
    })
    expect(mapCopilotTargetRefToDraftTarget('milestone:2')).toEqual({
      entityType: 'milestone',
      entityId: '2',
      fieldPath: null,
    })
    expect(mapCopilotTargetRefToDraftTarget('project:42')).toEqual({
      entityType: 'project',
      entityId: '42',
      fieldPath: null,
    })
  })

  it('排期(schedule)引用映射到任务字段且必须带 fieldPath', () => {
    expect(mapCopilotTargetRefToDraftTarget('schedule:1201:startDate')).toEqual({
      entityType: 'task',
      entityId: '1201',
      fieldPath: 'startDate',
    })
    // 无 fieldPath 的排期引用 → null（必须指明改哪个任务字段）
    expect(mapCopilotTargetRefToDraftTarget('schedule:1201')).toBeNull()
  })

  it('未知前缀或畸形引用 → null（调用方拒绝，非泄露）', () => {
    expect(mapCopilotTargetRefToDraftTarget('unknown:1')).toBeNull()
    expect(mapCopilotTargetRefToDraftTarget('task')).toBeNull()
    expect(mapCopilotTargetRefToDraftTarget('')).toBeNull()
    expect(mapCopilotTargetRefToDraftTarget('a:b:c:d')).toBeNull()
  })

  it('前缀映射表覆盖 spec 声明的全部目标面', () => {
    for (const prefix of [
      'task',
      'wbs',
      'dependency',
      'resource',
      'risk',
      'milestone',
      'project',
      'schedule',
    ]) {
      expect(COPILOT_TARGET_REF_PREFIX_TO_ENTITY[prefix]).toBeDefined()
    }
  })
})

describe('3.5 逐条 change 的 confidence 写入', () => {
  it('每条 change 携带独立 confidence 与 pending 状态', () => {
    const inputs: CopilotActionChangeInput[] = [
      {
        targetRef: 'task:1201',
        operation: 'update',
        value: { durationDays: 5 },
        oldValue: { durationDays: 3 },
        confidence: 0.9,
      },
      {
        targetRef: 'risk:5',
        operation: 'create',
        value: { title: '新风险' },
        oldValue: null,
        confidence: 0.4,
      },
    ]
    const { rows, unmappedRefs } = buildCopilotActionChangeRows(inputs)
    expect(unmappedRefs).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0].confidence).toBe(0.9)
    expect(rows[1].confidence).toBe(0.4)
    expect(rows[0].reviewStatus).toBe('pending')
    expect(rows[1].reviewStatus).toBe('pending')
    expect(rows[0].sequence).toBe(1)
    expect(rows[1].sequence).toBe(2)
  })

  it('未映射引用整体报告，不静默丢弃（无绕过路径）', () => {
    const { rows, unmappedRefs } = buildCopilotActionChangeRows([
      {
        targetRef: 'task:1',
        operation: 'update',
        value: { a: 1 },
        oldValue: null,
        confidence: 0.5,
      },
      {
        targetRef: 'garbage',
        operation: 'create',
        value: { a: 1 },
        oldValue: null,
        confidence: 0.5,
      },
    ])
    expect(rows).toHaveLength(1)
    expect(unmappedRefs).toEqual(['garbage'])
  })
})

describe('3.1/3.2 会话 DTO 物化', () => {
  it('会话 DTO 使用 v3_copilot_action 来源、compilerRunId=null、低敏 metadata', () => {
    const input: CopilotActionMaterializeInput = {
      organizationId: 1,
      userId: 9,
      actionCardId: 'card-1',
      normalizedActionInput: 'apply-proposal:task:1201:duration=5',
      idempotencyKey: 'idem-1',
      sourceSignaturePrefixes: ['aaaabbbb'],
      reliedOnSubstitutedDefaults: false,
      changeInputs: [],
    }
    const payload = buildCopilotActionSessionPayload(input, 2, 'hash-1')
    expect(payload.sourceType).toBe('v3_copilot_action')
    expect(payload.compilerRunId).toBeNull()
    expect(payload.pdmArtifactId).toBeNull()
    expect(payload.status).toBe('active')
    expect(payload.version).toBe(1)
    expect(payload.summary.totalChanges).toBe(2)
    expect(payload.metadata).toEqual({
      source: 'copilot_action',
      actionCardId: 'card-1',
      idempotencyKey: 'idem-1',
      sourceSignaturePrefixes: ['aaaabbbb'],
      reliedOnSubstitutedDefaults: false,
    })
  })

  it('会话指纹为确定性 sha256（同输入同值、不同输入不同值）', () => {
    const a = deriveCopilotActionSessionHash('input', 'idem', ['task:1'])
    const b = deriveCopilotActionSessionHash('input', 'idem', ['task:1'])
    const c = deriveCopilotActionSessionHash('input2', 'idem', ['task:1'])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('3.3/3.6 源码级守卫：无领域写入依赖、零领域写入', () => {
  it('action_builder.ts 只导入草案层模型（DraftLayerSession/DraftLayerChange），无领域模型导入', () => {
    const source = readSource('../../app/services/copilot_action/action_builder.ts')
    expect(source).toContain("from '#models/draft_layer_session'")
    expect(source).toContain("from '#models/draft_layer_change'")
    for (const marker of DOMAIN_WRITE_IMPORT_MARKERS) {
      expect(source).not.toContain(marker)
    }
  })

  it('action_builder_core.ts 零模型导入（纯 DTO 构造，无任何写入 API）', () => {
    const source = readSource('../../app/services/copilot_action/action_builder_core.ts')
    expect(source).not.toContain('#models')
    expect(source).not.toContain('.create(')
    expect(source).not.toContain('db.')
    for (const marker of DOMAIN_WRITE_IMPORT_MARKERS) {
      expect(source).not.toContain(marker)
    }
  })
})

describe('3.7 不存在绕过 preview/diff/dry-run 的直写路径', () => {
  it('构建器只暴露 materializeAction（会话+change set），无 apply/preview/dry-run/decision 直写面', () => {
    const source = readSource('../../app/services/copilot_action/action_builder.ts')
    // 不导入任何 draft-layer 写服务（apply/dry-run/decision/preview 全部由既有七端点承接）
    expect(source).not.toContain('apply_service')
    expect(source).not.toContain('dry_run_service')
    expect(source).not.toContain('decision_service')
    expect(source).not.toContain('preview_service')
    expect(source).not.toContain('handoff_service')
    // 唯一写入口是草案层模型 create（通道本身）
    expect(source).toContain('DraftLayerSession.create')
    expect(source).toContain('DraftLayerChange.create')
  })
})

describe('3.8 session 关系策略（design 未决问题裁决）', () => {
  it('每个动作批次新建独立会话：默认物化路径不查找/复用开放会话', () => {
    // 裁决：Copilot 动作默认新建自己的草案层会话（diff 实体级可读、避免混入无关变更）；
    // 追加到既有开放会话的策略留待后续 change 按需实现。
    // 构建器输入（CopilotActionMaterializeInput）不含 sessionId 参数——核心 DTO 层面即无复用面；
    // 源码中无「查找既有开放会话」查询逻辑。
    const coreSource = readSource('../../app/services/copilot_action/action_builder_core.ts')
    expect(coreSource).not.toContain('sessionId')
    expect(coreSource).not.toContain("where('status'")
    expect(coreSource).toContain('actionCardId')
    const source = readSource('../../app/services/copilot_action/action_builder.ts')
    expect(source).not.toContain("where('status', 'active')")
    expect(source).not.toContain('openSession')
    expect(source).toContain('materializeAction')
  })
})
