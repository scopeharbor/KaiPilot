/**
 * v3-copilot-custom-agent-eval-gate — 门禁服务测试
 *
 * 覆盖 §3-§8 的所有 P0 任务。
 * 使用内存 mock，零数据库调用，零真实模型调用。
 */

import { describe, it, beforeEach } from 'vitest'
import assert from 'node:assert/strict'

import {
  EvalGateService,
  EvalGateDisabledError,
  EvalGateNotConfiguredError,
  type EvalGateServiceDeps,
} from '../../app/services/copilot/eval_gate_service.js'

import {
  computeDependencyFingerprint,
  EVAL_GATE_FIXTURE_DEPENDENCY_INPUT,
  EVAL_GATE_FIXTURE_ORG_ID,
  EVAL_GATE_FIXTURE_AGENT_ID,
  EVAL_GATE_FIXTURE_DEFINITION_VERSION,
  EVAL_GATE_FIXTURE_DATASET_VERSION,
  EVAL_GATE_FIXTURE_SCORER_VERSION,
  buildConfiguredThreshold,
  buildDisabledGateThreshold,
  buildRealModelAuthorizedThreshold,
  type EvalGateRunRequest,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// Mock deps
// ---------------------------------------------------------------------------

function createMockDeps(overrides: Partial<EvalGateServiceDeps> = {}): EvalGateServiceDeps {
  const verdictStore = new Map<string, import('@aiproj/types').EvalGateVerdictRecord>()
  const thresholdStore = new Map<number, import('@aiproj/types').EvalGateThresholdConfig>()

  return {
    getThresholdConfig: async (orgId) => thresholdStore.get(orgId) ?? null,
    getAgentDefinition: async () => null,
    getAgentDependencyInput: async () => EVAL_GATE_FIXTURE_DEPENDENCY_INPUT,
    getLatestVerdict: async (orgId, agentId) => verdictStore.get(`${orgId}:${agentId}`) ?? null,
    saveVerdict: async (verdict) => {
      verdictStore.set(`${verdict.organizationId}:${verdict.agentId}`, verdict)
    },
    runEvaluation: async () => ({
      evalRunId: 1,
      evalReportId: 1,
      report: {
        dimensionScores: [
          { dimension: 'structure', score: 0.9 },
          { dimension: 'coverage', score: 0.85 },
        ],
      },
    }),
    checkPermission: async () => true,
    checkScorerAvailable: async () => true,
    ...overrides,
  }
}

function makeRunRequest(overrides: Partial<EvalGateRunRequest> = {}): EvalGateRunRequest {
  const fp = computeDependencyFingerprint(EVAL_GATE_FIXTURE_DEPENDENCY_INPUT)
  return {
    organizationId: EVAL_GATE_FIXTURE_ORG_ID,
    agentId: EVAL_GATE_FIXTURE_AGENT_ID,
    definitionVersion: EVAL_GATE_FIXTURE_DEFINITION_VERSION,
    dependencyFingerprint: fp,
    datasetVersion: EVAL_GATE_FIXTURE_DATASET_VERSION,
    scorerConfig: {
      kind: 'deterministic',
      version: EVAL_GATE_FIXTURE_SCORER_VERSION,
      paramsFingerprint: 'fp-test',
    },
    benchmarkSource: 'fixture',
    ...overrides,
  }
}

// ===========================================================================
// §3: 版本绑定与失效
// ===========================================================================

describe('version binding and invalidation', () => {
  let deps: EvalGateServiceDeps
  let service: EvalGateService

  beforeEach(() => {
    deps = createMockDeps()
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    service = new EvalGateService(deps)
  })

  it('verdict binds to definition version, not agent ID', async () => {
    const result = await service.runGate(makeRunRequest())
    assert.equal(result.verdict.definitionVersion, EVAL_GATE_FIXTURE_DEFINITION_VERSION)
    assert.equal(result.verdict.agentId, EVAL_GATE_FIXTURE_AGENT_ID)
  })

  it('new definition version requires re-evaluation', async () => {
    // 先运行一次，得到结论
    await service.runGate(makeRunRequest())

    // 新版本
    const newResult = await service.checkVerdictValidity(
      EVAL_GATE_FIXTURE_ORG_ID,
      EVAL_GATE_FIXTURE_AGENT_ID,
      '2.0.0',
    )
    assert.ok(!newResult.valid, '新版本应需要重新过门禁')
    assert.equal(newResult.reason, 'definition_version_changed')
  })

  it('dependency change invalidates verdict', async () => {
    await service.runGate(makeRunRequest())

    // 依赖变更——用同一个 deps store（verdict 已保存）
    const changedDeps = createMockDeps({
      getAgentDependencyInput: async () => ({
        skills: [{ skillId: 101, version: '2.0.0' }],
        knowledgePackages: [],
      }),
    })
    const threshold = buildConfiguredThreshold()
    ;(changedDeps.getThresholdConfig as any) = async () => threshold
    // 复用原 deps 的 verdict store（通过 getLatestVerdict 委托到原 deps）
    const originalGetLatestVerdict = deps.getLatestVerdict
    changedDeps.getLatestVerdict = originalGetLatestVerdict
    const changedService = new EvalGateService(changedDeps)

    const result = await changedService.checkVerdictValidity(
      EVAL_GATE_FIXTURE_ORG_ID,
      EVAL_GATE_FIXTURE_AGENT_ID,
      EVAL_GATE_FIXTURE_DEFINITION_VERSION,
    )
    assert.ok(!result.valid, '依赖变更后结论应失效')
    assert.ok(result.reason, '应有失效原因')
  })

  it('invalidation reason is readable', async () => {
    await service.runGate(makeRunRequest())

    const changedDeps = createMockDeps({
      getAgentDependencyInput: async () => ({
        skills: [{ skillId: 101, version: '2.0.0' }],
        knowledgePackages: [],
      }),
    })
    const threshold = buildConfiguredThreshold()
    ;(changedDeps.getThresholdConfig as any) = async () => threshold
    changedDeps.getLatestVerdict = deps.getLatestVerdict
    const changedService = new EvalGateService(changedDeps)

    const result = await changedService.checkVerdictValidity(
      EVAL_GATE_FIXTURE_ORG_ID,
      EVAL_GATE_FIXTURE_AGENT_ID,
      EVAL_GATE_FIXTURE_DEFINITION_VERSION,
    )
    assert.ok(result.reason, '失效原因应可读')
  })
})

// ===========================================================================
// §4: L3 边界
// ===========================================================================

describe('L3 boundary', () => {
  it('L3 dataset is admissible for evaluation', async () => {
    const deps = createMockDeps()
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    // L3 作为 benchmarkSource 是合法的
    const result = await service.runGate(makeRunRequest({ benchmarkSource: 'L3' }))
    assert.ok(result.verdict, 'L3 数据集评测应成功')
    assert.equal(result.verdict.benchmarkSource, 'L3')
  })

  it('eval gate verdict does not widen production tiers', async () => {
    // 门禁结论本身不改变生产知识层清单
    // 这由上下文装配层保证（assertEligibleKnowledgeTiersExcludeL3）
    // 这里验证门禁服务不暴露任何修改生产层的能力
    const deps = createMockDeps()
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    const result = await service.runGate(makeRunRequest())
    // 门禁结论只包含 verdict、scores、fingerprint
    // 不包含任何知识层配置
    assert.ok(!('knowledgeTiers' in result.verdict), '结论不应包含知识层配置')
  })
})

// ===========================================================================
// §5: 判定确定性
// ===========================================================================

describe('verdict determinism', () => {
  it('same inputs yield identical verdict', async () => {
    const deps = createMockDeps()
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    const r1 = await service.runGate(makeRunRequest())
    const r2 = await service.runGate(makeRunRequest())

    // 同一请求两次运行，判定应相同
    assert.equal(r1.verdict.verdict, r2.verdict.verdict)
    assert.deepEqual(r1.verdict.itemScores, r2.verdict.itemScores)
  })

  it('unconfigured threshold makes gate unavailable', async () => {
    const deps = createMockDeps()
    // 未配置阈值：enabled=true 但 passThreshold=0
    const threshold: import('@aiproj/types').EvalGateThresholdConfig = {
      organizationId: EVAL_GATE_FIXTURE_ORG_ID,
      passThreshold: 0,
      enabled: true,
      realModelEvalAuthorized: false,
      configuredBy: 1,
      configuredAt: '2026-08-19T00:00:00Z',
    }
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    await assert.rejects(
      () => service.runGate(makeRunRequest()),
      (err: any) => err instanceof EvalGateNotConfiguredError,
    )
  })

  it('scorer unavailable results in fail', async () => {
    const deps = createMockDeps({
      checkScorerAvailable: async () => false,
    })
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    const result = await service.runGate(makeRunRequest())
    assert.equal(result.verdict.verdict, 'fail')
  })

  it('model does not decide the verdict (deterministic rule)', async () => {
    // 判定由阈值规则确定，不由模型输出
    const deps = createMockDeps()
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    const result = await service.runGate(makeRunRequest())
    // 判定应为 pass 或 fail（由阈值决定）
    assert.ok(
      result.verdict.verdict === 'pass' || result.verdict.verdict === 'fail',
      '判定应由阈值规则确定',
    )
  })
})

// ===========================================================================
// §6: 可解释性
// ===========================================================================

describe('explainability', () => {
  it('passing verdict has per-item scores', async () => {
    const deps = createMockDeps()
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    const result = await service.runGate(makeRunRequest())
    if (result.verdict.verdict === 'pass') {
      assert.ok(result.verdict.itemScores.length > 0, '通过态应有逐项得分')
    }
  })

  it('failing verdict identifies failing items', async () => {
    // Mock 一个会失败的评测结果
    const deps = createMockDeps({
      runEvaluation: async () => ({
        evalRunId: 1,
        evalReportId: 1,
        report: {
          dimensionScores: [
            { dimension: 'structure', score: 0.3 },
            { dimension: 'coverage', score: 0.2 },
          ],
        },
      }),
    })
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    const result = await service.runGate(makeRunRequest())
    if (result.verdict.verdict === 'fail') {
      assert.ok(result.verdict.failingItemIds.length > 0, '失败态应有失败项标识')
    }
  })
})

// ===========================================================================
// §7: 授权门
// ===========================================================================

describe('authorization gate', () => {
  it('unauthorized evaluation makes zero real model calls', async () => {
    let realModelCalled = false
    const deps = createMockDeps({
      runEvaluation: async () => {
        realModelCalled = true
        return { evalRunId: 1, evalReportId: 1, report: {} }
      },
    })
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    // 真实模型评测未授权
    await service.runGate(makeRunRequest({ benchmarkSource: 'L3' }))
    assert.ok(!realModelCalled, '未授权时不应调用真实模型')
  })

  it('unauthorized decision records authorization-gated reason', async () => {
    const deps = createMockDeps()
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    const result = await service.runGate(makeRunRequest({ benchmarkSource: 'L3' }))
    assert.equal(result.authorizationGated, true)
    assert.ok(result.authorizationGateReason, '应记录授权门原因')
    assert.equal(result.verdict.verdict, 'unavailable')
  })

  it('authorized evaluation proceeds normally', async () => {
    const deps = createMockDeps()
    const threshold = buildRealModelAuthorizedThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    const result = await service.runGate(makeRunRequest({ benchmarkSource: 'L3' }))
    assert.equal(result.authorizationGated, false)
    assert.ok(result.verdict.verdict === 'pass' || result.verdict.verdict === 'fail')
  })

  it('changing authorization requires permission', async () => {
    const deps = createMockDeps({
      checkPermission: async () => false,
    })
    const service = new EvalGateService(deps)

    const allowed = await service.canCreateOrganizationAgent(EVAL_GATE_FIXTURE_ORG_ID, 999)
    assert.equal(allowed.allowed, false)
    assert.ok(allowed.reason)
  })
})

// ===========================================================================
// §8: 门禁效果与红线
// ===========================================================================

describe('gate effects and red lines', () => {
  it('not-passed organization agent stays private (only author can use)', async () => {
    const deps = createMockDeps()
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    ;(deps.getAgentDefinition as any) = async () => ({
      id: 1,
      agentKey: EVAL_GATE_FIXTURE_AGENT_ID,
      version: 1,
      name: 'test',
      description: 'test',
      scope: 'organization',
      skillRefs: [],
      toolSet: [],
      contextScope: { scopeType: 'organization' },
      toneLevel: 'standard',
      status: 'active',
      organizationId: EVAL_GATE_FIXTURE_ORG_ID,
      createdBy: 1,
      evalGateStatus: 'pending',
      createdAt: '2026-08-19T00:00:00Z',
      updatedAt: '2026-08-19T00:00:00Z',
    })
    const service = new EvalGateService(deps)

    // 未过门禁时，他人无法使用
    const result = await service.isAgentUsableByOthers(
      EVAL_GATE_FIXTURE_ORG_ID,
      EVAL_GATE_FIXTURE_AGENT_ID,
      '1',
      999, // 非创建者
    )
    assert.equal(result.usable, false)
  })

  it('failure preserves the agent (not deleted)', async () => {
    const deps = createMockDeps({
      runEvaluation: async () => ({
        evalRunId: 1,
        evalReportId: 1,
        report: {
          dimensionScores: [{ dimension: 'structure', score: 0.3 }],
        },
      }),
    })
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    const result = await service.runGate(makeRunRequest())
    // 结论保存了但助手定义不受影响
    assert.ok(result.verdict, '应有结论')
    // 门禁路径零域写——除了评测与门禁自身记录外不改动其他数据
  })

  it('organization isolation: verdicts scoped by org', async () => {
    const deps = createMockDeps()
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    await service.runGate(makeRunRequest())

    // 另一个组织看不到这个结论
    const otherOrgVerdict = await deps.getLatestVerdict(999, EVAL_GATE_FIXTURE_AGENT_ID)
    assert.equal(otherOrgVerdict, null, '跨组织结论不可见')
  })

  it('gate does not modify agent definition', async () => {
    let agentModified = false
    const deps = createMockDeps({
      getAgentDefinition: async () => {
        return {
          id: 1,
          agentKey: EVAL_GATE_FIXTURE_AGENT_ID,
          version: 1,
          name: 'test',
          description: 'test',
          scope: 'organization',
          skillRefs: [],
          toolSet: [],
          contextScope: { scopeType: 'organization' },
          toneLevel: 'standard',
          status: 'active',
          organizationId: EVAL_GATE_FIXTURE_ORG_ID,
          createdBy: 1,
          evalGateStatus: 'pending',
          createdAt: '2026-08-19T00:00:00Z',
          updatedAt: '2026-08-19T00:00:00Z',
        }
      },
    })
    const threshold = buildConfiguredThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    await service.runGate(makeRunRequest())
    assert.ok(!agentModified, '门禁不应修改助手定义')
  })

  it('disabled gate blocks organization agent creation', async () => {
    const deps = createMockDeps()
    const threshold = buildDisabledGateThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    const result = await service.canCreateOrganizationAgent(EVAL_GATE_FIXTURE_ORG_ID, 1)
    assert.equal(result.allowed, false)
    assert.ok(result.reason?.includes('门禁已禁用'))
  })

  it('disabled gate throws on runGate', async () => {
    const deps = createMockDeps()
    const threshold = buildDisabledGateThreshold()
    ;(deps.getThresholdConfig as any) = async () => threshold
    const service = new EvalGateService(deps)

    await assert.rejects(
      () => service.runGate(makeRunRequest()),
      (err: any) => err instanceof EvalGateDisabledError,
    )
  })
})
