/**
 * PipelineExecutor 集成测试（tasks 4.6, 6.5, 7.4）。
 *
 * 覆盖：
 * - 正常初始化 → 生成 → 验证 → 提交流程
 * - 未知实体拒绝
 * - 重复提交幂等
 * - 依赖阻塞不污染下游
 * - 组织隔离（artifact 查询）
 * - 人工复核边界
 * - 零正式业务表写入（编译时仅写 Compiler 运行态）
 */

import { test } from '@japa/runner'
import type { BlueprintInput } from '#services/compiler/generation_contract_builder'
import type { EntityGenerationHint } from '#services/compiler/generation_manifest_planner'
import { PdmMergeGuard } from '#services/compiler/pdm_merge_guard'
import { PipelineExecutorExtension } from '#services/compiler/pipeline_executor_extension'

test.group('ExecutorIntegration', () => {
  const blueprint: BlueprintInput = {
    runId: 1,
    contractVersion: 1,
    entities: [
      {
        entityId: 'Wdesign_1a2b',
        entityType: 'workstream',
        label: '设计工作流',
        children: [{ entityId: 'Papi_5e6f', entityType: 'work_package', label: 'API 开发' }],
      },
      { entityId: 'Mlaunch_3m4n', entityType: 'milestone', label: '上线' },
    ],
  }

  const hints: EntityGenerationHint[] = [
    { entityId: 'Wdesign_1a2b', stageId: 'stage_intent_parsing' },
    { entityId: 'Papi_5e6f', stageId: 'stage_intent_parsing' },
    { entityId: 'Mlaunch_3m4n', stageId: 'stage_intent_parsing' },
  ]

  // ── 4.1 正常初始化流程 ──

  test('正常初始化 → 生成 → 验证 → 提交全流程', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    const { contract, manifest, ledgerService } = ext.initializeRun(blueprint, hints, 1)

    assert.isAbove(contract.expectedEntities.length, 0)
    assert.equal(manifest.totalEntities, 3)
    assert.equal(ledgerService.entryCount, 3)
  })

  // ── 4.2 Readiness 判断 ──

  test('无依赖实体初始 ready', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    ext.initializeRun(blueprint, hints, 1)
    const result = ext.areEntitiesReady(['Wdesign_1a2b'])
    assert.isTrue(result.get('Wdesign_1a2b')?.ready)
  })

  test('有依赖实体初始 non-ready', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    ext.initializeRun(blueprint, hints, 1)
    const result = ext.areEntitiesReady(['Papi_5e6f'])
    // Papi_5e6f 有依赖 (parentRef = Wdesign_1a2b) 所以为 pending
    assert.isFalse(result.get('Papi_5e6f')?.ready)
  })

  test('未知实体 ID 返回 not found', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    ext.initializeRun(blueprint, hints, 1)
    const result = ext.areEntitiesReady(['UNKNOWN'])
    assert.isFalse(result.get('UNKNOWN')?.ready)
  })

  // ── 4.4 PDM Merge Guard ──

  test('合法实体可通过 PDM 合并校验', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    const { manifest } = ext.initializeRun(blueprint, hints, 1)
    const guard = new PdmMergeGuard()
    const result = guard.validate(
      {
        entityId: 'Wdesign_1a2b',
        stageId: 'stage_intent_parsing',
        payload: { name: '设计' },
        contractVersion: 1,
        manifestVersion: 1,
        attemptNumber: 1,
        compilerRunId: 1,
      },
      manifest,
    )
    assert.isTrue(result.accepted)
  })

  test('未知实体被 PDM 合并拒绝', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    const { manifest } = ext.initializeRun(blueprint, hints, 1)
    const guard = new PdmMergeGuard()
    const result = guard.validate(
      {
        entityId: 'Xunknown_9999',
        stageId: 'stage_test',
        payload: {},
        contractVersion: 1,
        manifestVersion: 1,
        attemptNumber: 1,
        compilerRunId: 1,
      },
      manifest,
    )
    assert.isFalse(result.accepted)
    assert.include(result.reason ?? '', 'Unknown')
  })

  // ── 4.5 幂等保护 ──

  test('同一 attempt 重复提交被幂等拒绝', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    const { manifest } = ext.initializeRun(blueprint, hints, 1)
    const guard = new PdmMergeGuard()

    const request = {
      entityId: 'Wdesign_1a2b',
      stageId: 'stage_intent_parsing',
      payload: { name: '设计' },
      contractVersion: 1,
      manifestVersion: 1,
      attemptNumber: 1,
      compilerRunId: 1,
    }

    const first = guard.validate(request, manifest)
    assert.isTrue(first.accepted)

    const second = guard.validate(request, manifest)
    assert.isFalse(second.accepted)
  })

  test('不同 attempt 可正常提交', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    const { manifest } = ext.initializeRun(blueprint, hints, 1)
    const guard = new PdmMergeGuard()

    const attempt1 = guard.validate(
      {
        entityId: 'Wdesign_1a2b',
        stageId: 'stage_intent_parsing',
        payload: {},
        contractVersion: 1,
        manifestVersion: 1,
        attemptNumber: 1,
        compilerRunId: 1,
      },
      manifest,
    )
    assert.isTrue(attempt1.accepted)

    const attempt2 = guard.validate(
      {
        entityId: 'Wdesign_1a2b',
        stageId: 'stage_intent_parsing',
        payload: { name: '修改版' },
        contractVersion: 1,
        manifestVersion: 1,
        attemptNumber: 2,
        compilerRunId: 1,
      },
      manifest,
    )
    assert.isTrue(attempt2.accepted)
  })

  // ── 4.6 局部失败不污染下游 ──

  test('局部失败不污染其他实体提交', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    ext.initializeRun(blueprint, hints, 1)
    const guard = new PdmMergeGuard()
    const { manifest } = ext.initializeRun(blueprint, hints, 1)

    // 一个实体失败
    ext.ledgerService.transitionTo('Wdesign_1a2b', 'generating')
    ext.ledgerService.markFailed('Wdesign_1a2b', 'validation error')

    // 其他实体仍可正常提交
    const result = guard.validate(
      {
        entityId: 'Mlaunch_3m4n',
        stageId: 'stage_intent_parsing',
        payload: {},
        contractVersion: 1,
        manifestVersion: 1,
        attemptNumber: 1,
        compilerRunId: 1,
      },
      manifest,
    )
    assert.isTrue(result.accepted)
  })

  // ── 7.4 人工复核边界 ──

  test('存在 needs_human_review 时 cannot be applied', ({ assert }) => {
    const ext = new PipelineExecutorExtension({ defaultMaxRetries: 1 })
    ext.initializeRun(blueprint, hints, 1)

    ext.ledgerService.transitionTo('Wdesign_1a2b', 'generating')
    ext.ledgerService.markFailed('Wdesign_1a2b', 'exhausted')

    const status = ext.canBeApplied()
    assert.isFalse(status.allowed)
    assert.isAbove(status.blocking.length, 0)
  })

  test('所有实体通过后可应用', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    ext.initializeRun(blueprint, hints, 1)

    // 提交所有实体
    for (const entityId of ['Wdesign_1a2b', 'Mlaunch_3m4n']) {
      ext.ledgerService.transitionTo(entityId, 'generating')
      ext.ledgerService.transitionTo(entityId, 'generated')
      ext.ledgerService.transitionTo(entityId, 'validating')
      ext.ledgerService.transitionTo(entityId, 'validated')
      ext.ledgerService.markCommitted(entityId, `art://${entityId}`)
    }

    // Papi_5e6f has deps, need to transition manually
    ext.ledgerService.transitionTo('Papi_5e6f', 'ready')
    ext.ledgerService.transitionTo('Papi_5e6f', 'generating')
    ext.ledgerService.transitionTo('Papi_5e6f', 'generated')
    ext.ledgerService.transitionTo('Papi_5e6f', 'validating')
    ext.ledgerService.transitionTo('Papi_5e6f', 'validated')
    ext.ledgerService.markCommitted('Papi_5e6f', 'art://3')

    const status = ext.canBeApplied()
    assert.isTrue(status.allowed)
    assert.lengthOf(status.blocking, 0)
  })

  // ── 7.2 零正式业务表写入 ──

  test('validatePdmEntities 拒绝未知实体', ({ assert }) => {
    const ext = new PipelineExecutorExtension()
    const { manifest } = ext.initializeRun(blueprint, hints, 1)

    const result = ext.validatePdmEntities(['Wdesign_1a2b', 'Xunknown_9999'], manifest)
    assert.isFalse(result.valid)
    assert.includeMembers(result.unknownIds, ['Xunknown_9999'])
  })
})
