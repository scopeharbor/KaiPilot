/**
 * v3-codegen-34-stage-candidate-runtime-execution —— 34 阶段候选运行驱动器测试。
 *
 * 覆盖 tasks 3.4 / 5.x / 6.1-6.8：
 * - 一次 execute 走满 34 轮，产出 34 条持久化 stage 记录与人工复核 packet
 * - 完成后仍恒为待人工复核，零仓库写回
 * - 越权工具 / 跨 stage 结果 / 声明副作用 / 敏感元数据 → 停机并回滚（不部分提交）
 * - 记录跨「进程」可读、跨组织不可读
 * - 复核门基于持久化记录重算，未满 34 恒为 blocked
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  CODE_CANDIDATE_SIDE_EFFECT_KINDS,
  CODE_GENERATION_STAGE_IDS,
  type CodeCandidateSideEffectKind,
  type CodeGenerationStageRuntimeFrame,
  type CodeGenerationToolInvocation,
  type CodeGenerationToolResult,
} from '@aiproj/types/compiler-code-generation'
import Organization from '#models/organization'
import User from '#models/user'
import CompilerCodegenCandidateRun from '#models/compiler_codegen_candidate_run'
import CompilerCodegenStageRecord from '#models/compiler_codegen_stage_record'
import {
  CodeGenerationModuleFlowService,
  CodeGenerationStageRuntime,
  CodegenFixtureProvider,
} from '#services/compiler/code-generation/index'
import { DbCodeGenerationModuleMemory } from '#services/compiler/code-generation/codegen_module_memory_repository'
import {
  CodegenCandidateRunService,
  CODEGEN_STAGE_TOTAL,
  createCodegenCandidateRunService,
  describeCodegenStage,
} from '#services/compiler/code-generation/codegen_candidate_run_service'

// ── Helpers ──

async function createOrgAndUser(suffix: string): Promise<{ org: Organization; user: User }> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const user = await User.create({
    email: `codegen-${suffix}-${unique}@test.local`,
    password: 'Password123!',
    fullName: 'Codegen Test User',
    authProvider: 'local',
    isActive: true,
  })
  const org = await Organization.create({
    ownerId: user.id,
    name: `Codegen Org ${unique}`,
    slug: `codegen-${suffix}-${unique}`,
  })
  return { org, user }
}

function runInput(org: Organization, user: User, sessionSuffix: string) {
  return {
    organizationId: org.id,
    projectId: 1,
    actorId: user.id,
    provider: 'openai_responses' as const,
    runtimeSessionId: `codegen-session-${org.id}-${sessionSuffix}`,
  }
}

/** 越权：在只暴露 read_blueprint / validate_schema 的 stage 1 里调 write_candidate_artifact。 */
class UnauthorizedToolProvider extends CodegenFixtureProvider {
  override produceRawToolCall(frame: CodeGenerationStageRuntimeFrame) {
    return {
      provider: 'openai_responses' as const,
      item: {
        type: 'function_call',
        call_id: this.buildCallId(frame),
        name: 'write_candidate_artifact',
        arguments: JSON.stringify({ stageId: frame.stageId }),
      },
    }
  }
}

/** 跨 stage：结果声明了另一个 stage 的身份。 */
class CrossStageResultProvider extends CodegenFixtureProvider {
  override produceToolResult(
    frame: CodeGenerationStageRuntimeFrame,
    invocation: CodeGenerationToolInvocation,
  ): CodeGenerationToolResult {
    return {
      ...super.produceToolResult(frame, invocation),
      stageId: CODE_GENERATION_STAGE_IDS[5],
    }
  }
}

/** 副作用：声明 none 之外的任意副作用种类。 */
class SideEffectProvider extends CodegenFixtureProvider {
  constructor(private readonly kind: CodeCandidateSideEffectKind) {
    super()
  }

  override produceToolResult(
    frame: CodeGenerationStageRuntimeFrame,
    invocation: CodeGenerationToolInvocation,
  ): CodeGenerationToolResult {
    return { ...super.produceToolResult(frame, invocation), sideEffectKind: this.kind }
  }
}

/** 敏感元数据：结果里塞入 token / prompt 字段。 */
class SensitiveMetadataProvider extends CodegenFixtureProvider {
  override produceToolResult(
    frame: CodeGenerationStageRuntimeFrame,
    invocation: CodeGenerationToolInvocation,
  ): CodeGenerationToolResult {
    return {
      ...super.produceToolResult(frame, invocation),
      metadata: { token: 'should-never-be-persisted', prompt: 'leaked' },
    }
  }
}

test.group('Codegen 34 阶段候选运行 —— 完整推进', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })
  group.each.setup(async () => {
    await testUtils.db().truncate()
  })

  test('一次 execute 走满 34 轮并产出人工复核 packet', async ({ assert }) => {
    const { org, user } = await createOrgAndUser('full')
    const startedAt = Date.now()
    const outcome = await new CodegenCandidateRunService().execute(runInput(org, user, 'full'))
    const elapsedMs = Date.now() - startedAt

    assert.isFalse(outcome.halted)
    assert.equal(outcome.completedStageCount, CODEGEN_STAGE_TOTAL)
    assert.equal(CODEGEN_STAGE_TOTAL, 34)

    const run = await CompilerCodegenCandidateRun.findOrFail(outcome.run.id)
    assert.equal(run.status, 'candidate_ready_pending_review')
    assert.equal(run.completedStageCount, 34)
    assert.isNull(run.currentStageId)
    assert.isNull(run.failureReasonCode)
    assert.equal(run.executionMode, 'fixture')
    assert.isNotNull(run.reviewPacketJson)
    assert.isTrue(run.reviewPacketJson!.readyForHumanReview)
    assert.lengthOf(run.reviewPacketJson!.completedStageIds, 34)

    const records = await CompilerCodegenStageRecord.query()
      .where('run_id', run.id)
      .orderBy('stage_order', 'asc')
    assert.lengthOf(records, 34)
    assert.deepEqual(
      records.map((r) => r.stageOrder),
      Array.from({ length: 34 }, (_, i) => i + 1),
    )
    assert.deepEqual(
      records.map((r) => r.stageId),
      [...CODE_GENERATION_STAGE_IDS],
    )
    // 每条记录都带 frame 证据：该 stage 实际可见的工具与上下文域
    for (const record of records) {
      assert.isAbove(record.visibleToolIdsJson.length, 0)
      assert.isNotEmpty(record.contextScope)
      assert.equal(record.reasonCode, 'CODEGEN_PLAN_READY')
      assert.isTrue(record.artifactRefsJson.every((ref) => ref.startsWith('codegen-candidate://')))
    }

    // tasks 6.9：记录实测耗时，超请求超时才需降级为分步 advance 接口
    console.log(`[codegen] 34 轮耗时 ${elapsedMs}ms`)
    assert.isBelow(elapsedMs, 30000)
  })

  test('完成后仍恒为待人工复核，且不写任何仓库产物', async ({ assert }) => {
    const { org, user } = await createOrgAndUser('review')
    const outcome = await new CodegenCandidateRunService().execute(runInput(org, user, 'review'))

    const run = await CompilerCodegenCandidateRun.findOrFail(outcome.run.id)
    // 状态机不含 applied / approved：没有任何自动转正路径
    assert.notInclude(['applied', 'approved'], run.status)
    assert.equal(run.status, 'candidate_ready_pending_review')

    const records = await CompilerCodegenStageRecord.query().where('run_id', run.id)
    for (const record of records) {
      // 候选引用而非仓库路径：不含绝对路径、不含父目录穿越
      for (const ref of record.artifactRefsJson) {
        assert.isTrue(ref.startsWith('codegen-candidate://'))
        assert.notInclude(ref, '..')
      }
    }
  })

  test('模块记录跨进程可读且复核门可重算', async ({ assert }) => {
    const { org, user } = await createOrgAndUser('durable')
    const outcome = await new CodegenCandidateRunService().execute(runInput(org, user, 'durable'))

    // 全新的端口与 flow 实例（无任何进程内状态）重放复核门
    const memory = new DbCodeGenerationModuleMemory({
      runId: outcome.run.id,
      organizationId: org.id,
    })
    const flow = new CodeGenerationModuleFlowService(new CodeGenerationStageRuntime(), memory)
    const gate = await flow.requestHumanReview({
      runtimeSessionId: outcome.run.runtimeSessionId,
      provider: 'openai_responses',
    })

    assert.isTrue(gate.validation.ok)
    assert.isTrue(gate.snapshot.readyForHumanReview)
    assert.lengthOf(gate.snapshot.completedStageIds, 34)
    assert.lengthOf(gate.snapshot.pendingStageIds, 0)
  })

  test('跨组织读取不到任何模块记录', async ({ assert }) => {
    const { org, user } = await createOrgAndUser('iso')
    const outcome = await new CodegenCandidateRunService().execute(runInput(org, user, 'iso'))

    const foreignMemory = new DbCodeGenerationModuleMemory({
      runId: outcome.run.id,
      organizationId: org.id + 9999,
    })
    const records = await foreignMemory.list(outcome.run.runtimeSessionId)
    assert.lengthOf(records, 0)

    const foreignFlow = new CodeGenerationModuleFlowService(
      new CodeGenerationStageRuntime(),
      foreignMemory,
    )
    const gate = await foreignFlow.requestHumanReview({
      runtimeSessionId: outcome.run.runtimeSessionId,
      provider: 'openai_responses',
    })
    assert.isFalse(gate.snapshot.readyForHumanReview)
    assert.lengthOf(gate.snapshot.completedStageIds, 0)
  })

  test('模块记录写入幂等', async ({ assert }) => {
    const { org, user } = await createOrgAndUser('idem')
    const outcome = await new CodegenCandidateRunService().execute(runInput(org, user, 'idem'))

    const memory = new DbCodeGenerationModuleMemory({
      runId: outcome.run.id,
      organizationId: org.id,
    })
    const existing = await memory.list(outcome.run.runtimeSessionId)
    const saved = await memory.save(existing[0])

    assert.deepEqual(saved.stageId, existing[0].stageId)
    const after = await memory.list(outcome.run.runtimeSessionId)
    assert.lengthOf(after, 34)
  })
})

test.group('Codegen 候选运行 —— 只读辅助', () => {
  test('describeCodegenStage 只输出低敏 stage 元数据', ({ assert }) => {
    const described = describeCodegenStage(CODE_GENERATION_STAGE_IDS[0])
    assert.isDefined(described)
    assert.equal(described!.stageId, CODE_GENERATION_STAGE_IDS[0])
    assert.equal(described!.order, 1)
    assert.isNotEmpty(described!.contextScope)
    assert.isAbove(described!.allowedTools.length, 0)
    assert.isArray(described!.dependsOn)
    // 低敏：不得暴露 prompt / 系统指令 / 凭据类字段
    const serialized = JSON.stringify(described).toLowerCase()
    for (const forbidden of ['prompt', 'token', 'secret', 'apikey', 'completion']) {
      assert.notInclude(serialized, `"${forbidden}"`)
    }
  })

  test('describeCodegenStage 对未知 stage 返回 undefined', ({ assert }) => {
    assert.isUndefined(describeCodegenStage('codegen_99_not_a_stage' as never))
  })

  test('createCodegenCandidateRunService 返回默认 fixture 驱动器', ({ assert }) => {
    assert.instanceOf(createCodegenCandidateRunService(), CodegenCandidateRunService)
  })
})

test.group('Codegen 34 阶段候选运行 —— 停机路径', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })
  group.each.setup(async () => {
    await testUtils.db().truncate()
  })

  test('越权工具调用停机于 CODEGEN_TOOL_CALL_UNAUTHORIZED', async ({ assert }) => {
    const { org, user } = await createOrgAndUser('unauth')
    const outcome = await new CodegenCandidateRunService(new UnauthorizedToolProvider()).execute(
      runInput(org, user, 'unauth'),
    )

    assert.isTrue(outcome.halted)
    assert.equal(outcome.failureReasonCode, 'CODEGEN_TOOL_CALL_UNAUTHORIZED')
    assert.equal(outcome.failureStageId, CODE_GENERATION_STAGE_IDS[0])

    const run = await CompilerCodegenCandidateRun.findOrFail(outcome.run.id)
    assert.equal(run.status, 'halted')
    assert.equal(run.failureReasonCode, 'CODEGEN_TOOL_CALL_UNAUTHORIZED')

    // 不部分提交：该 stage 无完成记录
    const records = await CompilerCodegenStageRecord.query().where('run_id', run.id)
    assert.lengthOf(records, 0)
  })

  test('跨 stage 结果停机于 CODEGEN_TOOL_RESULT_CROSS_STAGE', async ({ assert }) => {
    const { org, user } = await createOrgAndUser('cross')
    const outcome = await new CodegenCandidateRunService(new CrossStageResultProvider()).execute(
      runInput(org, user, 'cross'),
    )

    assert.isTrue(outcome.halted)
    assert.equal(outcome.failureReasonCode, 'CODEGEN_TOOL_RESULT_CROSS_STAGE')

    const records = await CompilerCodegenStageRecord.query().where('run_id', outcome.run.id)
    assert.lengthOf(records, 0)
  })

  test('任何非 none 副作用都停机于 CODEGEN_UNSAFE_SIDE_EFFECT', async ({ assert }) => {
    const unsafeKinds = CODE_CANDIDATE_SIDE_EFFECT_KINDS.filter((kind) => kind !== 'none')
    assert.isAbove(unsafeKinds.length, 0)

    for (const kind of unsafeKinds) {
      const { org, user } = await createOrgAndUser(`side-${kind}`)
      const outcome = await new CodegenCandidateRunService(new SideEffectProvider(kind)).execute(
        runInput(org, user, `side-${kind}`),
      )

      assert.isTrue(outcome.halted, `${kind} 应停机`)
      assert.equal(outcome.failureReasonCode, 'CODEGEN_UNSAFE_SIDE_EFFECT', `${kind}`)

      const records = await CompilerCodegenStageRecord.query().where('run_id', outcome.run.id)
      assert.lengthOf(records, 0)
    }
  })

  test('敏感元数据停机于 CODEGEN_SENSITIVE_METADATA 且不落库', async ({ assert }) => {
    const { org, user } = await createOrgAndUser('sensitive')
    const outcome = await new CodegenCandidateRunService(new SensitiveMetadataProvider()).execute(
      runInput(org, user, 'sensitive'),
    )

    assert.isTrue(outcome.halted)
    assert.equal(outcome.failureReasonCode, 'CODEGEN_SENSITIVE_METADATA')

    const records = await CompilerCodegenStageRecord.query().where('run_id', outcome.run.id)
    assert.lengthOf(records, 0)

    const run = await CompilerCodegenCandidateRun.findOrFail(outcome.run.id)
    const serialized = JSON.stringify(run.serialize()).toLowerCase()
    assert.notInclude(serialized, 'should-never-be-persisted')
  })

  test('依赖未完成时模块流拒绝完成并给出 CODEGEN_STAGE_DEPENDENCY_INCOMPLETE', async ({
    assert,
  }) => {
    // 注：有序驱动器天然不会跳序，因此这里直接对持久化端口验证依赖门本身。
    const { org, user } = await createOrgAndUser('dep')
    const run = await CompilerCodegenCandidateRun.create({
      organizationId: org.id,
      projectId: 1,
      createdBy: user.id,
      runtimeSessionId: `codegen-dep-${org.id}`,
      catalogVersion: '1.0',
      provider: 'openai_responses',
      executionMode: 'fixture',
      status: 'running',
      stageCount: CODEGEN_STAGE_TOTAL,
      completedStageCount: 0,
    })

    const memory = new DbCodeGenerationModuleMemory({ runId: run.id, organizationId: org.id })
    const flow = new CodeGenerationModuleFlowService(new CodeGenerationStageRuntime(), memory)

    const completion = await flow.completeStage({
      runtimeSessionId: run.runtimeSessionId,
      provider: 'openai_responses',
      stageId: CODE_GENERATION_STAGE_IDS[1],
      summary: '跳过 stage 1 直接完成 stage 2',
    })

    assert.isFalse(completion.validation.ok)
    assert.include(completion.validation.reasonCodes, 'CODEGEN_STAGE_DEPENDENCY_INCOMPLETE')
    const records = await CompilerCodegenStageRecord.query().where('run_id', run.id)
    assert.lengthOf(records, 0)
  })

  test('未满 34 时复核门恒为 blocked 并列出剩余 stage', async ({ assert }) => {
    const { org, user } = await createOrgAndUser('gate')
    const run = await CompilerCodegenCandidateRun.create({
      organizationId: org.id,
      projectId: 1,
      createdBy: user.id,
      runtimeSessionId: `codegen-gate-${org.id}`,
      catalogVersion: '1.0',
      provider: 'openai_responses',
      executionMode: 'fixture',
      status: 'running',
      stageCount: CODEGEN_STAGE_TOTAL,
      completedStageCount: 0,
    })

    const memory = new DbCodeGenerationModuleMemory({ runId: run.id, organizationId: org.id })
    const flow = new CodeGenerationModuleFlowService(new CodeGenerationStageRuntime(), memory)
    await flow.completeStage({
      runtimeSessionId: run.runtimeSessionId,
      provider: 'openai_responses',
      stageId: CODE_GENERATION_STAGE_IDS[0],
      summary: '仅完成第一个 stage',
    })

    // 全新端口实例重算：进程内状态全部丢弃
    const freshFlow = new CodeGenerationModuleFlowService(
      new CodeGenerationStageRuntime(),
      new DbCodeGenerationModuleMemory({ runId: run.id, organizationId: org.id }),
    )
    const gate = await freshFlow.requestHumanReview({
      runtimeSessionId: run.runtimeSessionId,
      provider: 'openai_responses',
    })

    assert.isFalse(gate.validation.ok)
    assert.isFalse(gate.snapshot.readyForHumanReview)
    assert.lengthOf(gate.snapshot.completedStageIds, 1)
    assert.lengthOf(gate.snapshot.pendingStageIds, 33)
  })
})
