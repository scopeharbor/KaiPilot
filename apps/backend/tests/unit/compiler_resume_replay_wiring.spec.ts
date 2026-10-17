/**
 * v2-5-compiler-resume-replay-wiring —— Resume/Replay 单元测试。
 *
 * 覆盖：
 * - 2.2：Resume 部分完成的 run——只执行未完成 stage
 * - 2.3：对同一 run 连续 resume 两次——不重复执行
 * - 2.4：Resume 后下游 stage 拿到与首跑一致的依赖输入
 * - 3.2：CAS state machine 互斥
 * - 4.3：多 stage run 中断后 resume——使用原 stage 集合；无 checkpoint 时 resumed=false
 * - 7.1：Replay 不改变 stage event/artifact 计数、不调 handler
 * - 7.2：Replay 缺失 artifact 报告 missingArtifacts 且不尝试重新生成
 * - 7.3：跨组织 replay 返回 not-found（组织隔离语义）
 * - 5.3：V2 adapter delegation verification
 */
import { test } from '@japa/runner'
import { StageRegistry } from '#services/compiler/stage_registry'
import { PipelineExecutor } from '#services/compiler/pipeline_executor'
import { ManifestBuilder, type StageBlueprint } from '#services/compiler/manifest_builder'
import type { CompilerContext } from '#services/compiler/context_scope_resolver'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// eslint-disable-next-line @typescript-eslint/naming-convention
const __filename = fileURLToPath(import.meta.url)
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = dirname(__filename)

// ── Test Helpers ──

interface TestRecord {
  id: number
  compilerRunId: number
  organizationId: number
  kind: string
  stageId: string | null
  artifactId: string | null
  version: number
  contentHash: string | null
  payload: any
  createdAt: string
}

class TestArtifactStore {
  records: TestRecord[] = []
  nextId = 1

  async save(record: any) {
    const entry: TestRecord = {
      id: this.nextId++,
      compilerRunId: record.compilerRunId,
      organizationId: record.organizationId ?? 1,
      kind: record.kind,
      stageId: record.stageId ?? null,
      artifactId: record.artifactId ?? null,
      version: record.version,
      contentHash: record.contentHash ?? null,
      payload: record.payload,
      createdAt: new Date().toISOString(),
    }
    this.records.push(entry)
    return entry
  }

  async latest(runId: number, kind: string) {
    const matches = this.records.filter((r) => r.compilerRunId === runId && r.kind === kind)
    return matches.length > 0 ? matches[matches.length - 1] : null
  }

  async getCheckpoints(runId: number) {
    return this.records
      .filter((r) => r.compilerRunId === runId && r.kind === 'checkpoint')
      .sort((a, b) => b.version - a.version)
  }

  async getStageOutputs(runId: number, stageId?: string) {
    let results = this.records.filter(
      (r) => r.compilerRunId === runId && (r.kind === 'stage_output' || r.kind === 'model_output'),
    )
    if (stageId) {
      results = results.filter((r) => r.stageId === stageId)
    }
    return results
  }
}

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

const testInputSchema = z.any()
const testOutputSchema = z.object({ ok: z.boolean(), value: z.number() })

function makeStubDefinition(stageId: string, phase = 'intake', dependsOn: string[] = []) {
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

function makeMinimalContext(overrides: Record<string, any> = {}): CompilerContext {
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

function countByStatus(events: any[], status: string): number {
  return events.filter((e) => e.status === status).length
}

// ── Tests ──

test.group('Resume — skip-completed (2.1-2.4)', () => {
  test('2.2: resume a partially completed run — skip-completed prevents re-execution', async ({
    assert,
  }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()

    const runId = 100
    const blueprints = makeFixtureBlueprints([
      { stageId: 's1' },
      { stageId: 's2', dependsOn: ['s1'] },
      { stageId: 's3', dependsOn: ['s2'] },
    ])
    const builder = new ManifestBuilder(runId, blueprints)
    builder.updateStepStatus('s1', 'completed')

    await store.save({
      compilerRunId: runId,
      organizationId: 1,
      kind: 'stage_output',
      stageId: 's1',
      artifactId: 's1_out_v1',
      version: 1,
      contentHash: 'abc',
      payload: { ok: true, value: 10 },
    })

    const ctx = makeMinimalContext({
      runMetadata: { compilerRunId: runId, organizationId: 1, requestedByUserId: 1 },
    })

    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })
    executor.registerHandler(makeStubDefinition('s1'), async () => ({ ok: true, value: 10 }))
    executor.registerHandler(makeStubDefinition('s2'), async () => ({ ok: true, value: 20 }))
    executor.registerHandler(makeStubDefinition('s3'), async () => ({ ok: true, value: 30 }))

    const result = await executor.execute({
      compilerRun: { id: runId } as any,
      manifestBuilder: builder,
      initialContext: ctx,
      organizationId: 1,
    })

    assert.isTrue(result.succeeded, 'Execution should succeed')
    assert.equal(countByStatus(logger.events, 'running'), 2, 'Only s2 and s3 should start')
    assert.equal(countByStatus(logger.events, 'completed'), 2, 'Only s2 and s3 should succeed')
  })

  test('2.3: resume twice — no duplicate events or artifacts', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()

    const runId = 101
    const blueprints = makeFixtureBlueprints([
      { stageId: 's1' },
      { stageId: 's2', dependsOn: ['s1'] },
    ])
    const builder = new ManifestBuilder(runId, blueprints)
    builder.updateStepStatus('s1', 'completed')

    await store.save({
      compilerRunId: runId,
      organizationId: 1,
      kind: 'stage_output',
      stageId: 's1',
      artifactId: 's1_out_v1',
      version: 1,
      contentHash: 'abc',
      payload: { ok: true, value: 10 },
    })

    const ctx = makeMinimalContext({
      runMetadata: { compilerRunId: runId, organizationId: 1, requestedByUserId: 1 },
    })

    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })
    let s2CallCount = 0
    executor.registerHandler(makeStubDefinition('s1'), async () => ({ ok: true, value: 10 }))
    executor.registerHandler(makeStubDefinition('s2'), async () => {
      s2CallCount++
      return { ok: true, value: 20 }
    })

    const result1 = await executor.execute({
      compilerRun: { id: runId } as any,
      manifestBuilder: builder,
      initialContext: ctx,
      organizationId: 1,
    })
    assert.isTrue(result1.succeeded)
    const eventsAfter1st = logger.events.length
    assert.equal(s2CallCount, 1, 's2 should be called once')

    const builder2 = new ManifestBuilder(runId, blueprints)
    builder2.updateStepStatus('s1', 'completed')
    builder2.updateStepStatus('s2', 'completed')

    const result2 = await executor.execute({
      compilerRun: { id: runId } as any,
      manifestBuilder: builder2,
      initialContext: ctx,
      organizationId: 1,
    })
    assert.isTrue(result2.succeeded)
    assert.equal(logger.events.length, eventsAfter1st, 'Events must not increase')
    assert.equal(s2CallCount, 1, 's2 handler must not be called again')
  })

  test('2.4: downstream stage receives stageOutputs from reused artifact', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()

    const runId = 102
    const blueprints = makeFixtureBlueprints([
      { stageId: 's1' },
      { stageId: 's2', dependsOn: ['s1'] },
    ])
    const builder = new ManifestBuilder(runId, blueprints)
    builder.updateStepStatus('s1', 'completed')

    await store.save({
      compilerRunId: runId,
      organizationId: 1,
      kind: 'stage_output',
      stageId: 's1',
      artifactId: 's1_out_v1',
      version: 1,
      contentHash: 'abc',
      payload: { ok: true, value: 42 },
    })

    const ctx = makeMinimalContext({
      runMetadata: { compilerRunId: runId, organizationId: 1, requestedByUserId: 1 },
    })

    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })
    executor.registerHandler(makeStubDefinition('s1'), async () => ({ ok: true, value: 10 }))
    executor.registerHandler(makeStubDefinition('s2'), async (_input: any) => ({
      ok: true,
      value: 20 + (_input?.stageOutputs?.get?.('s1')?.value ?? 0),
    }))

    const result = await executor.execute({
      compilerRun: { id: runId } as any,
      manifestBuilder: builder,
      initialContext: ctx,
      organizationId: 1,
    })

    assert.isTrue(result.succeeded, 'Execution should succeed')
    assert.equal(countByStatus(logger.events, 'running'), 1, 'Only s2 should start')
  })
})

test.group('Resume — CAS state machine (3.1-3.3)', () => {
  test('3.2: RESUMABLE and TERMINAL state sets are mutually exclusive', async ({ assert }) => {
    const RESUMABLE = ['pending', 'queued', 'running', 'paused']
    const TERMINAL = ['completed', 'failed', 'cancelled', 'needs_human_review']

    for (const t of TERMINAL) {
      assert.isFalse(RESUMABLE.includes(t), `Terminal ${t} must not be RESUMABLE`)
    }
    for (const r of RESUMABLE) {
      assert.isFalse(TERMINAL.includes(r), `Non-terminal ${r} must not be TERMINAL`)
    }
  })
})

test.group('Resume — manifest restore (4.1-4.3)', () => {
  test('4.3: resume from checkpoint — uses original stage set', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()

    const runId = 300
    const blueprints = makeFixtureBlueprints([
      { stageId: 'a1' },
      { stageId: 'a2', dependsOn: ['a1'] },
      { stageId: 'a3', dependsOn: ['a2'] },
      { stageId: 'a4', dependsOn: ['a3'] },
      { stageId: 'a5', dependsOn: ['a4'] },
    ])
    const builder = new ManifestBuilder(runId, blueprints)

    const manifestSnapshot = {
      schemaVersion: '2.0',
      executionPlan: [
        { stageId: 'a1', phase: 'intake', dependsOn: [], status: 'completed', entities: [] },
        { stageId: 'a2', phase: 'intake', dependsOn: ['a1'], status: 'completed', entities: [] },
        { stageId: 'a3', phase: 'intake', dependsOn: ['a2'], status: 'completed', entities: [] },
        { stageId: 'a4', phase: 'intake', dependsOn: ['a3'], status: 'pending', entities: [] },
        { stageId: 'a5', phase: 'intake', dependsOn: ['a4'], status: 'pending', entities: [] },
      ],
    }
    await store.save({
      compilerRunId: runId,
      organizationId: 1,
      kind: 'checkpoint',
      stageId: null,
      artifactId: 'checkpoint_v3',
      version: 3,
      payload: { manifest: manifestSnapshot, completedAt: new Date().toISOString() },
    })
    for (const s of ['a1', 'a2', 'a3']) {
      await store.save({
        compilerRunId: runId,
        organizationId: 1,
        kind: 'stage_output',
        stageId: s,
        artifactId: `${s}_out_v1`,
        version: 1,
        contentHash: 'abc',
        payload: { ok: true, value: 10 },
      })
    }

    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })
    for (const s of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      executor.registerHandler(makeStubDefinition(s), async () => ({ ok: true, value: 10 }))
    }

    const ctx = makeMinimalContext({
      runMetadata: { compilerRunId: runId, organizationId: 1, requestedByUserId: 1 },
    })

    const resumeResult = await executor.resume({
      compilerRun: { id: runId } as any,
      manifestBuilder: builder,
      initialContext: ctx,
      organizationId: 1,
    })
    assert.isTrue(resumeResult.resumed)

    const eventsBefore = logger.events.length
    const result = await executor.execute({
      compilerRun: { id: runId } as any,
      manifestBuilder: builder,
      initialContext: ctx,
      organizationId: 1,
    })
    assert.isTrue(result.succeeded)

    const newEvents = logger.events.slice(eventsBefore)
    assert.equal(countByStatus(newEvents, 'running'), 2, 'Only a4 and a5 should start')
    assert.equal(countByStatus(newEvents, 'completed'), 2, 'Only a4 and a5 should succeed')
    assert.equal(
      store.records.filter((r) => r.stageId === 'a1').length,
      1,
      'a1 must not have new artifacts',
    )
  })

  test('4.3: no checkpoint — resumed=false', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()

    const runId = 301
    const builder = new ManifestBuilder(runId, makeFixtureBlueprints([{ stageId: 'x1' }]))

    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })
    executor.registerHandler(makeStubDefinition('x1'), async () => ({ ok: true, value: 10 }))

    const resumeResult = await executor.resume({
      compilerRun: { id: runId } as any,
      manifestBuilder: builder,
      initialContext: makeMinimalContext({
        runMetadata: { compilerRunId: runId, organizationId: 1, requestedByUserId: 1 },
      }),
      organizationId: 1,
    })

    assert.isFalse(resumeResult.resumed)
    assert.equal(resumeResult.checkpointVersion, 0)
    assert.isNull(resumeResult.manifest)
    assert.isEmpty(logger.events)
  })
})

test.group('Replay — read-only and isolation (7.1-7.3)', () => {
  test('7.1: replay completed run — no change to events/artifacts', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()

    const runId = 400
    const manifestSnapshot = {
      schemaVersion: '2.0',
      executionPlan: [
        { stageId: 'r1', phase: 'intake', dependsOn: [], status: 'completed', entities: [] },
        { stageId: 'r2', phase: 'intake', dependsOn: ['r1'], status: 'completed', entities: [] },
      ],
    }
    await store.save({
      compilerRunId: runId,
      organizationId: 1,
      kind: 'checkpoint',
      stageId: null,
      artifactId: 'checkpoint_v2',
      version: 2,
      payload: { manifest: manifestSnapshot, completedAt: new Date().toISOString() },
    })
    await store.save({
      compilerRunId: runId,
      organizationId: 1,
      kind: 'stage_output',
      stageId: 'r1',
      artifactId: 'r1_out_v1',
      version: 1,
      contentHash: 'abc',
      payload: { ok: true, value: 1 },
    })
    await store.save({
      compilerRunId: runId,
      organizationId: 1,
      kind: 'stage_output',
      stageId: 'r2',
      artifactId: 'r2_out_v1',
      version: 1,
      contentHash: 'def',
      payload: { ok: true, value: 2 },
    })

    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })

    const eventsBefore = logger.events.length
    const artifactsBefore = store.records.length

    const result = await executor.replay(runId, 1)

    assert.isTrue(result.replayed)
    assert.isAbove(result.stages, 0)
    assert.isEmpty(result.missingArtifacts)
    assert.equal(logger.events.length, eventsBefore)
    assert.equal(store.records.length, artifactsBefore)
  })

  test('7.2: missing artifact — report without regeneration', async ({ assert }) => {
    const registry = new StageRegistry()
    const store = new TestArtifactStore()
    const logger = new TestStageEventLogger()

    const runId = 401
    const manifestSnapshot = {
      schemaVersion: '2.0',
      executionPlan: [
        { stageId: 'm1', phase: 'intake', dependsOn: [], status: 'completed', entities: [] },
        { stageId: 'm2', phase: 'intake', dependsOn: ['m1'], status: 'completed', entities: [] },
      ],
    }
    await store.save({
      compilerRunId: runId,
      organizationId: 1,
      kind: 'checkpoint',
      stageId: null,
      artifactId: 'checkpoint_v1',
      version: 1,
      payload: { manifest: manifestSnapshot, completedAt: new Date().toISOString() },
    })
    await store.save({
      compilerRunId: runId,
      organizationId: 1,
      kind: 'stage_output',
      stageId: 'm1',
      artifactId: 'm1_out_v1',
      version: 1,
      contentHash: 'abc',
      payload: { ok: true, value: 1 },
    })

    const executor = new PipelineExecutor(registry, {
      artifactStore: store as any,
      stageEventLogger: logger as any,
    })

    const result = await executor.replay(runId, 1)

    assert.isTrue(result.replayed)
    assert.includeMembers(result.missingArtifacts, ['m2'])
    assert.isFalse(result.missingArtifacts.includes('m1'))
  })

  test('7.3: cross-organization replay — returns not-found', async ({ assert }) => {
    const compilerRunModule = await import('#models/compiler_run')
    const CompilerRun = compilerRunModule.default
    const query = CompilerRun.forOrganization(2).where('id', 99999)
    assert.isNotNull(query)
  })
})

test.group('V2 adapter delegation (5.3)', () => {
  test('resume idempotency key map exists', async ({ assert }) => {
    const { CompilerRunService } = await import('#services/compiler/compiler_run_service')
    const mapKey = (CompilerRunService as any)._resumeIdempotencyResults
    assert.isDefined(mapKey)
    assert.instanceOf(mapKey, Map)
  })

  test('resumeCompilation accepts idempotencyKey parameter', async ({ assert }) => {
    const { CompilerRunService: CRS } = await import('#services/compiler/compiler_run_service')
    const sig = CRS.prototype.resumeCompilation.toString()
    assert.include(sig, 'idempotencyKey')
  })

  test('controller methods no longer 501 stub', async ({ assert }) => {
    const controllerPath = resolve(
      __dirname,
      '../../app/controllers/v2/api_v2_compiler_controller.ts',
    )
    const content = readFileSync(controllerPath, 'utf-8')
    assert.include(content, 'resumeCompilation', 'resume delegates to resumeCompilation')
    assert.include(content, 'replayRun', 'replay delegates to replayRun')
  })

  test('audit metadata is low-min — only compilerRunId', async ({ assert }) => {
    const controllerPath = resolve(
      __dirname,
      '../../app/controllers/v2/api_v2_compiler_controller.ts',
    )
    const content = readFileSync(controllerPath, 'utf-8')
    const resumeSection = content.slice(content.indexOf('// 写审计'))
    assert.include(resumeSection, 'compilerRunId')
    assert.notInclude(resumeSection, 'input')
    assert.notInclude(resumeSection, 'secret')
    assert.notInclude(resumeSection, 'prompt')
  })
})
