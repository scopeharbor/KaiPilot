/**
 * CompletenessLedgerService 单元测试（tasks 3.6）。
 *
 * 覆盖：
 * - 从 Manifest 初始化 Ledger
 * - 状态机流转守卫（合法/非法转移）
 * - 重试耗尽进入人工复核
 * - Attempt 记录
 * - 完整度聚合
 * - Resume 队列分类
 */

import { test } from '@japa/runner'
import {
  CompletenessLedgerService,
  TransitionError,
} from '#services/compiler/completeness_ledger_service'
import type { GenerationManifest } from '@aiproj/compiler-spec'

test.group('CompletenessLedgerService', () => {
  // 构建测试用 Manifest（允许指定实体的 maxRetries）
  interface TestManifestOpts {
    entityMaxRetries?: number
  }
  const createTestManifest = (opts?: TestManifestOpts): GenerationManifest => {
    const maxRetries = opts?.entityMaxRetries ?? 3
    return {
      meta: {
        schemaVersion: '2.0',
        manifestVersion: 1,
        generatedAt: '2026-07-11T00:00:00.000Z',
        contractVersion: 1,
        contractHash: 'a'.repeat(64),
      },
      entities: [
        {
          entityId: 'Wdesign_1a2b',
          entityType: 'workstream',
          contractRef: 'Wdesign_1a2b',
          label: '设计工作流',
          stageId: 'stage_intent_parsing',
          strategy: 'llm_generate',
          modelMode: 'non-thinking',
          maxOutputBudget: 4096,
          dependencies: [],
          validators: [],
          status: 'pending',
          attemptCount: 0,
          maxRetries,
        },
        {
          entityId: 'Papi_5e6f',
          entityType: 'work_package',
          contractRef: 'Papi_5e6f',
          label: 'API 开发',
          stageId: 'stage_intent_parsing',
          strategy: 'llm_generate',
          modelMode: 'non-thinking',
          maxOutputBudget: 4096,
          dependencies: ['Wdesign_1a2b'],
          validators: [],
          status: 'pending',
          attemptCount: 0,
          maxRetries,
        },
      ],
      batchPlan: [],
      executionPhases: [],
      tokenBudget: { totalEstimated: 0, perBatch: {}, perEntity: {} },
      totalEntities: 2,
      completedEntities: 0,
      failedEntities: 0,
    }
  }

  // ── 3.1 初始化 ──

  test('从 Manifest 初始化后实体数量一致', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    assert.equal(svc.entryCount, 2)
  })

  test('无依赖实体初始为 ready 状态', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    const entry = svc.getEntry('Wdesign_1a2b')
    assert.equal(entry?.status, 'ready')
  })

  test('有依赖实体初始为 pending 状态', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    const entry = svc.getEntry('Papi_5e6f')
    assert.equal(entry?.status, 'pending')
  })

  test('初始化后整体完整度为 0', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    const summary = svc.getSummary()
    assert.equal(summary.overallCompleteness, 0)
  })

  // ── 3.2 状态机守卫 ──

  test('合法转移：ready → generating', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    svc.transitionTo('Wdesign_1a2b', 'generating')
    assert.equal(svc.getEntry('Wdesign_1a2b')?.status, 'generating')
  })

  test('合法转移：generating → generated', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.transitionTo('Wdesign_1a2b', 'generated')
    assert.equal(svc.getEntry('Wdesign_1a2b')?.status, 'generated')
  })

  test('合法转移：validating → validated → committed_to_pdm', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.transitionTo('Wdesign_1a2b', 'generated')
    svc.transitionTo('Wdesign_1a2b', 'validating')
    svc.transitionTo('Wdesign_1a2b', 'validated')
    svc.markCommitted('Wdesign_1a2b', 'art://output/1')
    assert.equal(svc.getEntry('Wdesign_1a2b')?.status, 'committed_to_pdm')
  })

  test('非法转移：pending → committed_to_pdm 抛出异常', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    assert.throws(() => svc.transitionTo('Wdesign_1a2b', 'committed_to_pdm'), TransitionError)
  })

  test('非法转移：pending → failed_retryable 抛出异常', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    assert.throws(() => svc.transitionTo('Wdesign_1a2b', 'failed_retryable'))
  })

  test('非法转移：generated → committed_to_pdm 抛出异常（缺少 validating）', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.transitionTo('Wdesign_1a2b', 'generated')
    assert.throws(() => svc.transitionTo('Wdesign_1a2b', 'committed_to_pdm'))
  })

  // ── 3.3 重试与人工复核 ──

  test('markFailed 未达上限标记为 failed_retryable', ({ assert }) => {
    const svc = new CompletenessLedgerService({ defaultMaxRetries: 3 })
    svc.initialize(createTestManifest(), 1)
    svc.transitionTo('Wdesign_1a2b', 'generating')
    const status = svc.markFailed('Wdesign_1a2b', 'JSON 解析错误')
    assert.equal(status, 'failed_retryable')
    assert.equal(svc.getEntry('Wdesign_1a2b')?.currentAttempt, 1)
  })

  test('重试耗尽后进入 needs_human_review', ({ assert }) => {
    const svc = new CompletenessLedgerService({ defaultMaxRetries: 2 })
    svc.initialize(createTestManifest({ entityMaxRetries: 2 }), 1)

    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.markFailed('Wdesign_1a2b', '错误 1') // attempt 1, retries left: 1
    assert.equal(svc.getEntry('Wdesign_1a2b')?.status, 'failed_retryable')

    svc.transitionTo('Wdesign_1a2b', 'ready')
    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.markFailed('Wdesign_1a2b', '错误 2') // attempt 2, retries left: 0
    assert.equal(svc.getEntry('Wdesign_1a2b')?.status, 'needs_human_review')

    // 2 attempts, exhausted
    assert.equal(svc.getEntry('Wdesign_1a2b')?.currentAttempt, 2)
  })

  test('多次 attempt 被正确记录', ({ assert }) => {
    const svc = new CompletenessLedgerService({ defaultMaxRetries: 3 })
    svc.initialize(createTestManifest(), 1)

    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.markFailed('Wdesign_1a2b', 'error 1')
    assert.equal(svc.getEntry('Wdesign_1a2b')?.attempts.length, 1)

    svc.transitionTo('Wdesign_1a2b', 'ready')
    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.markFailed('Wdesign_1a2b', 'error 2')
    assert.equal(svc.getEntry('Wdesign_1a2b')?.attempts.length, 2)
  })

  // ── 3.4 完整度聚合 ──

  test('完整度准确反映已提交比例', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)

    // 提交一个实体
    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.transitionTo('Wdesign_1a2b', 'generated')
    svc.transitionTo('Wdesign_1a2b', 'validating')
    svc.transitionTo('Wdesign_1a2b', 'validated')
    svc.markCommitted('Wdesign_1a2b', 'art://1')

    const summary = svc.getSummary()
    assert.equal(summary.overallCompleteness, 0.5) // 1/2 = 0.5
    assert.equal(summary.statusCounts.committed_to_pdm, 1)
    assert.equal(summary.statusCounts.pending, 1)
  })

  test('needsHumanReviewCount 正确', ({ assert }) => {
    const svc = new CompletenessLedgerService({ defaultMaxRetries: 1 })
    svc.initialize(createTestManifest({ entityMaxRetries: 1 }), 1)

    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.markFailed('Wdesign_1a2b', 'reach limit')
    // after 1 attempt with maxRetries=1 → needs_human_review
    // actually with maxRetries=1: currentAttempt=1 >= maxRetries(1) → needs_human_review
    const summary = svc.getSummary()
    assert.equal(summary.needsHumanReviewCount, 1)
  })

  test('所有提交后完整度为 1.0', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    // 先提交 Wdesign_1a2b（无依赖）
    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.transitionTo('Wdesign_1a2b', 'generated')
    svc.transitionTo('Wdesign_1a2b', 'validating')
    svc.transitionTo('Wdesign_1a2b', 'validated')
    svc.markCommitted('Wdesign_1a2b', 'art://1')
    // Papi_5e6f 依赖 Wdesign_1a2b，需手动放行 ready 再提交
    svc.transitionTo('Papi_5e6f', 'ready')
    svc.transitionTo('Papi_5e6f', 'generating')
    svc.transitionTo('Papi_5e6f', 'generated')
    svc.transitionTo('Papi_5e6f', 'validating')
    svc.transitionTo('Papi_5e6f', 'validated')
    svc.markCommitted('Papi_5e6f', 'art://2')
    assert.equal(svc.getSummary().overallCompleteness, 1.0)
  })

  // ── 3.5 Resume 分类 ──

  test('Resume 队列：committed_to_pdm 被跳过', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.transitionTo('Wdesign_1a2b', 'generated')
    svc.transitionTo('Wdesign_1a2b', 'validating')
    svc.transitionTo('Wdesign_1a2b', 'validated')
    svc.markCommitted('Wdesign_1a2b', 'art://1')

    const queue = svc.classifyResumeQueue()
    assert.includeMembers(queue.skipped, ['Wdesign_1a2b'])
  })

  test('Resume 队列：generating 残留转为重试', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    svc.transitionTo('Wdesign_1a2b', 'generating')

    const queue = svc.classifyResumeQueue()
    assert.includeMembers(queue.needsRetry, ['Wdesign_1a2b'])
  })

  test('Resume 队列：generated 进入验证队列', ({ assert }) => {
    const svc = new CompletenessLedgerService()
    svc.initialize(createTestManifest(), 1)
    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.transitionTo('Wdesign_1a2b', 'generated')

    const queue = svc.classifyResumeQueue()
    assert.includeMembers(queue.needsValidation, ['Wdesign_1a2b'])
  })

  test('Resume 队列：needs_human_review 标记需人工', ({ assert }) => {
    const svc = new CompletenessLedgerService({ defaultMaxRetries: 0 })
    svc.initialize(createTestManifest({ entityMaxRetries: 0 }), 1)
    svc.transitionTo('Wdesign_1a2b', 'generating')
    svc.markFailed('Wdesign_1a2b', 'exhausted')

    const queue = svc.classifyResumeQueue()
    assert.includeMembers(queue.needsHumanReview, ['Wdesign_1a2b'])
  })
})
