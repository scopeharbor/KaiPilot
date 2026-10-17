// v3-multitenant-isolation-architecture §6.1–§6.4 —— AI / Compiler 上下文组装与外部边界。
//
// 对应 spec 场景：
// - AI context excludes hidden tenant data（上下文只含当前 scope 可见资源，
//   不含跨租户标题/计数/source ref/证据 hash/内容摘要）
// - Isolation runs before provider call（隔离失败必须阻止 provider 调用本身，
//   而不是"先调用再丢弃结果"）
//
// 全程 fixture/mock，无真实 AI/OCR/Webhook/Web Push/KMS 调用（spec「Default verification is offline」）。
import { test } from '@japa/runner'
import { z } from 'zod'
import type { ArtifactRef, StageDefinition } from '@aiproj/compiler-spec'
import {
  ContextCompilerError,
  ContextCompilerService,
} from '#services/compiler/context_compiler_service'
import TenantBoundaryGateService, {
  TenantBoundaryDeniedError,
} from '#services/tenant_boundary_gate_service'

const ORG_A = 101
const ORG_B = 202
const RUN_ID = 5001

/** 记录 save 调用的 fake ArtifactStore（不落库，单测离线）。 */
function fakeArtifactStore() {
  const saved: Array<Record<string, unknown>> = []
  return {
    saved,
    async save(record: Record<string, unknown>) {
      saved.push(record)
      return record
    },
  }
}

function makeCompiler(store = fakeArtifactStore()) {
  return {
    store,
    service: new ContextCompilerService(store as never),
  }
}

function stageDefinition(overrides: Partial<StageDefinition> = {}): StageDefinition {
  return {
    stageId: 'tenant_boundary_fixture',
    type: 'llm',
    phase: 'analysis',
    name: '租户边界 fixture stage',
    description: 'v3-multitenant-isolation-architecture §6 fixture',
    inputSchema: z.any(),
    outputSchema: z.any(),
    contextScope: ['full_draft'],
    allowedTools: [],
    sideEffects: {
      writesArtifact: false,
      updatesManifest: false,
      updatesLedger: false,
      callsLlm: true,
    },
    dependsOn: [],
    timeoutMs: 30_000,
    ...overrides,
  } as StageDefinition
}

function artifactRef(organizationId: number, artifactId: string): ArtifactRef {
  return {
    compilerRunId: RUN_ID,
    organizationId,
    kind: 'manifest',
    artifactId,
    version: 1,
    summaryLevel: 'full',
  } as ArtifactRef
}

test.group('Compiler 上下文组装的租户边界（§6.1/§6.3）', () => {
  test('缺失组织 scope 时在任何 section 组装之前失败', async ({ assert }) => {
    const { service, store } = makeCompiler()
    for (const organizationId of [0, -1, Number.NaN]) {
      let caught: unknown = null
      try {
        await service.compile({
          compilerRunId: RUN_ID,
          organizationId,
          stageDefinition: stageDefinition(),
          artifactRefs: [],
          tokenBudget: 4096,
        })
      } catch (err) {
        caught = err
      }
      assert.instanceOf(caught, ContextCompilerError)
      assert.equal((caught as ContextCompilerError).code, 'TENANT_SCOPE_REQUIRED')
    }
    assert.lengthOf(store.saved, 0, '未通过租户边界时不得产生任何 context packet artifact')
  })

  test('他组织 artifact ref 不得进入 Context Packet（标题/refs/hash 均不出现）', async ({
    assert,
  }) => {
    const { service } = makeCompiler()
    const result = await service.compile({
      compilerRunId: RUN_ID,
      organizationId: ORG_A,
      stageDefinition: stageDefinition(),
      artifactRefs: [
        artifactRef(ORG_A, 'own_manifest_visible'),
        artifactRef(ORG_B, 'foreign_manifest_hidden'),
      ],
      tokenBudget: 8192,
    })

    const serialized = JSON.stringify(result.packet)
    assert.include(serialized, 'own_manifest_visible')
    assert.notInclude(
      serialized,
      'foreign_manifest_hidden',
      '他组织 artifactId 不得出现在 Context Packet 的任何 section 或 sourceRefs 中',
    )
    assert.equal(result.packet.organizationId, ORG_A)
  })

  test('organizationId=0 的未填 ref 被丢弃（不得当作隐式全局放行）', async ({ assert }) => {
    const { service } = makeCompiler()
    const result = await service.compile({
      compilerRunId: RUN_ID,
      organizationId: ORG_A,
      stageDefinition: stageDefinition(),
      artifactRefs: [artifactRef(0, 'unfilled_placeholder_ref')],
      tokenBudget: 8192,
    })
    assert.notInclude(
      JSON.stringify(result.packet),
      'unfilled_placeholder_ref',
      'ArtifactRef schema 要求 organizationId 为正整数；0 是未回填占位，不是合法全局',
    )
  })

  test('派生计数只统计 scope 内 ref（跨租户不得抬高 requestedTokens）', async ({ assert }) => {
    const { service } = makeCompiler()
    const onlyOwn = await service.compile({
      compilerRunId: RUN_ID,
      organizationId: ORG_A,
      stageDefinition: stageDefinition(),
      artifactRefs: [artifactRef(ORG_A, 'a1')],
      tokenBudget: 8192,
    })
    const withForeign = await service.compile({
      compilerRunId: RUN_ID,
      organizationId: ORG_A,
      stageDefinition: stageDefinition(),
      artifactRefs: [artifactRef(ORG_A, 'a1'), artifactRef(ORG_B, 'b1'), artifactRef(ORG_B, 'b2')],
      tokenBudget: 8192,
    })

    const requested = (r: typeof onlyOwn, name: string) =>
      r.packet.sections.find((s) => s.name === name)?.requestedTokens ?? -1

    for (const section of ['requiredArtifacts', 'neighbors']) {
      assert.equal(
        requested(withForeign, section),
        requested(onlyOwn, section),
        `${section} 的 requestedTokens 不得因他组织 ref 变化（否则构成跨租户计数侧信道）`,
      )
    }
  })

  test('user_input_only scope 下不注入任何 artifact ref', async ({ assert }) => {
    const { service } = makeCompiler()
    const result = await service.compile({
      compilerRunId: RUN_ID,
      organizationId: ORG_A,
      stageDefinition: stageDefinition({ contextScope: ['user_input_only'] }),
      artifactRefs: [artifactRef(ORG_A, 'own_manifest_visible')],
      tokenBudget: 8192,
    })
    assert.notInclude(JSON.stringify(result.packet), 'own_manifest_visible')
  })
})

// ──────────────────────────────────────────────
// §6.2/§6.4 外部边界：隔离失败必须阻止 provider 调用
// ──────────────────────────────────────────────

/** 记录调用次数的 mock provider（AI/OCR/Webhook/Web Push/KMS 通用替身）。 */
function mockProvider() {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    invoke: async () => {
      calls += 1
      return 'provider-result'
    },
  }
}

function gate(): TenantBoundaryGateService {
  return new TenantBoundaryGateService()
}

function baseCheck(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_A,
    resourceType: 'ai_draft' as const,
    operationType: 'external_boundary' as const,
    actorRef: 'user:7',
    requestId: 'req-1',
    ...overrides,
  }
}

test.group('外部边界门禁：隔离先于 provider 调用（§6.2/§6.4）', () => {
  test('隔离通过：provider 被调用一次并返回结果', async ({ assert }) => {
    const provider = mockProvider()
    const value = await gate().runAfterIsolation(baseCheck(), provider.invoke)
    assert.equal(value, 'provider-result')
    assert.equal(provider.calls, 1)
  })

  test('缺失租户上下文：provider 零调用', async ({ assert }) => {
    for (const organizationId of [null, undefined, 0, -3]) {
      const provider = mockProvider()
      let caught: unknown = null
      try {
        await gate().runAfterIsolation(baseCheck({ organizationId }), provider.invoke)
      } catch (err) {
        caught = err
      }
      assert.instanceOf(caught, TenantBoundaryDeniedError)
      assert.equal((caught as TenantBoundaryDeniedError).denial.reasonCode, 'NO_TENANT_CONTEXT')
      assert.equal(provider.calls, 0, '隔离失败时 adapter 闭包绝不得执行')
    }
  })

  test('混租引用：provider 零调用，reason code 为 MIXED_TENANT_REFERENCE', async ({ assert }) => {
    const provider = mockProvider()
    let caught: unknown = null
    try {
      await gate().runAfterIsolation(baseCheck({ resolvedOwners: [ORG_A, ORG_B] }), provider.invoke)
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, TenantBoundaryDeniedError)
    assert.equal((caught as TenantBoundaryDeniedError).denial.reasonCode, 'MIXED_TENANT_REFERENCE')
    assert.equal(provider.calls, 0)
  })

  test('未经 registry 许可的全局操作：provider 零调用', async ({ assert }) => {
    const provider = mockProvider()
    const result = await gate().tryAfterIsolation(
      baseCheck({ requiresGlobal: true, resourceType: 'project' }),
      provider.invoke,
    )
    assert.isFalse(result.allowed)
    assert.equal(result.denial?.reasonCode, 'GLOBAL_NOT_ALLOWED')
    assert.equal(provider.calls, 0)
  })

  test('拒绝审计元数据低敏：含 actor/scopeHash/reason/requestId，不含隐藏目标细节', async ({
    assert,
  }) => {
    const denial = gate().evaluate(baseCheck({ resolvedOwners: [ORG_B] }))
    assert.isNotNull(denial)
    const audit = denial!.audit
    assert.equal(audit.actorRef, 'user:7')
    assert.isNotEmpty(audit.scopeHash)
    assert.equal(audit.decision, 'deny')
    assert.equal(audit.reasonCode, 'MIXED_TENANT_REFERENCE')
    assert.equal(audit.requestId, 'req-1')
    // 不得把他组织 ID 写进审计（组织归属本身就是隐藏信息）。
    // 按字段值比较，不用字符串包含——ISO 时间戳里的 "202x" 会造成假阳性。
    assert.equal(audit.organizationId, ORG_A, '审计只记录 actor 自己的组织')
    assert.notInclude(Object.values(audit), ORG_B)
    assert.notInclude(Object.values(audit), String(ORG_B))
    // 低敏字段集合固定，不夹带资源名/计数/provider payload
    assert.deepEqual(Object.keys(audit).sort(), [
      'actorRef',
      'decision',
      'idempotencyKey',
      'operationType',
      'organizationId',
      'projectId',
      'reasonCode',
      'requestId',
      'resourceType',
      'scopeHash',
      'timestamp',
    ])
  })

  test('拒绝异常对外 message 统一，不区分拒绝原因', async ({ assert }) => {
    const svc = gate()
    const messages: string[] = []
    for (const check of [
      baseCheck({ organizationId: null }),
      baseCheck({ resolvedOwners: [ORG_B] }),
      baseCheck({ requiresGlobal: true, resourceType: 'project' }),
    ]) {
      try {
        svc.assertBoundary(check)
        messages.push('no-error')
      } catch (err) {
        messages.push((err as Error).message)
      }
    }
    assert.equal(new Set(messages).size, 1)
    assert.notInclude(messages, 'no-error')
  })

  test('同租户引用全部合法时放行（避免门禁过严导致误拒）', async ({ assert }) => {
    const provider = mockProvider()
    const result = await gate().tryAfterIsolation(
      baseCheck({ resolvedOwners: [ORG_A, ORG_A, String(ORG_A)] }),
      provider.invoke,
    )
    assert.isTrue(result.allowed)
    assert.equal(provider.calls, 1)
  })
})
