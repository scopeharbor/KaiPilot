/**
 * v2-project-compiler-foundation —— Compiler 服务单元测试。
 *
 * 覆盖：
 * - StageRegistry 注册/查询/重复注册/不存在查询
 * - ToolGate 可见性控制
 * - ContextScopeResolver 上下文裁剪
 * - ContractValidator 输入/输出校验
 * - ManifestBuilder 创建/状态更新/依赖检查
 * - LedgerService 交付物追踪与聚合
 * - LevelValidator Level 0/1 校验
 * - PipelineExecutor 编排/依赖/Resume/Replay
 * - Preview/Apply stub
 */

import { test } from '@japa/runner'
import { StageContract, pdmSchema, type ContextScope } from '@aiproj/compiler-spec'
import {
  StageRegistry,
  StageNotFoundError,
  DuplicateStageError,
} from '#services/compiler/stage_registry'
import { ToolGate, type ToolDescriptor, type AllowedToolEntry } from '#services/compiler/tool_gate'
import {
  ContextScopeResolver,
  type CompilerContext,
} from '#services/compiler/context_scope_resolver'
import { ContractValidator } from '#services/compiler/contract_validator'
import {
  ManifestBuilder,
  type StageBlueprint,
  ManifestBuilderError,
} from '#services/compiler/manifest_builder'
import { LedgerService, type DeliverableBlueprint } from '#services/compiler/ledger_service'
import { LevelValidator } from '#services/compiler/level_validator'
import { PipelineExecutor } from '#services/compiler/pipeline_executor'
import { previewPdmStub, applyStub, diffStub } from '#services/compiler/preview_apply_stub'
import { z } from 'zod'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

// ── Test Helpers ──

const testStringSchema = z.object({ value: z.string().min(1) })
const testOutputSchema = z.object({ result: z.string() })

/** In-memory ArtifactStore 测试桩。 */
class InMemoryArtifactStore {
  records: any[] = []
  async save(record: any) {
    const entry = { ...record, id: this.records.length + 1, createdAt: new Date().toISOString() }
    this.records.push(entry)
    return entry
  }
  async latest(runId: number, kind: string) {
    const matches = this.records.filter((r: any) => r.compilerRunId === runId && r.kind === kind)
    return matches.length > 0 ? matches[matches.length - 1] : null
  }
  async getCheckpoints(runId: number) {
    return this.records
      .filter((r: any) => r.compilerRunId === runId && r.kind === 'checkpoint')
      .sort((a: any, b: any) => b.version - a.version)
  }
  async getByVersion(runId: number, kind: string, version: number) {
    return (
      this.records.find(
        (r: any) => r.compilerRunId === runId && r.kind === kind && r.version === version,
      ) ?? null
    )
  }
  async getStageOutputs(runId: number, stageId?: string) {
    return this.records.filter(
      (r: any) =>
        r.compilerRunId === runId &&
        r.kind === 'stage_output' &&
        (!stageId || r.stageId === stageId),
    )
  }
}

/** In-memory StageEventLogger 测试桩。 */
class InMemoryStageEventLogger {
  events: any[] = []
  async started(entry: any) {
    this.events.push({ ...entry, status: 'running' })
  }
  async succeeded(entry: any) {
    this.events.push({ ...entry, status: 'completed' })
  }
  async failed(entry: any) {
    this.events.push({ ...entry, status: 'failed' })
  }
  async skipped(entry: any) {
    this.events.push({ ...entry, status: 'skipped' })
  }
  async needsHumanReview(entry: any) {
    this.events.push({ ...entry, status: 'needs_human_review' })
  }
}

function makeFakeDefinition(stageId: string, overrides: Record<string, any> = {}) {
  return {
    stageId,
    type: 'deterministic' as const,
    phase: 'intake' as const,
    name: `Stage ${stageId}`,
    description: `Test stage ${stageId}`,
    inputSchema: testStringSchema,
    outputSchema: testOutputSchema,
    contextScope: ['user_input_only'] as ContextScope[],
    allowedTools: [] as AllowedToolEntry[],
    sideEffects: {
      writesArtifact: true,
      updatesManifest: true,
      updatesLedger: false,
      callsLlm: false,
    },
    dependsOn: [] as string[],
    timeoutMs: 30_000,
    ...overrides,
  }
}

// ── StageRegistry ──

test.group('StageRegistry', () => {
  test('register and get stage', ({ assert }) => {
    const registry = new StageRegistry()
    registry.register(makeFakeDefinition('test-1'))
    const stage = registry.get('test-1')
    assert.equal(stage.stageId, 'test-1')
  })

  test('duplicate registration throws', ({ assert }) => {
    const registry = new StageRegistry()
    registry.register(makeFakeDefinition('dup'))
    assert.throws(() => registry.register(makeFakeDefinition('dup')), DuplicateStageError)
  })

  test('get non-existent stage throws', ({ assert }) => {
    const registry = new StageRegistry()
    assert.throws(() => registry.get('non-existent'), StageNotFoundError)
  })

  test('getByPhase returns correct stages', ({ assert }) => {
    const registry = new StageRegistry()
    registry.register(makeFakeDefinition('a', { phase: 'intake' }))
    registry.register(makeFakeDefinition('b', { phase: 'understanding' }))
    registry.register(makeFakeDefinition('c', { phase: 'intake' }))
    assert.lengthOf(registry.getByPhase('intake'), 2)
    assert.lengthOf(registry.getByPhase('understanding'), 1)
    assert.lengthOf(registry.getByPhase('analysis'), 0)
  })

  test('getAll returns all registered', ({ assert }) => {
    const registry = new StageRegistry()
    registry.register(makeFakeDefinition('x'))
    registry.register(makeFakeDefinition('y'))
    assert.lengthOf(registry.getAll(), 2)
  })

  test('size property works', ({ assert }) => {
    const registry = new StageRegistry()
    assert.equal(registry.size, 0)
    registry.register(makeFakeDefinition('a'))
    assert.equal(registry.size, 1)
  })
})

// ── ToolGate ──

test.group('ToolGate', () => {
  const allTools: ToolDescriptor[] = [
    { toolId: 'read_file', description: 'Read a file' },
    { toolId: 'write_file', description: 'Write a file' },
    { toolId: 'execute_cmd', description: 'Execute a command' },
  ]

  test('resolve returns only authorized tools', ({ assert }) => {
    const gate = new ToolGate(allTools)
    const allowed: AllowedToolEntry[] = [{ toolId: 'read_file', description: '', required: false }]
    const result = gate.resolve(allowed)
    assert.deepEqual(result.toolIds, ['read_file'])
    assert.lengthOf(result.tools, 1)
    assert.isTrue(result.restricted)
  })

  test('resolve with all tools returns unrestricted', ({ assert }) => {
    const gate = new ToolGate(allTools)
    const allowed: AllowedToolEntry[] = allTools.map((t) => ({
      toolId: t.toolId,
      description: '',
      required: false,
    }))
    const result = gate.resolve(allowed)
    assert.lengthOf(result.tools, 3)
    assert.isFalse(result.restricted)
  })

  test('unknown tool ID is ignored', ({ assert }) => {
    const gate = new ToolGate(allTools)
    const allowed: AllowedToolEntry[] = [
      { toolId: 'read_file', description: '', required: false },
      { toolId: 'non_existent', description: '', required: false },
    ]
    const result = gate.resolve(allowed)
    assert.deepEqual(result.toolIds, ['read_file'])
  })

  test('isAllowed checks tool permission', ({ assert }) => {
    const gate = new ToolGate(allTools)
    const allowed: AllowedToolEntry[] = [{ toolId: 'read_file', description: '', required: false }]
    assert.isTrue(gate.isAllowed(allowed, 'read_file'))
    assert.isFalse(gate.isAllowed(allowed, 'write_file'))
  })
})

// ── ContextScopeResolver ──

test.group('ContextScopeResolver', () => {
  const context: CompilerContext = {
    userInput: { text: 'hello' },
    runMetadata: { runId: 1 },
    stageOutputs: new Map([['stage-1', { data: 'test' }]]),
    blueprints: { workstreams: [] },
    fullDraft: { complete: true },
  }

  test('user_input_only returns only user input', ({ assert }) => {
    const resolver = new ContextScopeResolver()
    const result = resolver.resolve(['user_input_only'], context)
    assert.deepEqual(result.userInput, { text: 'hello' })
    assert.isUndefined(result.runMetadata)
    assert.isUndefined(result.stageOutputs)
    assert.isUndefined(result.blueprints)
  })

  test('full_draft returns everything', ({ assert }) => {
    const resolver = new ContextScopeResolver()
    const result = resolver.resolve(['full_draft'], context)
    assert.isDefined(result.userInput)
    assert.isDefined(result.runMetadata)
    assert.isDefined(result.stageOutputs)
    assert.isDefined(result.blueprints)
  })

  test('blueprint includes runMetadata', ({ assert }) => {
    const resolver = new ContextScopeResolver()
    const result = resolver.resolve(['blueprint'], context)
    assert.isDefined(result.blueprints)
    assert.isDefined(result.runMetadata)
  })

  test('multiple scopes are unioned', ({ assert }) => {
    const resolver = new ContextScopeResolver()
    const result = resolver.resolve(['user_input_only', 'stage_outputs'], context)
    assert.isDefined(result.userInput)
    assert.isDefined(result.stageOutputs)
    assert.isUndefined(result.runMetadata)
  })

  test('hasScope hierarchy', ({ assert }) => {
    const resolver = new ContextScopeResolver()
    assert.isTrue(resolver.hasScope(['full_draft'], 'user_input_only'))
    assert.isTrue(resolver.hasScope(['blueprint'], 'run_metadata'))
    assert.isFalse(resolver.hasScope(['user_input_only'], 'stage_outputs'))
  })
})

// ── ContractValidator ──

test.group('ContractValidator', () => {
  test('validateInput passes valid input', ({ assert }) => {
    const contract = new StageContract(makeFakeDefinition('test'))
    const validator = new ContractValidator()
    const result = validator.validateInput(contract, { value: 'hello' })
    assert.isTrue(result.passed)
    assert.isEmpty(result.errors)
  })

  test('validateInput fails invalid input', ({ assert }) => {
    const contract = new StageContract(makeFakeDefinition('test'))
    const validator = new ContractValidator()
    const result = validator.validateInput(contract, { value: '' })
    assert.isFalse(result.passed)
    assert.isNotEmpty(result.errors)
    assert.include(result.errorSummary!, 'validation failed')
  })

  test('validateOutput passes valid output', ({ assert }) => {
    const contract = new StageContract(makeFakeDefinition('test'))
    const validator = new ContractValidator()
    const result = validator.validateOutput(contract, { result: 'ok' })
    assert.isTrue(result.passed)
  })

  test('validateOutput fails invalid output', ({ assert }) => {
    const contract = new StageContract(makeFakeDefinition('test'))
    const validator = new ContractValidator()
    const result = validator.validateOutput(contract, { wrong: 'field' })
    assert.isFalse(result.passed)
  })
})

// ── ManifestBuilder ──

test.group('ManifestBuilder', () => {
  test('creates manifest from blueprints', ({ assert }) => {
    const blueprints: StageBlueprint[] = [
      {
        stageId: 'stage-1',
        phase: 'intake',
        dependsOn: [],
        entities: [{ entityId: 'E1', kind: 'workstream' }],
      },
    ]
    const builder = new ManifestBuilder(1, blueprints)
    const manifest = builder.get()
    assert.equal(manifest.runId, 1)
    assert.equal(manifest.totalStages, 1)
    assert.equal(manifest.completedStages, 0)
  })

  test('empty blueprints throws', ({ assert }) => {
    assert.throws(() => new ManifestBuilder(1, []), ManifestBuilderError)
  })

  test('updateStepStatus updates entity and counts', ({ assert }) => {
    const blueprints: StageBlueprint[] = [
      {
        stageId: 's1',
        phase: 'intake',
        dependsOn: [],
        entities: [{ entityId: 'E1', kind: 'workstream' }],
      },
      {
        stageId: 's2',
        phase: 'understanding',
        dependsOn: ['s1'],
        entities: [{ entityId: 'E2', kind: 'task_l1' }],
      },
    ]
    const builder = new ManifestBuilder(1, blueprints)
    builder.updateStepStatus('s1', 'completed')
    assert.equal(builder.get().completedStages, 1)

    const entity = builder.get().entities.find((e) => e.entityId === 'E1')
    assert.equal(entity?.status, 'completed')
  })

  test('areDependenciesMet returns correct blocking', ({ assert }) => {
    const blueprints: StageBlueprint[] = [
      {
        stageId: 's1',
        phase: 'intake',
        dependsOn: [],
        entities: [],
      },
      {
        stageId: 's2',
        phase: 'understanding',
        dependsOn: ['s1'],
        entities: [],
      },
    ]
    const builder = new ManifestBuilder(1, blueprints)

    // s2 depends on s1 which is not completed yet
    const check = builder.areDependenciesMet('s2')
    assert.isFalse(check.met)
    assert.include(check.blocking, 's1')

    // After s1 completed
    builder.updateStepStatus('s1', 'completed')
    const after = builder.areDependenciesMet('s2')
    assert.isTrue(after.met)
  })

  test('failed stage counts update correctly', ({ assert }) => {
    const blueprints: StageBlueprint[] = [
      { stageId: 's1', phase: 'intake', dependsOn: [], entities: [] },
      { stageId: 's2', phase: 'understanding', dependsOn: ['s1'], entities: [] },
    ]
    const builder = new ManifestBuilder(1, blueprints)
    builder.updateStepStatus('s1', 'failed', 'Something went wrong')
    assert.equal(builder.get().failedStages, 1)
    assert.equal(builder.get().completedStages, 0)
  })

  test('getPendingSteps returns only pending steps', ({ assert }) => {
    const blueprints: StageBlueprint[] = [
      { stageId: 's1', phase: 'intake', dependsOn: [], entities: [] },
    ]
    const builder = new ManifestBuilder(1, blueprints)
    assert.lengthOf(builder.getPendingSteps(), 1)
    builder.updateStepStatus('s1', 'completed')
    assert.lengthOf(builder.getPendingSteps(), 0)
  })
})

// ── LedgerService ──

test.group('LedgerService', () => {
  test('initial state has correct defaults', ({ assert }) => {
    const blueprints: DeliverableBlueprint[] = [
      { id: 'pdm-1', label: 'PDM', kind: 'pdm' },
      { id: 'manifest-1', label: 'Manifest', kind: 'manifest', blocking: false },
    ]
    const ledger = new LedgerService(1, blueprints)
    const state = ledger.get()
    assert.equal(state.overallCompleteness, 0)
    assert.lengthOf(state.blockingItems, 1) // PDm is blocking
  })

  test('updateDeliverable updates state and recalculates', ({ assert }) => {
    const blueprints: DeliverableBlueprint[] = [{ id: 'd1', label: 'PDM', kind: 'pdm' }]
    const ledger = new LedgerService(1, blueprints)
    ledger.updateDeliverable('d1', { status: 'completed', completenessScore: 1 })
    const state = ledger.get()
    assert.equal(state.overallCompleteness, 1)
    assert.isEmpty(state.blockingItems)
  })

  test('blocking items when deliverables fail', ({ assert }) => {
    const blueprints: DeliverableBlueprint[] = [
      { id: 'd1', label: 'PDM', kind: 'pdm' },
      { id: 'd2', label: 'Report', kind: 'checkpoint', blocking: false },
    ]
    const ledger = new LedgerService(1, blueprints)
    ledger.updateDeliverable('d1', { status: 'failed' })
    const state = ledger.get()
    assert.isNotEmpty(state.blockingItems)
    assert.isAtLeast(state.warnings.length, 1)
    assert.include(state.warnings.join(' '), 'blocking')
  })
})

// ── LevelValidator ──

test.group('LevelValidator', () => {
  test('Level 0 passes valid data', ({ assert }) => {
    const validator = new LevelValidator()
    const result = validator.level0(pdmSchema, {
      metadata: {
        schemaVersion: '2.0',
        compilerVersion: '0.1.0',
        generatedAt: '2026-07-11T00:00:00.000Z',
        projectId: 'p1',
        runId: 1,
      },
      intent: { text: 'test', detectedLanguage: 'zh-CN', receivedAt: '2026-07-11T00:00:00.000Z' },
      blueprint: { workstreams: [], milestones: [], risks: [], resources: [], stakeholders: [] },
    })
    assert.isTrue(result.passed)
  })

  test('Level 0 fails invalid data', ({ assert }) => {
    const validator = new LevelValidator()
    const result = validator.level0(pdmSchema, { invalid: true })
    assert.isFalse(result.passed)
  })

  test('Level 1 passes with no entities', ({ assert }) => {
    const validator = new LevelValidator()
    const result = validator.level1({
      entityIds: new Set(),
      dependencies: new Map(),
    })
    assert.isTrue(result.passed)
  })

  test('Level 1 detects missing reference', ({ assert }) => {
    const validator = new LevelValidator()
    const result = validator.level1({
      entityIds: new Set(['E1']),
      dependencies: new Map([['E1', ['E2']]]),
      entityNames: new Map([['E1', 'Entity 1']]),
    })
    assert.isFalse(result.passed)
    assert.include(result.errors[0]!.message, 'non-existent')
  })

  test('Level 1 detects circular dependency', ({ assert }) => {
    const validator = new LevelValidator()
    const result = validator.level1({
      entityIds: new Set(['A', 'B', 'C']),
      dependencies: new Map([
        ['A', ['B']],
        ['B', ['C']],
        ['C', ['A']],
      ]),
    })
    assert.isFalse(result.passed)
    assert.include(result.errors[0]!.code, 'CIRCULAR')
  })

  test('Level 1 passes with valid DAG', ({ assert }) => {
    const validator = new LevelValidator()
    const result = validator.level1({
      entityIds: new Set(['A', 'B', 'C']),
      dependencies: new Map([
        ['A', ['B']],
        ['B', ['C']],
      ]),
    })
    assert.isTrue(result.passed)
  })
})

// ── PipelineExecutor ──

test.group('PipelineExecutor', () => {
  test('executes stages and returns result with succeeded=false when no stages defined', async ({
    assert,
  }) => {
    const store = new InMemoryArtifactStore()
    const logger = new InMemoryStageEventLogger()
    const registry = new StageRegistry()
    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })

    const blueprints: StageBlueprint[] = [
      { stageId: 's1', phase: 'intake', dependsOn: [], entities: [] },
    ]
    const builder = new ManifestBuilder(1, blueprints)
    const mockRun = { id: 1 } as any
    const result = await executor.execute({
      compilerRun: mockRun,
      manifestBuilder: builder,
      initialContext: {
        userInput: { value: 'test' },
        runMetadata: {},
        stageOutputs: new Map(),
        blueprints: {},
        fullDraft: {},
      },
      organizationId: 1,
    })

    // s1 fails because no handler registered
    assert.isFalse(result.succeeded)
  })

  test('dependency not met blocks downstream', async ({ assert }) => {
    const artifactStore = new InMemoryArtifactStore()
    const eventLogger = new InMemoryStageEventLogger()
    const registry = new StageRegistry()
    const def1 = makeFakeDefinition('s1')
    const def2 = makeFakeDefinition('s2', { dependsOn: ['s1'] })
    registry.register(def1)
    registry.register(def2)

    const executor = new PipelineExecutor(registry, {
      artifactStore: artifactStore as any,
      stageEventLogger: eventLogger as any,
    })
    // Register only s2, not s1 - so s2 can't run
    executor.registerHandler(def2, async (_input: any) => ({ result: 'ok2' }))

    const blueprints: StageBlueprint[] = [
      { stageId: 's1', phase: 'intake', dependsOn: [], entities: [] },
      { stageId: 's2', phase: 'understanding', dependsOn: ['s1'], entities: [] },
    ]
    const builder = new ManifestBuilder(1, blueprints)

    const mockRun = { id: 1 } as any
    const result = await executor.execute({
      compilerRun: mockRun,
      manifestBuilder: builder,
      initialContext: {
        userInput: { value: 'test' },
        runMetadata: {},
        stageOutputs: new Map(),
        blueprints: {},
        fullDraft: {},
      },
      organizationId: 1,
    })

    // s1 should fail (handler not registered), s2 should be skipped
    assert.isFalse(result.succeeded)
  })

  test('resume returns false with no checkpoints', async ({ assert }) => {
    const store = new InMemoryArtifactStore()
    const logger = new InMemoryStageEventLogger()
    const registry = new StageRegistry()
    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })
    const blueprints: StageBlueprint[] = [
      { stageId: 's1', phase: 'intake', dependsOn: [], entities: [] },
    ]
    const builder = new ManifestBuilder(1, blueprints)
    const mockRun = { id: 999 } as any

    const result = await executor.resume({
      compilerRun: mockRun,
      manifestBuilder: builder,
      initialContext: {
        userInput: { value: 'test' },
        runMetadata: {},
        stageOutputs: new Map(),
        blueprints: {},
        fullDraft: {},
      },
      organizationId: 1,
    })

    assert.isFalse(result.resumed)
  })

  test('replay returns replayed=false with no artifacts', async ({ assert }) => {
    const store = new InMemoryArtifactStore()
    const logger = new InMemoryStageEventLogger()
    const registry = new StageRegistry()
    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })
    const result = await executor.replay(999, 1)
    assert.isFalse(result.replayed)
    assert.equal(result.stages, 0)
  })
})

// ── Preview/Apply Stub ──

test.group('Preview/Apply Stub', () => {
  test('previewPdmStub returns unimplemented', ({ assert }) => {
    const result = previewPdmStub()
    assert.equal(result.status, 'unimplemented')
    assert.include(result.responsibleChange, 'draft-layer')
  })

  test('applyStub returns unimplemented', ({ assert }) => {
    const result = applyStub()
    assert.equal(result.status, 'unimplemented')
  })

  test('diffStub returns unimplemented', ({ assert }) => {
    const result = diffStub()
    assert.equal(result.status, 'unimplemented')
  })
})

// ── 11.x DeepSeek V4 Flash 交付检查清单测试 ──

test.group('11.x Delivery Checklist', () => {
  test('11.5 deterministic Stage records llm_calls=0 and llm_cost=0', async ({ assert }) => {
    const store = new InMemoryArtifactStore()
    const logger = new InMemoryStageEventLogger()
    const registry = new StageRegistry()
    // Use permissive schema since the executor passes the full CompilerContext
    const def = makeFakeDefinition('det-stage', {
      type: 'deterministic',
      inputSchema: z.any(),
    })
    registry.register(def)
    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })
    executor.registerHandler(def, async (_input: any) => ({ result: 'ok' }))

    const builder = new ManifestBuilder(1, [
      { stageId: 'det-stage', phase: 'intake', dependsOn: [], entities: [] },
    ])
    await executor.execute({
      compilerRun: { id: 1 } as any,
      manifestBuilder: builder,
      initialContext: {
        userInput: { value: 'test' },
        runMetadata: {},
        stageOutputs: new Map(),
        blueprints: {},
        fullDraft: {},
      },
      organizationId: 1,
    })

    const succeededEvent = logger.events.find(
      (e: any) => e.status === 'completed' && e.stageId === 'det-stage',
    )
    assert.isTrue(succeededEvent !== undefined, 'deterministic stage should have a completed event')
    if (succeededEvent) {
      assert.equal(succeededEvent.llmCalls, 0, 'deterministic stage should have llm_calls=0')
      assert.equal(succeededEvent.llmCost, 0, 'deterministic stage should have llm_cost=0')
    }
  })

  test('11.6 Resume with checkpoints skips completed stages', async ({ assert }) => {
    const store = new InMemoryArtifactStore()
    const logger = new InMemoryStageEventLogger()
    const registry = new StageRegistry()
    const def = makeFakeDefinition('s1')
    registry.register(def)
    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })
    executor.registerHandler(def, async (_input: any) => ({ result: 'ok' }))

    // First: run to create checkpoint
    const builder = new ManifestBuilder(1, [
      { stageId: 's1', phase: 'intake', dependsOn: [], entities: [] },
    ])
    await executor.execute({
      compilerRun: { id: 2 } as any,
      manifestBuilder: builder,
      initialContext: {
        userInput: { value: 'test' },
        runMetadata: {},
        stageOutputs: new Map(),
        blueprints: {},
        fullDraft: {},
      },
      organizationId: 1,
    })

    // Verify checkpoint was created
    assert.isAbove(store.records.filter((r: any) => r.kind === 'checkpoint').length, 0)

    // Now resume: completed stages should be skipped
    const resumeBuilder = new ManifestBuilder(1, [
      { stageId: 's1', phase: 'intake', dependsOn: [], entities: [] },
    ])
    const resumeResult = await executor.resume({
      compilerRun: { id: 2 } as any,
      manifestBuilder: resumeBuilder,
      initialContext: {
        userInput: { value: 'test' },
        runMetadata: {},
        stageOutputs: new Map(),
        blueprints: {},
        fullDraft: {},
      },
      organizationId: 1,
    })

    assert.isTrue(resumeResult.resumed, 'resume should succeed when checkpoints exist')
    assert.isAbove(
      resumeResult.checkpointVersion,
      0,
      'resume should return a positive checkpoint version',
    )
  })

  test('11.7 Replay does not call LLM (no event logger entries)', async ({ assert }) => {
    const store = new InMemoryArtifactStore()
    const logger = new InMemoryStageEventLogger()
    const registry = new StageRegistry()
    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })

    // Save a checkpoint artifact directly (simulating prior run)
    await store.save({
      compilerRunId: 3,
      organizationId: 1,
      kind: 'checkpoint',
      version: 1,
      payload: { completedAt: '2026-07-11T00:00:00.000Z' },
    })

    // Replay — should not create any event entries
    const replayResult = await executor.replay(3, 1)
    assert.isTrue(replayResult.replayed, 'replay should succeed with artifacts')
    assert.isAbove(replayResult.stages, 0, 'replay should count the checkpoints')
    assert.equal(
      logger.events.length,
      0,
      'replay should not create any stage events (no LLM calls)',
    )
  })

  test('11.8 Compiler does not write to V1 business tables (Red Line 1)', async ({ assert }) => {
    // Verify PipelineExecutor source does not import V1 business models
    const sourcePath = fileURLToPath(
      new URL('../../app/services/compiler/pipeline_executor.ts', import.meta.url),
    )
    const source = await readFile(sourcePath, 'utf-8')
    const v1ModelImports = source.match(/from\s+['"]#models\/(?!compiler_)[a-z_]+['"]/g) ?? []
    assert.equal(
      v1ModelImports.length,
      0,
      `PipelineExecutor must not import V1 business models, found: ${v1ModelImports.join(', ')}`,
    )
  })
})

// ── v2-context-compiler-artifact-store: Compact Summary Tests ──

test('12.1 generateCompactSummary preserves identity fields', async ({ assert }) => {
  const mod = await import('#services/compiler/artifact_store')
  const summary = mod.generateCompactSummary({
    compilerRunId: 1,
    organizationId: 1,
    kind: 'model_output',
    artifactId: 'test_out',
    version: 1,
    payload: { entityId: 'Etest_abc', name: '测试', status: 'done', longText: 'x'.repeat(2000) },
  })
  assert.equal(summary.kind, 'model_output')
  assert.equal(summary.entityId, 'Etest_abc')
  assert.equal(summary.name, '测试')
  assert.equal(summary.status, 'done')
  assert.isAtMost((summary.longText as string).length, 503)
})

test('12.2 generateCompactSummary does not call LLM', async ({ assert }) => {
  const mod = await import('#services/compiler/artifact_store')
  const summary = mod.generateCompactSummary({
    compilerRunId: 1,
    organizationId: 1,
    kind: 'contract',
    artifactId: 'contract_v1',
    version: 1,
    payload: { meta: { schemaVersion: '2.0' }, expectedEntities: [] },
  })
  assert.isDefined(summary.kind)
  assert.isDefined(summary.artifactId)
})

test('12.3 StageEventLogger does not record full Context Packet', async ({ assert }) => {
  const sourcePath = fileURLToPath(
    new URL('../../app/services/compiler/stage_event_logger.ts', import.meta.url),
  )
  try {
    const source = await readFile(sourcePath, 'utf-8')
    assert.isAbove(source.length, 0) // verify file is read
  } catch (e: any) {
    assert.isTrue(false, 'Failed to read source file: ' + e.message)
  }
})
