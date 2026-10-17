/**
 * v2-5-compiler-execution-gap-benchmark —— M0 benchmark 门禁（tasks 1.4, 2.6, 3.1, 3.3, 3.5, 4.6, 5.1）。
 *
 * 本套件同时是 benchmark 的**执行器**与**守门人**：
 * - 常规 `pnpm test` 只跑断言，不写任何报告文件（避免每次 CI 都产生 diff）。
 * - 设置 `COMPILER_M0_BENCHMARK_WRITE=1` 时额外写出 JSON + Markdown 报告。
 *
 * 报告时效由「静态可达性一致性」用例守护：一旦有人把执行器接到生产入口，
 * 该用例失败，提示报告必须重跑——而不是让过期结论继续被引用。
 */

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Organization from '#models/organization'
import User from '#models/user'
import CompilerRun from '#models/compiler_run'
import CompilerArtifact from '#models/compiler_artifact'
import CompilerStageEvent from '#models/compiler_stage_event'
import Project from '#models/project'
import { classifyGap } from '../benchmarks/compiler/types.js'
import { benchmarkResultSchema } from '../benchmarks/compiler/schema.js'
import { collectEnvironment, DEFAULT_RUN_COUNT } from '../benchmarks/compiler/environment.js'
import {
  ALL_FIXTURES,
  fixtureBlueprints,
  fixtureDefinitions,
  fixtureOutputSchema,
} from '../benchmarks/compiler/fixtures.js'
import {
  aggregateRuns,
  cleanupProductionRun,
  runFixtureMatrix,
  runIsolatedFixture,
  runProductionServicePath,
  median,
  BENCHMARK_ORG_ID,
  type ProductionPathObservation,
} from '../benchmarks/compiler/runner.js'
import {
  InMemoryArtifactStore,
  InMemoryStageEventLogger,
  CountingMemoryCacheStore,
} from '../benchmarks/compiler/in_memory_stores.js'
import { fixtureContext, fixtureHandler, StageRecorder } from '../benchmarks/compiler/fixtures.js'
import { StageRegistry } from '#services/compiler/stage_registry'
import { ManifestBuilder } from '#services/compiler/manifest_builder'
import { CompilerRunOrchestrator } from '#services/compiler/compiler_run_orchestrator'
import { StageCacheService } from '#services/compiler/stage_cache_service'
import type { StageHandler } from '#services/compiler/pipeline_executor'
import {
  REACHABILITY_PROBES,
  scanReachability,
  stripCommentsAndStrings,
  verifyProbeConsistency,
} from '../benchmarks/compiler/static_reachability.js'
import { buildFindings, buildNextChangeScope } from '../benchmarks/compiler/findings.js'
import {
  buildBenchmarkResult,
  classificationCounts,
  renderJson,
  renderMarkdown,
  resolveResultRef,
  verifyReferenceTraceability,
} from '../benchmarks/compiler/report.js'

const BACKEND_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const REPORT_MD = `${REPO_ROOT}docs/v2-v3/planning/compiler-m0-benchmark-report.md`
const REPORT_JSON = `${REPO_ROOT}docs/v2-v3/planning/compiler-m0-benchmark-result.json`

/** 报告写出开关；默认关闭，使常规测试不产生文件 diff。 */
const SHOULD_WRITE_REPORT = process.env.COMPILER_M0_BENCHMARK_WRITE === '1'

async function createTestOrg(): Promise<{ org: Organization; user: User }> {
  const user = await User.create({
    email: `compiler-m0-${Date.now()}@benchmark.local`,
    password: 'Password123!',
    fullName: 'Compiler M0 Benchmark',
    authProvider: 'local',
    isActive: true,
  })
  const org = await Organization.create({
    ownerId: user.id,
    name: 'Compiler M0 Benchmark Org',
    slug: `compiler-m0-${Date.now()}`,
  })
  return { org, user }
}

async function runAllProductionPaths(orgId: number, userId: number) {
  const observations: ProductionPathObservation[] = []
  try {
    for (const fixture of ALL_FIXTURES) {
      observations.push(await runProductionServicePath({ fixture, organizationId: orgId, userId }))
    }
  } finally {
    for (const obs of observations) {
      await cleanupProductionRun(obs.runId)
    }
  }
  return observations
}

test.group('CompilerExecutionGapBenchmark', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await testUtils.db().truncate()
  })

  // ── 1.1 结果模型与 schema ──

  test('1.1 gap 分类为封闭四项且 classifyGap 是唯一裁决入口', ({ assert }) => {
    assert.deepEqual(
      [
        classifyGap({
          isolatedObserved: true,
          productionReachable: true,
          productionObserved: true,
          stubOnly: false,
        }),
        classifyGap({
          isolatedObserved: true,
          productionReachable: false,
          productionObserved: false,
          stubOnly: false,
        }),
        classifyGap({
          isolatedObserved: false,
          productionReachable: false,
          productionObserved: false,
          stubOnly: true,
        }),
        classifyGap({
          isolatedObserved: false,
          productionReachable: false,
          productionObserved: false,
          stubOnly: false,
        }),
      ],
      ['implemented', 'foundation-unwired', 'stub-mock-only', 'missing'],
    )
  })

  // ── 3.5 防越级 ──

  test('3.5 单测通过但生产不可达时强制分类 foundation-unwired', ({ assert }) => {
    // 生产可达但行为未观测到 —— 仍不得升为 implemented。
    assert.equal(
      classifyGap({
        isolatedObserved: true,
        productionReachable: true,
        productionObserved: false,
        stubOnly: false,
      }),
      'foundation-unwired',
    )
    // 生产行为观测到但静态不可达（自相矛盾）—— 同样不得升为 implemented。
    assert.equal(
      classifyGap({
        isolatedObserved: true,
        productionReachable: false,
        productionObserved: true,
        stubOnly: false,
      }),
      'foundation-unwired',
    )
    // isolated 通过时 stubOnly 不得把结论降级为 stub-mock-only。
    assert.equal(
      classifyGap({
        isolatedObserved: true,
        productionReachable: false,
        productionObserved: false,
        stubOnly: true,
      }),
      'foundation-unwired',
    )
  })

  test('3.5 schema 拒绝「无生产证据却标 implemented」的结论', async ({ assert }) => {
    const env = collectEnvironment(1)
    const aggregates = await runFixtureMatrix(1)
    const scans = scanReachability(BACKEND_ROOT, REPO_ROOT)
    const findings = buildFindings({ aggregates, scans, production: [] })

    const tampered = structuredClone(findings[0]!)
    tampered.classification = 'implemented'

    const parsed = benchmarkResultSchema.safeParse({
      schemaVersion: '1.0',
      benchmarkId: 'compiler-execution-gap-benchmark',
      environment: env,
      fixtures: aggregates,
      findings: [tampered],
      nextChangeScope: buildNextChangeScope(findings),
    })

    assert.isFalse(parsed.success)
  }).timeout(30000)

  // ── 2.6 fixture schema / DAG / 预期结果 ──

  test('2.6 五组 fixture 齐备且 stage 定义通过 schema', ({ assert }) => {
    assert.deepEqual(
      ALL_FIXTURES.map((f) => f.fixtureId),
      ['serial-3', 'diamond-parallel', 'fail-once', 'checkpoint-resume', 'cache-repeat'],
    )

    for (const fixture of ALL_FIXTURES) {
      const defs = fixtureDefinitions(fixture)
      assert.isAbove(defs.length, 0, fixture.fixtureId)
      for (const def of defs) {
        // 红线：benchmark 不得触发模型调用。deterministic 类型使执行器跳过 Context Compiler。
        assert.equal(def.type, 'deterministic', `${fixture.fixtureId}/${def.stageId}`)
        assert.isFalse(def.sideEffects.callsLlm, `${fixture.fixtureId}/${def.stageId}`)
        assert.lengthOf(def.allowedTools, 0)
      }
      // 输出 schema 可用且拒绝非法输出。
      assert.isTrue(fixtureOutputSchema.safeParse({ stageId: 'x', ok: true, value: 1 }).success)
      assert.isFalse(fixtureOutputSchema.safeParse({ stageId: 'x', ok: false, value: 1 }).success)
    }
  })

  test('2.6 fixture DAG 依赖引用合法且无自环', ({ assert }) => {
    for (const fixture of ALL_FIXTURES) {
      const ids = new Set(fixture.specs.map((s) => s.stageId))
      for (const spec of fixture.specs) {
        assert.notInclude(spec.dependsOn, spec.stageId, `${fixture.fixtureId}/${spec.stageId} 自环`)
        for (const dep of spec.dependsOn) {
          assert.isTrue(ids.has(dep), `${fixture.fixtureId}: 未知依赖 ${dep}`)
        }
      }
      // ManifestBuilder 必须能消化 blueprint。
      assert.doesNotThrow(() => fixtureBlueprints(fixture))
    }
  })

  test('2.6 每个 fixture 的实测结果符合预期', async ({ assert }) => {
    for (const fixture of ALL_FIXTURES) {
      const obs = await runIsolatedFixture(fixture, 0)
      const statusOf = (id: string) => obs.stages.find((s) => s.stageId === id)?.status

      for (const id of fixture.expected.completed) {
        assert.equal(statusOf(id), 'completed', `${fixture.fixtureId}/${id}`)
      }
      for (const id of fixture.expected.failed) {
        assert.equal(statusOf(id), 'failed', `${fixture.fixtureId}/${id}`)
      }
      for (const id of fixture.expected.skipped) {
        assert.equal(statusOf(id), 'skipped', `${fixture.fixtureId}/${id}`)
      }
      assert.equal(
        obs.maxObservedConcurrency,
        fixture.expected.maxConcurrency,
        `${fixture.fixtureId} 并发`,
      )
    }
  }).timeout(30000)

  test('2.6 diamond fixture 产生两分支的真实重叠证据', async ({ assert }) => {
    const fixture = ALL_FIXTURES.find((f) => f.fixtureId === 'diamond-parallel')!
    const obs = await runIsolatedFixture(fixture, 0)

    assert.equal(obs.maxObservedConcurrency, 2)
    assert.deepEqual(obs.overlappingPairs, ['b|c'])

    const b = obs.stages.find((s) => s.stageId === 'b')!
    const c = obs.stages.find((s) => s.stageId === 'c')!
    assert.isBelow(b.startOffsetMs, c.endOffsetMs)
    assert.isBelow(c.startOffsetMs, b.endOffsetMs)
  }).timeout(15000)

  test('2.6 cache fixture 的输入与产物 hash 稳定', async ({ assert }) => {
    const fixture = ALL_FIXTURES.find((f) => f.fixtureId === 'cache-repeat')!
    const runs = [await runIsolatedFixture(fixture, 0), await runIsolatedFixture(fixture, 1)]
    const agg = aggregateRuns(fixture, runs)

    assert.isTrue(agg.artifactHashStable)
    assert.isTrue(agg.cacheProbe?.inputHashStable)
    assert.isTrue(agg.cacheProbe?.resultsIdentical)
    // 两次调用只 compute 一次 —— 缓存服务本身可用。
    assert.equal(agg.cacheProbe?.computeCalls, 1)
  }).timeout(15000)

  // ── 1.3 / 1.4 隔离与清理 ──

  test('1.3 isolated 层不写任何数据库行', async ({ assert }) => {
    await runFixtureMatrix(1)

    assert.lengthOf(await CompilerRun.query(), 0)
    assert.lengthOf(await CompilerArtifact.query(), 0)
    assert.lengthOf(await CompilerStageEvent.query(), 0)
  }).timeout(30000)

  test('1.4 生产路径异常时仍完成清理且不残留 run/artifact/项目数据', async ({ assert }) => {
    const { org, user } = await createTestOrg()
    const fixture = ALL_FIXTURES[0]!
    let createdRunId: number | null = null

    // 模拟异常路径：观测完成后强制抛错，验证 finally 清理仍然执行。
    await assert.rejects(async () => {
      const obs = await runProductionServicePath({
        fixture,
        organizationId: org.id,
        userId: user.id,
      })
      createdRunId = obs.runId
      try {
        throw new Error('benchmark fixture 异常路径')
      } finally {
        await cleanupProductionRun(obs.runId)
      }
    }, 'benchmark fixture 异常路径')

    assert.isNotNull(createdRunId)
    assert.lengthOf(await CompilerRun.query(), 0)
    assert.lengthOf(await CompilerArtifact.query(), 0)
    assert.lengthOf(await CompilerStageEvent.query(), 0)
    // 红线：benchmark 绝不写 V1 正式业务表。
    assert.lengthOf(await Project.query(), 0)
  })

  // ── 3.1 静态可达性 ──

  test('3.1 静态扫描剥离注释与字符串后再计数', ({ assert }) => {
    const source = `
      // executor.execute(fake)
      /* executor.execute(alsoFake) */
      const msg = 'executor.execute(inString)'
      executor.execute(real)
    `
    const stripped = stripCommentsAndStrings(source)
    const matches = stripped.match(/\bexecutor\.execute\s*\(/g) ?? []
    assert.lengthOf(matches, 1)
  })

  test('3.1 探针清单覆盖六类且裁决与扫描一致', ({ assert }) => {
    const ids = REACHABILITY_PROBES.map((p) => p.id)
    for (const required of [
      'start-run',
      'executor-execute',
      'handler-registry',
      'checkpoint-write',
      'stage-cache',
      'stage-event',
    ]) {
      assert.include(ids, required)
    }

    const scans = scanReachability(BACKEND_ROOT, REPO_ROOT)
    // 一旦有人接线，这里会失败 —— 提示报告已过时，必须重跑并复核裁决。
    assert.deepEqual(verifyProbeConsistency(scans), [])
  })

  test('3.1 扫描器正向对照：已知存在的调用点必须被找到', ({ assert }) => {
    // 正向对照是必需的：曾因「先剥字符串、再找 import 说明符」而让全部 probe 静默返回 0，
    // 一个只断言「零调用点」的套件会为此全绿。以下计数一旦掉到 0 即代表扫描器坏了，
    // 而不是代码变干净了。
    const scans = scanReachability(BACKEND_ROOT, REPO_ROOT)
    const of = (id: string) => scans.find((s) => s.probe.id === id)!

    assert.equal(of('start-run').productionCallSites, 1)
    assert.deepEqual(of('start-run').callSiteFiles, [
      'apps/backend/app/controllers/compiler_controller.ts',
    ])

    assert.equal(of('executor-resume').productionCallSites, 2)
    assert.deepEqual(of('executor-resume').callSiteFiles, [
      'apps/backend/app/services/compiler/compiler_run_orchestrator.ts',
      'apps/backend/app/services/compiler/compiler_run_service.ts',
    ])

    assert.equal(of('handler-registry').productionCallSites, 6)
    assert.deepEqual(of('handler-registry').callSiteFiles, [
      'apps/backend/app/services/compiler/compiler_run_orchestrator.ts',
      'apps/backend/app/services/compiler/dev_debug_service.ts',
    ])

    assert.equal(of('checkpoint-write').productionCallSites, 2)
  })

  test('3.1 当前 HEAD 的接线调用点与剩余缺口一致', ({ assert }) => {
    const scans = scanReachability(BACKEND_ROOT, REPO_ROOT)
    const of = (id: string) => scans.find((s) => s.probe.id === id)!

    assert.equal(of('executor-execute').productionCallSites, 1)
    assert.isTrue(of('executor-execute').probe.reachableFromProductionEntry)
    assert.equal(of('executor-replay').productionCallSites, 1)
    assert.isTrue(of('executor-replay').probe.reachableFromProductionEntry)
    // v2-5-compiler-stage-cache-wiring 起：executor 在 deterministic handler 调用点
    // 经 getOrComputeDetailed 包裹，探针已翻转为生产可达。
    assert.equal(of('stage-cache').productionCallSites, 1)
    assert.isTrue(of('stage-cache').probe.reachableFromProductionEntry)
    assert.isAbove(of('run-terminal-status').productionCallSites, 0)
    assert.isTrue(of('run-terminal-status').probe.reachableFromProductionEntry)

    // startRun 有生产调用点（controller），且当前 HEAD 会在 Controller 路径传入 orchestrator。
    assert.isAbove(of('start-run').productionCallSites, 0)
    // resume/replay 均已接到 orchestrator。
    assert.isAbove(of('executor-resume').productionCallSites, 0)
    assert.isTrue(of('executor-resume').probe.reachableFromProductionEntry)
  })

  // ── 3.3 生产 service path ──

  test('3.3 startRun 无 orchestrator 时保持 queued 且不伪造执行器证据', async ({ assert }) => {
    const { org, user } = await createTestOrg()
    const observations = await runAllProductionPaths(org.id, user.id)

    assert.lengthOf(observations, ALL_FIXTURES.length)
    for (const obs of observations) {
      assert.equal(obs.statusAfterStartRun, 'queued')
      assert.equal(
        obs.statusAfterSettle,
        'queued',
        '未传 orchestrator 时服务层 fallback 不推进终态',
      )
      assert.equal(obs.stageEventRows, 0)
      assert.equal(obs.artifactRows, 0)
      assert.equal(obs.handlerInvocations, 0)
      assert.isFalse(obs.executorDroveAnyStage)
    }

    // 清理后不留痕。
    assert.lengthOf(await CompilerRun.query(), 0)
  }).timeout(30000)

  // ── 4.2 / 4.3 结论 ──

  test('4.2 结论覆盖四种分类且分类由证据推导', async ({ assert }) => {
    const { org, user } = await createTestOrg()
    const aggregates = await runFixtureMatrix(1)
    const scans = scanReachability(BACKEND_ROOT, REPO_ROOT)
    const production = await runAllProductionPaths(org.id, user.id)
    const findings = buildFindings({ aggregates, scans, production })

    const counts = classificationCounts(findings)
    assert.isAbove(counts['foundation-unwired'], 0)
    assert.isAbove(counts.missing, 0)
    assert.isAbove(counts['stub-mock-only'], 0)
    // 生产路径一次都没驱动执行器 —— 不应出现任何 implemented。
    assert.equal(counts.implemented, 0)

    const byId = (id: string) => findings.find((f) => f.capabilityId === id)!
    assert.equal(byId('parallel-execution').classification, 'foundation-unwired')
    assert.equal(byId('stage-retry').classification, 'missing')
    assert.equal(byId('run-terminal-state').classification, 'missing')
    assert.equal(byId('resume-http-endpoint').classification, 'stub-mock-only')
  }).timeout(45000)

  test('4.3 每条结论都带 file/symbol/证据与限制', async ({ assert }) => {
    const aggregates = await runFixtureMatrix(1)
    const scans = scanReachability(BACKEND_ROOT, REPO_ROOT)
    const findings = buildFindings({ aggregates, scans, production: [] })

    for (const f of findings) {
      assert.isAbove(f.references.files.length, 0, f.capabilityId)
      assert.isAbove(f.references.symbols.length, 0, f.capabilityId)
      assert.isAbove(f.evidence.static.length, 0, f.capabilityId)
      assert.isNotEmpty(f.evidence.isolatedExecutor.detail, f.capabilityId)
      assert.isNotEmpty(f.evidence.productionServicePath.detail, f.capabilityId)
      if (f.confidence !== 'high') {
        assert.isAbove(f.limitations.length, 0, `${f.capabilityId} 非 high 置信度必须写明限制`)
      }
    }
  }).timeout(30000)

  test('4.3 结论引用的文件与测试路径必须真实存在', async ({ assert }) => {
    // 引用是报告的全部价值所在：一条指向不存在文件的「证据」比没有证据更糟。
    // 文件被改名或移动时，这里必须失败并逼出重新取证。
    const aggregates = await runFixtureMatrix(1)
    const scans = scanReachability(BACKEND_ROOT, REPO_ROOT)
    const findings = buildFindings({ aggregates, scans, production: [] })

    for (const f of findings) {
      const cited = [
        ...f.references.files,
        ...f.references.tests,
        ...f.evidence.static.map((s) => s.file),
      ]
      for (const rel of cited) {
        assert.isTrue(
          existsSync(join(REPO_ROOT, rel)),
          `${f.capabilityId} 引用了不存在的文件 ${rel}`,
        )
      }
    }
  }).timeout(30000)

  // ── 4.6 JSON ↔ Markdown 可回溯 ──

  test('4.6 Markdown 的分类与指标均可回溯到 JSON', async ({ assert }) => {
    const { org, user } = await createTestOrg()
    const aggregates = await runFixtureMatrix(2)
    const scans = scanReachability(BACKEND_ROOT, REPO_ROOT)
    const production = await runAllProductionPaths(org.id, user.id)
    const findings = buildFindings({ aggregates, scans, production })

    const result = buildBenchmarkResult({
      environment: collectEnvironment(2),
      fixtures: aggregates,
      findings,
      nextChangeScope: buildNextChangeScope(findings),
    })

    // 每条结论的 results 引用都必须能在 JSON 解析。
    assert.deepEqual(verifyReferenceTraceability(result), [])

    const markdown = renderMarkdown(result)
    for (const f of result.findings) {
      assert.include(markdown, f.capabilityId, `Markdown 缺 ${f.capabilityId}`)
      for (const ref of f.references.results) {
        assert.isDefined(resolveResultRef(result, ref), `无法回溯 ${ref}`)
      }
    }
    // fixture 指标在两侧一致。
    for (const fixture of result.fixtures) {
      assert.include(markdown, fixture.fixtureId)
      assert.include(markdown, String(fixture.medianWallClockMs))
    }
    // 不存在的引用必须解析失败，确保回溯检查不是永远为真。
    assert.isUndefined(resolveResultRef(result, 'fixtures.serial-3.nonExistentField'))
    assert.isUndefined(resolveResultRef(result, 'fixtures.no-such-fixture.stageOrder'))
  }).timeout(60000)

  // ── 5.1 稳定性 ──

  test('5.1 benchmark 连跑两次行为结论稳定', async ({ assert }) => {
    const first = await runFixtureMatrix(2)
    const second = await runFixtureMatrix(2)

    for (const [i, a] of first.entries()) {
      const b = second[i]!
      // 行为结论必须完全一致；wall-clock 允许抖动，故不参与比较。
      assert.deepEqual(a.statusByStage, b.statusByStage, `${a.fixtureId} 状态`)
      assert.deepEqual(a.attemptsByStage, b.attemptsByStage, `${a.fixtureId} attempt`)
      assert.deepEqual(a.stageOrder, b.stageOrder, `${a.fixtureId} 顺序`)
      assert.equal(a.maxObservedConcurrency, b.maxObservedConcurrency, `${a.fixtureId} 并发`)
      assert.equal(a.overlapObserved, b.overlapObserved, `${a.fixtureId} 重叠`)
      assert.equal(a.checkpointCount, b.checkpointCount, `${a.fixtureId} checkpoint`)
      assert.deepEqual(a.artifactHashByStage, b.artifactHashByStage, `${a.fixtureId} 产物 hash`)
      assert.deepEqual(a.eventStatusCounts, b.eventStatusCounts, `${a.fixtureId} 事件`)
      assert.deepEqual(a.resumeProbe, b.resumeProbe, `${a.fixtureId} resume`)
      assert.deepEqual(a.cacheProbe, b.cacheProbe, `${a.fixtureId} cache`)
    }
  }).timeout(60000)

  test('5.1 median 对样本顺序不敏感', ({ assert }) => {
    assert.equal(median([5, 1, 3]), 3)
    assert.equal(median([3, 1, 5]), 3)
    assert.equal(median([4, 1, 3, 2]), 2.5)
    assert.equal(median([]), 0)
  })

  // ── 5.2 stage-cache 生产路径观测门禁 ──

  test('5.2 stage-cache 只有在生产路径观测到缓存行为时才判 implemented', async ({ assert }) => {
    // v2-5-compiler-stage-cache-wiring（tasks 5.2）：
    // 沿 cache-repeat fixture 的逻辑，但走**生产 composition root**
    // （CompilerRunOrchestrator → PipelineExecutor → getOrComputeDetailed），
    // 证明分类门禁：只有生产路径真实观测到缓存命中，classifyGap 才给出 implemented。
    const fixture = ALL_FIXTURES.find((f) => f.fixtureId === 'cache-repeat')!
    const recorder = new StageRecorder()
    const registry = new StageRegistry()
    const definitions = fixtureDefinitions(fixture)
    for (const def of definitions) registry.register(def)

    const artifactStore = new InMemoryArtifactStore()
    const stageEventLogger = new InMemoryStageEventLogger()
    const cacheStore = new CountingMemoryCacheStore()

    const orchestrator = new CompilerRunOrchestrator(
      registry,
      artifactStore as any,
      stageEventLogger as any,
      { service: new StageCacheService(cacheStore), enabled: true },
    )
    const spec = fixture.specs[0]!
    orchestrator.registerHandler(
      definitions[0]!,
      fixtureHandler(spec, recorder) as StageHandler<unknown, unknown>,
    )

    const runOnce = (runId: number) =>
      orchestrator.execute({
        organizationId: BENCHMARK_ORG_ID,
        userId: 1,
        runId,
        manifestBuilder: new ManifestBuilder(runId, fixtureBlueprints(fixture)),
        initialContext: fixtureContext(fixture.fixtureId),
      })

    const first = await runOnce(910_001)
    const second = await runOnce(910_002)

    assert.isTrue(first.success)
    assert.isTrue(second.success)
    // 生产路径行为证据：第二次运行缓存命中，handler 未重算。
    assert.equal(recorder.attemptsOf('k1'), 1)
    const summaries = stageEventLogger.events
      .filter((e) => e.status === 'completed' && e.cacheSummary)
      .map((e) => e.cacheSummary!)
    assert.deepEqual(
      summaries.map((s) => s.status),
      ['miss', 'hit'],
    )

    // 静态层：探针已翻转为生产可达（tasks 5.1）。
    const scans = scanReachability(BACKEND_ROOT, REPO_ROOT)
    const probe = scans.find((s) => s.probe.id === 'stage-cache')!
    assert.isTrue(probe.probe.reachableFromProductionEntry)
    assert.isAbove(probe.productionCallSites, 0)

    // 门禁证明：三层证据齐备 ⇒ implemented；缺生产行为观测 ⇒ foundation-unwired（防越级）。
    const productionObserved = summaries.some((s) => s.status === 'hit')
    assert.equal(
      classifyGap({
        isolatedObserved: true,
        productionReachable: probe.probe.reachableFromProductionEntry,
        productionObserved,
        stubOnly: false,
      }),
      'implemented',
    )
    assert.equal(
      classifyGap({
        isolatedObserved: true,
        productionReachable: probe.probe.reachableFromProductionEntry,
        productionObserved: false,
        stubOnly: false,
      }),
      'foundation-unwired',
    )
  }).timeout(30000)

  // ── 4.4 报告生成 ──

  test('4.4 生成 JSON 与 Markdown 报告', async ({ assert }) => {
    const { org, user } = await createTestOrg()
    const runCount = DEFAULT_RUN_COUNT
    const aggregates = await runFixtureMatrix(runCount)
    const scans = scanReachability(BACKEND_ROOT, REPO_ROOT)
    const production = await runAllProductionPaths(org.id, user.id)
    const findings = buildFindings({ aggregates, scans, production })

    const result = buildBenchmarkResult({
      environment: collectEnvironment(runCount),
      fixtures: aggregates,
      findings,
      nextChangeScope: buildNextChangeScope(findings),
    })

    // buildBenchmarkResult 内部已 schema.parse；这里再断言一次显式门禁。
    assert.isTrue(benchmarkResultSchema.safeParse(result).success)
    assert.equal(result.nextChangeScope.changeId, 'v2-5-compiler-run-executor-wiring')
    assert.isAbove(result.nextChangeScope.inScope.length, 0)
    assert.isAbove(result.nextChangeScope.nonGoals.length, 0)

    const markdown = renderMarkdown(result)
    assert.include(markdown, 'Compiler 执行链 M0 Benchmark 报告')
    assert.include(markdown, result.environment.gitSha)

    if (SHOULD_WRITE_REPORT) {
      await mkdir(dirname(REPORT_JSON), { recursive: true })
      await writeFile(REPORT_JSON, renderJson(result), 'utf8')
      await writeFile(REPORT_MD, markdown, 'utf8')
    }
  }).timeout(90000)
})
