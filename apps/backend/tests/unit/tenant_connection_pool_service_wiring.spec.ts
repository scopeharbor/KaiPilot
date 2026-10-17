// v3-multitenant-connection-pool-management §5.5/§5.6 —— 真实长流程入口的 lease 接入测试。
//
// 与 `tenant_connection_pool_adapters.spec.ts`（fixture adapter 边界）的分工：
// 本文件断言**生产 service 入口本身**已在租户连接 lease 保护下执行，
// 而不是只有 fixture 走了 wrapper（spec「Adapter Enforcement Boundary / Wrapper bypass」）。
//
// 覆盖：
// - §5.5 CompilerRunOrchestrator.execute → `compiler:run`
// - §5.5 report_v2 createExport → `export:report`
// - §5.5 StageCacheService 读写 → `compiler:artifact`
// - §5.6 资源键覆盖、队列耗尽（触库前即拒）、release-on-failure、跨租户独立计量
//
// 全程进程内 manager + 内存桩，无真实外部 provider、无真实模型调用。
import { test } from '@japa/runner'
import { z } from 'zod'
import TenantConnectionPoolManager from '#services/tenant_connection_pool_manager'
import { setPoolManagerForTest, resetPoolManager } from '#services/tenant_connection_pool_wrapper'
import { CompilerRunOrchestrator } from '#services/compiler/compiler_run_orchestrator'
import { StageRegistry } from '#services/compiler/stage_registry'
import { ManifestBuilder, type StageBlueprint } from '#services/compiler/manifest_builder'
import { StageCacheService } from '#services/compiler/stage_cache_service'
import { STAGE_CACHE_POLICY_VERSION } from '#services/compiler/stage_cache_fingerprint'
import { MemoryCacheStore } from '#services/cache/cache_store'
import { createExport } from '#services/report_v2/export_service'
import type {
  TcpmAcquireRequest,
  TcpmPoolMetricsLabel,
} from '@aiproj/types/multitenant-connection-pool-management'
import type { StageDefinition } from '@aiproj/compiler-spec'
import type { CompilerContext } from '#services/compiler/context_scope_resolver'
import { useAuthDatabase } from '../functional/auth/_helpers.js'

// ── 进程内 manager 注入 ──

function installRecordingManager(): {
  manager: TenantConnectionPoolManager
  metrics: TcpmPoolMetricsLabel[]
} {
  const metrics: TcpmPoolMetricsLabel[] = []
  const manager = new TenantConnectionPoolManager({ onMetrics: (l) => metrics.push(l) })
  setPoolManagerForTest(manager)
  return { manager, metrics }
}

function decisionsFor(metrics: TcpmPoolMetricsLabel[], resourceKey: string): string[] {
  return metrics.filter((m) => m.resourceKey === resourceKey).map((m) => m.decision)
}

function holdRequest(resourceKey: string, organizationId: number): TcpmAcquireRequest {
  return {
    resourceKey,
    operationKind: 'hold',
    tenant: {
      organizationId,
      projectId: null,
      scopeMode: 'organization_scoped',
      actorRef: 'service',
      isSuperAdmin: false,
    },
    requestId: 'hold',
  }
}

/** 占满某资源的租户活跃配额与队列，使后续 acquire 直接 rejected（不等待）。 */
async function saturate(
  manager: TenantConnectionPoolManager,
  resourceKey: string,
  organizationId: number,
  activeLimit: number,
  queueLimit: number,
): Promise<void> {
  const req = holdRequest(resourceKey, organizationId)
  for (let i = 0; i < activeLimit; i++) {
    await manager.acquire({ ...req, requestId: `a${i}` })
  }
  for (let i = 0; i < queueLimit; i++) {
    void manager.acquire({ ...req, requestId: `q${i}` })
  }
}

// ── Compiler fixture（与 compiler_stage_cache_wiring.spec 同构的内存桩）──

const stageOutputSchema = z.object({ stageId: z.string().min(1), ok: z.literal(true) })

function makeDefinition(stageId: string): StageDefinition {
  return {
    stageId,
    type: 'deterministic',
    phase: 'intake',
    name: `pool-wiring-${stageId}`,
    description: `connection-pool wiring fixture ${stageId}`,
    inputSchema: z.any(),
    outputSchema: stageOutputSchema,
    contextScope: ['run_metadata'],
    allowedTools: [],
    sideEffects: {
      writesArtifact: true,
      updatesManifest: true,
      updatesLedger: false,
      callsLlm: false,
    },
    dependsOn: [],
    timeoutMs: 0,
  }
}

function makeBlueprints(stageIds: string[]): StageBlueprint[] {
  return stageIds.map((stageId) => ({
    stageId,
    phase: 'intake',
    dependsOn: [],
    entities: [{ entityId: `E_${stageId}`, kind: 'work_package' as const }],
  }))
}

function makeContext(): CompilerContext {
  return {
    userInput: { text: 'connection pool wiring fixture' },
    runMetadata: { benchmark: 'connection-pool-wiring' },
    stageOutputs: new Map<string, unknown>(),
    blueprints: {},
    fullDraft: {},
  } as unknown as CompilerContext
}

class TestArtifactStore {
  records: Record<string, unknown>[] = []
  async save(record: Record<string, unknown>) {
    const entry = { ...record, id: this.records.length + 1 }
    this.records.push(entry)
    return entry
  }
  async getCheckpoints() {
    return []
  }
  async getStageOutputs() {
    return []
  }
}

class TestEventLogger {
  events: Record<string, unknown>[] = []
  async started(entry: Record<string, unknown>) {
    this.events.push({ ...entry, status: 'running' })
  }
  async succeeded(entry: Record<string, unknown>) {
    this.events.push({ ...entry, status: 'succeeded' })
  }
  async failed(entry: Record<string, unknown>) {
    this.events.push({ ...entry, status: 'failed' })
  }
  async needsHumanReview(entry: Record<string, unknown>) {
    this.events.push({ ...entry, status: 'needs_human_review' })
  }
}

function makeOrchestrator(handler: () => Promise<{ stageId: string; ok: true }>) {
  const stageId = 'pool-det'
  const orchestrator = new CompilerRunOrchestrator(
    new StageRegistry(),
    new TestArtifactStore() as never,
    new TestEventLogger() as never,
    { enabled: false },
  )
  orchestrator.registerHandler(makeDefinition(stageId), handler as never)
  const execute = (runId: number, organizationId: number) =>
    orchestrator.execute({
      organizationId,
      userId: 1,
      runId,
      manifestBuilder: new ManifestBuilder(runId, makeBlueprints([stageId])),
      initialContext: makeContext(),
    })
  return { orchestrator, execute, stageId }
}

// ──────────────────────────────────────────────
// §5.5/§5.6 Compiler run 真实入口
// ──────────────────────────────────────────────

test.group('§5.5 Compiler run 真实入口 lease', (group) => {
  // orchestrator 写终态会更新 compiler_runs；与其他 spec 同批运行时，
  // 别人的 rollback 会把表带走，因此本组显式接管迁移生命周期。
  useAuthDatabase(group)
  group.each.teardown(() => resetPoolManager())

  test('orchestrator.execute 全程在 compiler:run lease 保护下并释放', async ({ assert }) => {
    const { manager, metrics } = installRecordingManager()
    const { execute, stageId } = makeOrchestrator(async () => ({ stageId: 'pool-det', ok: true }))

    const result = await execute(910_101, 4001)

    assert.isTrue(result.success)
    const decisions = decisionsFor(metrics, 'compiler:run')
    assert.include(decisions, 'granted')
    assert.include(decisions, 'released')
    assert.equal(manager.activeCount('compiler:run'), 0)
    void stageId
  })

  test('handler 抛错时 compiler:run lease 仍释放（release-on-failure）', async ({ assert }) => {
    const { manager, metrics } = installRecordingManager()
    const { execute } = makeOrchestrator(async () => {
      throw new Error('stage handler failure fixture')
    })

    const result = await execute(910_102, 4001)

    assert.isFalse(result.success)
    assert.include(decisionsFor(metrics, 'compiler:run'), 'released')
    assert.equal(manager.activeCount('compiler:run'), 0)
  })

  test('compiler:run 预算耗尽时入口被拒且不占活跃（非泄露）', async ({ assert }) => {
    const { manager, metrics } = installRecordingManager()
    const { execute } = makeOrchestrator(async () => ({ stageId: 'pool-det', ok: true }))
    // catalog：compiler:run defaultTenantLimit=1 / queueLimit=6
    await saturate(manager, 'compiler:run', 4002, 1, 6)

    await assert.rejects(async () => execute(910_103, 4002))

    assert.include(decisionsFor(metrics, 'compiler:run'), 'rejected')
    assert.equal(manager.activeCount('compiler:run'), 1)
  })

  test('不同组织的编译 run 各自计量（单租户耗尽不牵连他租）', async ({ assert }) => {
    const { manager } = installRecordingManager()
    const { execute } = makeOrchestrator(async () => ({ stageId: 'pool-det', ok: true }))
    await saturate(manager, 'compiler:run', 4003, 1, 6)

    const other = await execute(910_104, 4004)

    assert.isTrue(other.success)
    // org 4003 的 1 个活跃仍在，org 4004 的已释放
    assert.equal(manager.activeCount('compiler:run'), 1)
  })
})

// ──────────────────────────────────────────────
// §5.5/§5.6 报表导出真实入口
// ──────────────────────────────────────────────

test.group('§5.5 报表导出真实入口 lease', (group) => {
  useAuthDatabase(group)
  group.each.teardown(() => resetPoolManager())

  test('createExport 的失败路径同样释放 export:report lease（release-on-failure）', async ({
    assert,
  }) => {
    const { manager, metrics } = installRecordingManager()
    // 无父行 → 外键失败，正好覆盖「副作用抛错时 lease 必须在 finally 释放」
    await assert.rejects(async () =>
      createExport({
        organizationId: 5001,
        projectId: 11,
        reportId: 22,
        versionId: 33,
        format: 'markdown',
        createdBy: 9,
      }),
    )

    const decisions = decisionsFor(metrics, 'export:report')
    assert.include(decisions, 'granted')
    assert.include(decisions, 'released')
    assert.equal(manager.activeCount('export:report'), 0)
  })

  test('export:report 预算耗尽时 createExport 在触库前即被拒', async ({ assert }) => {
    const { manager, metrics } = installRecordingManager()
    // catalog：export:report defaultTenantLimit=1 / queueLimit=6
    await saturate(manager, 'export:report', 5002, 1, 6)

    let message = ''
    try {
      await createExport({
        organizationId: 5002,
        projectId: 11,
        reportId: 22,
        versionId: 33,
        format: 'csv',
        createdBy: 9,
      })
      assert.fail('应被连接池拒绝')
    } catch (e) {
      message = (e as Error).message
    }

    // 非泄露：错误体是连接池语义，不是 SQLite/外键原文
    assert.notMatch(message, /sqlite|foreign key|insert into/i)
    assert.include(decisionsFor(metrics, 'export:report'), 'rejected')
    assert.equal(manager.activeCount('export:report'), 1)
  })
})

// ──────────────────────────────────────────────
// §5.5 Stage 缓存真实入口
// ──────────────────────────────────────────────

test.group('§5.5 Stage 缓存真实入口 lease', (group) => {
  group.each.teardown(() => resetPoolManager())

  test('getOrCompute 读写均经 compiler:artifact lease', async ({ assert }) => {
    const { manager, metrics } = installRecordingManager()
    const service = new StageCacheService(new MemoryCacheStore())

    const value = await service.getOrCompute(6001, 'stage-a', { n: 1 }, async () => ({ ok: true }))

    assert.deepEqual(value, { ok: true })
    const decisions = decisionsFor(metrics, 'compiler:artifact')
    // 一次 miss 读 + 一次写 = 两组 granted/released
    assert.equal(decisions.filter((d) => d === 'granted').length, 2)
    assert.equal(decisions.filter((d) => d === 'released').length, 2)
    assert.equal(manager.activeCount('compiler:artifact'), 0)
  })

  test('lease 耗尽时缓存降级重算，不冒泡为 Stage 失败（stage-cache design D5）', async ({
    assert,
  }) => {
    const { manager } = installRecordingManager()
    // catalog：compiler:artifact defaultTenantLimit=2 / queueLimit=8
    await saturate(manager, 'compiler:artifact', 6002, 2, 8)

    let computed = 0
    const service = new StageCacheService(new MemoryCacheStore())
    const value = await service.getOrCompute(6002, 'stage-b', { n: 2 }, async () => {
      computed += 1
      return { ok: true }
    })

    assert.deepEqual(value, { ok: true })
    assert.equal(computed, 1)
  })

  test('getOrComputeDetailed 在 lease 耗尽时仍返回确定性结果', async ({ assert }) => {
    const { manager } = installRecordingManager()
    await saturate(manager, 'compiler:artifact', 6003, 2, 8)

    const service = new StageCacheService(new MemoryCacheStore())
    const detailed = await service.getOrComputeDetailed(
      6003,
      {
        stageId: 'stage-c',
        stageType: 'deterministic',
        contractVersion: '1.0.0',
        handlerVersion: '1.0.0',
        cachePolicyVersion: STAGE_CACHE_POLICY_VERSION,
        contextScopeSummary: 'run_metadata',
        inputHash: 'hash-c',
      },
      async () => ({ ok: true }),
    )

    assert.deepEqual(detailed.value, { ok: true })
    // 读被拒 → miss；写被拒 → write-failed。两者都不得让 Stage 失败。
    assert.oneOf(detailed.summary.status, ['miss', 'write-failed'])
  })
})
