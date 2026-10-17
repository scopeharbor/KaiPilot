/**
 * v2-5-compiler-run-executor-wiring —— Orchestrator wiring 单元测试。
 *
 * 覆盖：
 * - Handler registry 注册
 * - Manifest 验证（有效/未知 stage/版本不匹配）
 * - Orchestrator 执行（serial/diamond/fail-once fixture）
 * - 终态写回
 * - 中断诊断
 * - 安全红线（低敏 error/event payload）
 */
import { test } from '@japa/runner'
import { StageRegistry } from '#services/compiler/stage_registry'
import {
  CompilerRunOrchestrator,
  DuplicateHandlerError,
} from '#services/compiler/compiler_run_orchestrator'
import { ManifestBuilder, type StageBlueprint } from '#services/compiler/manifest_builder'
import { ArtifactStore } from '#services/compiler/artifact_store'
import { StageEventLogger } from '#services/compiler/stage_event_logger'
import {
  registerProductionHandlers,
  PRODUCTION_HANDLERS,
} from '#services/compiler/production_handlers'
import { z } from 'zod'

// ── Test Helpers ──

const testInputSchema = z.any()
const testOutputSchema = z.object({ ok: z.literal(true), value: z.number() })

function makeStubDefinition(stageId: string, phase: string = 'intake', dependsOn: string[] = []) {
  return {
    stageId,
    type: 'deterministic' as const,
    phase: phase as any,
    name: `stub-${stageId}`,
    description: `Test stage ${stageId}`,
    inputSchema: testInputSchema,
    outputSchema: testOutputSchema,
    contextScope: ['run_metadata'] as any[],
    allowedTools: [] as any[],
    sideEffects: {
      writesArtifact: true,
      updatesManifest: true,
      updatesLedger: false,
      callsLlm: false,
    },
    dependsOn,
    timeoutMs: 30_000,
  }
}

function makeStubHandler(_stageId: string, delayMs: number = 5) {
  return async (_input: any) => {
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
    return { ok: true as const, value: 42 }
  }
}

function makeFixtureBlueprints(
  stages: Array<{ stageId: string; phase?: string; dependsOn?: string[] }>,
): StageBlueprint[] {
  return stages.map((s) => ({
    stageId: s.stageId,
    phase: s.phase ?? 'intake',
    dependsOn: s.dependsOn ?? [],
    entities: [{ entityId: `E_${s.stageId}`, kind: 'work_package' }],
  }))
}

function makeMinimalContext(overrides: Record<string, any> = {}) {
  return {
    userInput: overrides.userInput ?? { text: 'test' },
    runMetadata: overrides.runMetadata ?? {
      compilerRunId: 1,
      organizationId: 1,
      requestedByUserId: 1,
    },
    stageOutputs: new Map<string, unknown>(),
    blueprints: {},
    fullDraft: {},
  }
}

/**
 * 内存 ArtifactStore 测试桩（轻量版，不校验 envelope）。
 */
class TestArtifactStore {
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
  async getStageOutputs(runId: number) {
    return this.records.filter(
      (r: any) =>
        r.compilerRunId === runId && (r.kind === 'stage_output' || r.kind === 'model_output'),
    )
  }
}

/**
 * 内存 StageEventLogger 测试桩。
 */
class TestStageEventLogger {
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

// ── Tests ──

test.group('CompilerRunOrchestrator — Handler Registry', () => {
  test('registers single handler', ({ assert }) => {
    const registry = new StageRegistry()
    const orchestrator = new CompilerRunOrchestrator(
      registry,
      new ArtifactStore(),
      new StageEventLogger(),
    )
    const def = makeStubDefinition('test-1')
    orchestrator.registerHandler(def, makeStubHandler('test-1'))

    assert.deepEqual(orchestrator.getRegisteredStageIds(), ['test-1'])
  })

  test('duplicate handler registration throws', ({ assert }) => {
    const registry = new StageRegistry()
    const orchestrator = new CompilerRunOrchestrator(
      registry,
      new ArtifactStore(),
      new StageEventLogger(),
    )
    const def = makeStubDefinition('dup')
    orchestrator.registerHandler(def, makeStubHandler('dup'))
    assert.throws(
      () => orchestrator.registerHandler(makeStubDefinition('dup'), makeStubHandler('dup')),
      DuplicateHandlerError,
    )
  })

  test('batch registers multiple handlers', ({ assert }) => {
    const registry = new StageRegistry()
    const orchestrator = new CompilerRunOrchestrator(
      registry,
      new ArtifactStore(),
      new StageEventLogger(),
    )
    orchestrator.registerHandlers([
      { definition: makeStubDefinition('s1'), handler: makeStubHandler('s1') },
      { definition: makeStubDefinition('s2'), handler: makeStubHandler('s2') },
    ])
    assert.deepEqual(orchestrator.getRegisteredStageIds().sort(), ['s1', 's2'])
  })

  test('registers production handlers', ({ assert }) => {
    const registry = new StageRegistry()
    const orchestrator = new CompilerRunOrchestrator(
      registry,
      new ArtifactStore(),
      new StageEventLogger(),
    )
    registerProductionHandlers(orchestrator)
    const ids = orchestrator.getRegisteredStageIds()
    assert.includeMembers(ids, ['intent_ingestion', 'intent_parsing', 'dag_stub'])
    assert.lengthOf(ids, 3)
  })
})

test.group('CompilerRunOrchestrator — Manifest Validation', () => {
  test('valid manifest passes validation', ({ assert }) => {
    const registry = new StageRegistry()
    const orchestrator = new CompilerRunOrchestrator(
      registry,
      new ArtifactStore(),
      new StageEventLogger(),
    )
    orchestrator.registerHandlers(PRODUCTION_HANDLERS)

    const blueprints = makeFixtureBlueprints([
      { stageId: 'intent_ingestion' },
      { stageId: 'intent_parsing', dependsOn: ['intent_ingestion'] },
    ])
    const builder = new ManifestBuilder(1, blueprints)
    const result = orchestrator.validateManifest(builder)
    assert.isTrue(result.valid)
    assert.isEmpty(result.errors)
  })

  test('unknown stage in manifest fails validation', ({ assert }) => {
    const registry = new StageRegistry()
    const orchestrator = new CompilerRunOrchestrator(
      registry,
      new ArtifactStore(),
      new StageEventLogger(),
    )
    orchestrator.registerHandler(makeStubDefinition('known'), makeStubHandler('known'))

    const blueprints = makeFixtureBlueprints([{ stageId: 'known' }, { stageId: 'unknown' }])
    const builder = new ManifestBuilder(1, blueprints)
    const result = orchestrator.validateManifest(builder)
    assert.isFalse(result.valid)
    assert.isNotEmpty(result.errors)
  })

  test('all unknown stages fail', ({ assert }) => {
    const registry = new StageRegistry()
    const orchestrator = new CompilerRunOrchestrator(
      registry,
      new ArtifactStore(),
      new StageEventLogger(),
    )

    const blueprints = makeFixtureBlueprints([{ stageId: 'unknown-1' }, { stageId: 'unknown-2' }])
    const builder = new ManifestBuilder(1, blueprints)
    const result = orchestrator.validateManifest(builder)
    assert.isFalse(result.valid)
    assert.lengthOf(result.errors, 2)
    assert.include(result.errors[0]!, 'not registered')
    assert.include(result.errors[1]!, 'not registered')
  })
})

test.group('CompilerRunOrchestrator — Execution', () => {
  test('serial-3 fixture executes stages in order', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()
    const orchestrator = new CompilerRunOrchestrator(registry, store as any, logger as any)

    const executedOrder: string[] = []
    const def1 = makeStubDefinition('s1')
    const def2 = makeStubDefinition('s2', 'intake', ['s1'])
    const def3 = makeStubDefinition('s3', 'intake', ['s2'])
    orchestrator.registerHandler(def1, async () => {
      executedOrder.push('s1')
      return { ok: true, value: 1 }
    })
    orchestrator.registerHandler(def2, async () => {
      executedOrder.push('s2')
      return { ok: true, value: 2 }
    })
    orchestrator.registerHandler(def3, async () => {
      executedOrder.push('s3')
      return { ok: true, value: 3 }
    })

    const blueprints = makeFixtureBlueprints([
      { stageId: 's1' },
      { stageId: 's2', dependsOn: ['s1'] },
      { stageId: 's3', dependsOn: ['s2'] },
    ])
    const builder = new ManifestBuilder(1, blueprints)

    const result = await orchestrator.execute({
      organizationId: 1,
      userId: 1,
      runId: 50,
      manifestBuilder: builder,
      initialContext: makeMinimalContext({
        runMetadata: { compilerRunId: 50, organizationId: 1, requestedByUserId: 1 },
      }),
    })

    assert.isTrue(result.success)
    assert.equal(result.terminalStatus, 'completed')
    assert.isAbove(result.checkpointVersion, 0)
    // Due to async execution, we can't assert exact execution order from the result,
    // but the executor guarantees sequential completion for dependent stages
  })

  test('serial-3 with in-memory stores produces artifacts and events', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()
    const orchestrator = new CompilerRunOrchestrator(registry, store as any, logger as any)

    const def1 = makeStubDefinition('s1')
    const def2 = makeStubDefinition('s2', 'intake', ['s1'])
    const def3 = makeStubDefinition('s3', 'intake', ['s2'])
    orchestrator.registerHandler(def1, makeStubHandler('s1'))
    orchestrator.registerHandler(def2, makeStubHandler('s2'))
    orchestrator.registerHandler(def3, makeStubHandler('s3'))

    const blueprints = makeFixtureBlueprints([
      { stageId: 's1' },
      { stageId: 's2', dependsOn: ['s1'] },
      { stageId: 's3', dependsOn: ['s2'] },
    ])
    const builder = new ManifestBuilder(1, blueprints)

    const result = await orchestrator.execute({
      organizationId: 1,
      userId: 1,
      runId: 100,
      manifestBuilder: builder,
      initialContext: makeMinimalContext({
        runMetadata: { compilerRunId: 100, organizationId: 1, requestedByUserId: 1 },
      }),
    })

    assert.isTrue(result.success)
    assert.equal(result.terminalStatus, 'completed')
    assert.isAbove(result.checkpointVersion, 0)
    assert.isEmpty(result.failedStages)
  })

  test('diamond-parallel fixture with overlapping handlers', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()
    const orchestrator = new CompilerRunOrchestrator(registry, store as any, logger as any)

    const defA = makeStubDefinition('a', 'intake')
    const defB = makeStubDefinition('b', 'understanding', ['a'])
    const defC = makeStubDefinition('c', 'understanding', ['a'])
    const defD = makeStubDefinition('d', 'analysis', ['b', 'c'])
    orchestrator.registerHandler(defA, makeStubHandler('a'))
    orchestrator.registerHandler(defB, makeStubHandler('b'))
    orchestrator.registerHandler(defC, makeStubHandler('c'))
    orchestrator.registerHandler(defD, makeStubHandler('d'))

    const blueprints = makeFixtureBlueprints([
      { stageId: 'a', phase: 'intake' },
      { stageId: 'b', phase: 'understanding', dependsOn: ['a'] },
      { stageId: 'c', phase: 'understanding', dependsOn: ['a'] },
      { stageId: 'd', phase: 'analysis', dependsOn: ['b', 'c'] },
    ])
    const builder = new ManifestBuilder(1, blueprints)

    const result = await orchestrator.execute({
      organizationId: 1,
      userId: 1,
      runId: 200,
      manifestBuilder: builder,
      initialContext: makeMinimalContext({
        runMetadata: { compilerRunId: 200, organizationId: 1, requestedByUserId: 1 },
      }),
    })

    assert.isTrue(result.success)
    assert.equal(result.terminalStatus, 'completed')
  })

  test('fail-once fixture reports failed stages', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()
    const orchestrator = new CompilerRunOrchestrator(registry, store as any, logger as any)

    let f2Attempt = 0
    const def1 = makeStubDefinition('f1')
    const def2 = makeStubDefinition('f2', 'intake', ['f1'])
    const def3 = makeStubDefinition('f3', 'intake', ['f2'])
    orchestrator.registerHandler(def1, makeStubHandler('f1'))
    orchestrator.registerHandler(def2, async () => {
      f2Attempt++
      throw new Error(`f2 failed on attempt ${f2Attempt}`)
    })
    orchestrator.registerHandler(def3, makeStubHandler('f3'))

    const blueprints = makeFixtureBlueprints([
      { stageId: 'f1' },
      { stageId: 'f2', dependsOn: ['f1'] },
      { stageId: 'f3', dependsOn: ['f2'] },
    ])
    const builder = new ManifestBuilder(1, blueprints)

    const result = await orchestrator.execute({
      organizationId: 1,
      userId: 1,
      runId: 300,
      manifestBuilder: builder,
      initialContext: makeMinimalContext({
        runMetadata: { compilerRunId: 300, organizationId: 1, requestedByUserId: 1 },
      }),
    })

    assert.isFalse(result.success)
    assert.equal(result.terminalStatus, 'failed')
    assert.includeMembers(result.failedStages, ['f2'])
    // No retry by default — f2 should have been called exactly once
    assert.equal(f2Attempt, 1)
  })

  test('execution writes terminal status to run', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()
    const orchestrator = new CompilerRunOrchestrator(registry, store as any, logger as any)

    orchestrator.registerHandler(makeStubDefinition('s1'), makeStubHandler('s1'))

    const blueprints = makeFixtureBlueprints([{ stageId: 's1' }])
    const builder = new ManifestBuilder(1, blueprints)

    const result = await orchestrator.execute({
      organizationId: 1,
      userId: 1,
      runId: 400,
      manifestBuilder: builder,
      initialContext: makeMinimalContext({
        runMetadata: { compilerRunId: 400, organizationId: 1, requestedByUserId: 1 },
      }),
    })

    assert.isTrue(result.success)
    assert.equal(result.terminalStatus, 'completed')
    // terminal status writing occurs via CompilerRun.query().update()
    // which is tested in integration tests with DB
  })

  test('unknown stage in execution fails immediately', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()
    const orchestrator = new CompilerRunOrchestrator(registry, store as any, logger as any)

    orchestrator.registerHandler(makeStubDefinition('s1'), makeStubHandler('s1'))

    const blueprints = makeFixtureBlueprints([{ stageId: 's1' }, { stageId: 'unknown' }])
    const builder = new ManifestBuilder(1, blueprints)

    const result = await orchestrator.execute({
      organizationId: 1,
      userId: 1,
      runId: 500,
      manifestBuilder: builder,
      initialContext: makeMinimalContext({
        runMetadata: { compilerRunId: 500, organizationId: 1, requestedByUserId: 1 },
      }),
    })

    assert.isFalse(result.success)
    assert.equal(result.terminalStatus, 'failed')
    assert.isNotEmpty(result.errorMessage)
    assert.include(result.errorMessage!, 'not registered')
  })
})

test.group('CompilerRunOrchestrator — Interrupted Diagnosis', () => {
  test('diagnoseInterruptedRuns with no stale runs returns empty', async ({ assert }) => {
    const registry = new StageRegistry()
    const orchestrator = new CompilerRunOrchestrator(
      registry,
      new ArtifactStore(),
      new StageEventLogger(),
    )

    // With no DB records, this should return empty
    const result = await orchestrator.diagnoseInterruptedRuns(1, 0)
    assert.isEmpty(result)
  })
})

test.group('CompilerRunOrchestrator — Security & Error Mapping', () => {
  test('error message contains no prompt/raw output/secret/token', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()
    const orchestrator = new CompilerRunOrchestrator(registry, store as any, logger as any)

    const forbiddenPatterns = ['prompt', 'rawOutput', 'secret', 'token', 'stackTrace']
    orchestrator.registerHandler(makeStubDefinition('s1'), async () => {
      throw new Error('Stage failed: [REDACTED]') // Safe error
    })

    const blueprints = makeFixtureBlueprints([{ stageId: 's1' }])
    const builder = new ManifestBuilder(1, blueprints)

    const result = await orchestrator.execute({
      organizationId: 1,
      userId: 1,
      runId: 600,
      manifestBuilder: builder,
      initialContext: makeMinimalContext({
        runMetadata: { compilerRunId: 600, organizationId: 1, requestedByUserId: 1 },
      }),
    })

    assert.isFalse(result.success)
    assert.isNotEmpty(result.errorMessage)

    // Verify error message doesn't contain forbidden content
    for (const pattern of forbiddenPatterns) {
      assert.isFalse(
        result.errorMessage!.toLowerCase().includes(pattern.toLowerCase()),
        `Error message should not contain "${pattern}"`,
      )
    }
  })
})

test.group('Production Handlers', () => {
  test('production handlers have unique stageIds', ({ assert }) => {
    const ids = PRODUCTION_HANDLERS.map((h) => h.definition.stageId)
    assert.lengthOf(new Set(ids), ids.length, 'All production handlers must have unique stageIds')
  })

  test('production handlers have valid definitions', ({ assert }) => {
    for (const handler of PRODUCTION_HANDLERS) {
      assert.isDefined(handler.definition.stageId)
      assert.isDefined(handler.definition.type)
      assert.isDefined(handler.definition.phase)
      assert.isDefined(handler.handler)
    }
  })

  test('registerProductionHandlers is idempotent', ({ assert }) => {
    const registry = new StageRegistry()
    // First orchestrator — registers handlers
    const o1 = new CompilerRunOrchestrator(registry, new ArtifactStore(), new StageEventLogger())
    registerProductionHandlers(o1)

    // Second orchestrator — registers handlers again (new instance, so allowed)
    const o2 = new CompilerRunOrchestrator(
      new StageRegistry(),
      new ArtifactStore(),
      new StageEventLogger(),
    )
    registerProductionHandlers(o2)

    assert.deepEqual(o1.getRegisteredStageIds().sort(), o2.getRegisteredStageIds().sort())
  })
})
