// v3-multitenant-isolation-architecture §5.2/§5.3/§5.6 ——
// 派生值租户命名空间、跨租户回放拒绝、可选缓存与邻域 adapter 的安全降级。
//
// 对应 spec 场景：
// - Cache key contains tenant namespace（缓存键含租户命名空间，跨组织不可复用）
// - Preview confirmation rejects cross-tenant replay（O1 生成的签名在 O2 提交必须失败且零副作用）
// - Export handle is scoped（句柄在可下载内容产生之前已绑定 scope/actor/source hash/过期）
import { test } from '@japa/runner'
import { PermissionDeniedException } from '#exceptions/api_exception'
import TenantNamespaceService from '#services/tenant_namespace_service'
import TenantDegradedModeService, {
  type TenantCacheLike,
} from '#services/tenant_degraded_mode_service'

const ORG_A = 101
const ORG_B = 202

function ns(): TenantNamespaceService {
  return new TenantNamespaceService()
}

test.group('TenantNamespaceService —— 租户命名空间（§5.2）', () => {
  test('命名空间由 scope hash 派生，两个组织必然不同', ({ assert }) => {
    const svc = ns()
    const a = svc.namespace({ organizationId: ORG_A })
    const b = svc.namespace({ organizationId: ORG_B })
    assert.notEqual(a, b)
    assert.match(a, /^mtns:v1:[0-9a-f]{16}$/)
  })

  test('同 scope 稳定可复现；project 维度参与命名空间', ({ assert }) => {
    const svc = ns()
    assert.equal(svc.namespace({ organizationId: ORG_A }), svc.namespace({ organizationId: ORG_A }))
    assert.notEqual(
      svc.namespace({ organizationId: ORG_A }),
      svc.namespace({ organizationId: ORG_A, projectId: 9 }),
    )
  })

  test('无有效组织 scope 不得生成命名空间（fail closed）', ({ assert }) => {
    const svc = ns()
    for (const bad of [0, -1, Number.NaN]) {
      assert.throws(() => svc.namespace({ organizationId: bad }), /需要组织上下文/)
    }
  })

  test('缓存键含命名空间，同逻辑键跨组织不可复用', ({ assert }) => {
    const svc = ns()
    const parts = { view: 'dashboard', page: 1 }
    const keyA = svc.cacheKey({ organizationId: ORG_A }, 'project_summary', parts)
    const keyB = svc.cacheKey({ organizationId: ORG_B }, 'project_summary', parts)
    assert.notEqual(keyA, keyB)
    assert.isTrue(keyA.startsWith(svc.namespace({ organizationId: ORG_A })))
    assert.isFalse(svc.isInNamespace({ organizationId: ORG_B }, keyA))
  })

  test('parts 键顺序不影响缓存键（稳定序列化）', ({ assert }) => {
    const svc = ns()
    assert.equal(
      svc.cacheKey({ organizationId: ORG_A }, 'k', { a: 1, b: 2 }),
      svc.cacheKey({ organizationId: ORG_A }, 'k', { b: 2, a: 1 }),
    )
  })

  test('派生键输入含禁止字段（secret/prompt/绝对路径等）一律拒绝', ({ assert }) => {
    const svc = ns()
    for (const bad of [{ token: 'abc' }, { prompt: '……' }, { nested: { storage_path: 'C:/x' } }]) {
      assert.throws(() => svc.cacheKey({ organizationId: ORG_A }, 'k', bad), /禁止字段/)
    }
  })

  test('幂等键绑定 actor：同组织不同 actor 不相互吞掉', ({ assert }) => {
    const svc = ns()
    const scope = { organizationId: ORG_A }
    assert.notEqual(
      svc.idempotencyKey(scope, 'user:7', 'export'),
      svc.idempotencyKey(scope, 'user:8', 'export'),
    )
    assert.notEqual(
      svc.idempotencyKey(scope, 'user:7', 'export'),
      svc.idempotencyKey({ organizationId: ORG_B }, 'user:7', 'export'),
    )
  })

  test('artifact ref / source snapshot / ledger 分组 hash 均落在命名空间内', ({ assert }) => {
    const svc = ns()
    const scope = { organizationId: ORG_A }
    for (const value of [
      svc.artifactRef(scope, 'compiler_output'),
      svc.sourceSnapshotRef(scope, 'wbs'),
      svc.ledgerGroupHash(scope, { period: '2026-08' }),
    ]) {
      assert.isTrue(svc.isInNamespace(scope, value))
      assert.isFalse(svc.isInNamespace({ organizationId: ORG_B }, value))
    }
  })

  test('assertInNamespace：他租户派生值复用被拒', ({ assert }) => {
    const svc = ns()
    const foreign = svc.cacheKey({ organizationId: ORG_B }, 'k')
    assert.throws(
      () => svc.assertInNamespace({ organizationId: ORG_A }, foreign),
      /不属于当前租户范围/,
    )
  })
})

test.group('TenantNamespaceService —— 预览签名防回放（§5.3）', () => {
  const OPERATION = 'dlp_preview'
  const SOURCE_HASH = 'srchash0001'
  const ISSUED_AT = '2026-08-07T00:00:00.000Z'

  test('O1 生成的预览签名在 O2 的 scope 下确认失败（跨租户回放）', ({ assert }) => {
    const svc = ns()
    const sig = svc.buildPreviewSignature(
      { organizationId: ORG_A },
      OPERATION,
      SOURCE_HASH,
      ISSUED_AT,
    )
    // 同 scope 确认通过
    svc.assertPreviewSignature(
      { organizationId: ORG_A },
      OPERATION,
      SOURCE_HASH,
      ISSUED_AT,
      sig.signature,
    )
    // 换组织提交 → fail closed
    assert.throws(
      () =>
        svc.assertPreviewSignature(
          { organizationId: ORG_B },
          OPERATION,
          SOURCE_HASH,
          ISSUED_AT,
          sig.signature,
        ),
      /预览签名已失效/,
    )
  })

  test('source hash / operation / issuedAt 任一变化即拒绝，且拒绝语义一致', ({ assert }) => {
    const svc = ns()
    const scope = { organizationId: ORG_A }
    const sig = svc.buildPreviewSignature(scope, OPERATION, SOURCE_HASH, ISSUED_AT).signature

    const messages: string[] = []
    const variants: Array<[string, string, string]> = [
      [OPERATION, 'tampered-hash', ISSUED_AT],
      ['other_preview', SOURCE_HASH, ISSUED_AT],
      [OPERATION, SOURCE_HASH, '2026-08-08T00:00:00.000Z'],
    ]
    for (const [op, hash, at] of variants) {
      try {
        svc.assertPreviewSignature(scope, op, hash, at, sig)
        messages.push('no-error')
      } catch (err) {
        messages.push((err as Error).message)
      }
    }
    assert.deepEqual(new Set(messages).size, 1, '所有失败原因必须返回同一 message，不做侧信道区分')
    assert.notInclude(messages, 'no-error')
  })

  test('预览签名本身落在租户命名空间内（可被 assertInNamespace 复核）', ({ assert }) => {
    const svc = ns()
    const sig = svc.buildPreviewSignature(
      { organizationId: ORG_A },
      OPERATION,
      SOURCE_HASH,
      ISSUED_AT,
    )
    assert.equal(sig.namespace, svc.namespace({ organizationId: ORG_A }))
    assert.isTrue(svc.isInNamespace({ organizationId: ORG_A }, sig.signature))
  })
})

test.group('TenantNamespaceService —— 导出句柄（§5.2）', () => {
  // 过期时间必须在每个 test 内现算：模块加载时算一次的话，整套件跑几十分钟，
  // 轮到本组时这个「未来 60 秒」早已成为过去，句柄会被判为已失效。
  const future = () => new Date(Date.now() + 60_000).toISOString()

  test('句柄创建即绑定 scope/actor/source hash/过期时间', ({ assert }) => {
    const svc = ns()
    const expiresAt = future()
    const handle = svc.buildExportHandle({
      scope: { organizationId: ORG_A },
      actorRef: 'user:7',
      resourceType: 'report',
      sourceHash: 'srchash0002',
      expiresAt,
    })
    assert.equal(handle.namespace, svc.namespace({ organizationId: ORG_A }))
    assert.isNotEmpty(handle.organizationScopeHash)
    assert.isNotEmpty(handle.actorScopeHash)
    assert.equal(handle.sourceHash, 'srchash0002')
    assert.equal(handle.expiresAt, expiresAt)
    svc.assertExportHandle({ organizationId: ORG_A }, handle)
  })

  test('他组织句柄与过期句柄同一拒绝语义', ({ assert }) => {
    const svc = ns()
    const expiresAt = future()
    const handle = svc.buildExportHandle({
      scope: { organizationId: ORG_A },
      actorRef: 'user:7',
      resourceType: 'report',
      sourceHash: 'srchash0002',
      expiresAt,
    })
    const expired = svc.buildExportHandle({
      scope: { organizationId: ORG_A },
      actorRef: 'user:7',
      resourceType: 'report',
      sourceHash: 'srchash0002',
      expiresAt: '2020-01-01T00:00:00.000Z',
    })

    const messages: string[] = []
    for (const [scope, h] of [
      [{ organizationId: ORG_B }, handle],
      [{ organizationId: ORG_A }, expired],
    ] as const) {
      try {
        svc.assertExportHandle(scope, h)
        messages.push('no-error')
      } catch (err) {
        messages.push((err as Error).message)
      }
    }
    assert.equal(messages[0], messages[1])
    assert.notInclude(messages, 'no-error')
  })

  test('actor 不同则句柄不同（句柄不可在同组织内跨 actor 转让）', ({ assert }) => {
    const svc = ns()
    const base = {
      scope: { organizationId: ORG_A },
      resourceType: 'report' as const,
      sourceHash: 'srchash0002',
      expiresAt: future(),
    }
    assert.notEqual(
      svc.buildExportHandle({ ...base, actorRef: 'user:7' }).handle,
      svc.buildExportHandle({ ...base, actorRef: 'user:8' }).handle,
    )
  })
})

// ──────────────────────────────────────────────
// §5.6 可选缓存 / 邻域 adapter 的安全降级
// ──────────────────────────────────────────────

class FakeCache implements TenantCacheLike {
  readonly store = new Map<string, string>()
  failGet = false
  failSet = false

  async get(_org: number, key: string): Promise<string | null> {
    if (this.failGet) throw new Error('cache down')
    return this.store.get(key) ?? null
  }

  async set(_org: number, key: string, value: string, _ttl: number): Promise<void> {
    if (this.failSet) throw new Error('cache down')
    this.store.set(key, value)
  }
}

test.group('TenantDegradedModeService —— 降级不得损失隔离（§5.6）', () => {
  test('无缓存（本机默认路径）：直接在 scope 内重算，不视为异常', async ({ assert }) => {
    const svc = new TenantDegradedModeService()
    const outcome = await svc.cacheOrCompute({
      scope: { organizationId: ORG_A },
      label: 'summary',
      ttlSeconds: 60,
      cache: null,
      compute: async () => ({ total: 3 }),
    })
    assert.equal(outcome.source, 'miss')
    assert.isNull(outcome.warning)
    assert.deepEqual(outcome.value, { total: 3 })
  })

  test('命中需通过命名空间复核；缓存故障降级为重算并带低敏 warning', async ({ assert }) => {
    const svc = new TenantDegradedModeService()
    const cache = new FakeCache()
    const scope = { organizationId: ORG_A }
    let computed = 0
    const run = () =>
      svc.cacheOrCompute({
        scope,
        label: 'summary',
        ttlSeconds: 60,
        cache,
        compute: async () => {
          computed += 1
          return { total: computed }
        },
      })

    const first = await run()
    assert.equal(first.source, 'miss')
    const second = await run()
    assert.equal(second.source, 'hit')
    assert.equal(computed, 1, '命中时不得重算')

    cache.failGet = true
    const degraded = await run()
    assert.equal(degraded.source, 'degraded')
    assert.equal(degraded.warning?.code, 'DEGRADED_ADAPTER_MODULE')
    assert.equal(computed, 2, '缓存故障必须重算，不得回退到未界定范围的数据源')
    // warning 只含低敏字段
    assert.deepEqual(Object.keys(degraded.warning ?? {}).sort(), ['code', 'message', 'reasonCode'])
  })

  test('缓存里塞入他组织命名空间的值：按 miss 处理并丢弃，绝不返回', async ({ assert }) => {
    const svc = new TenantDegradedModeService()
    const namespaces = ns()
    const cache = new FakeCache()
    const scopeA = { organizationId: ORG_A }
    const keyA = namespaces.cacheKey(scopeA, 'summary')

    // 模拟命名空间语义变更/串租残留：键位于 A，但内容标记属于 B。
    cache.store.set(
      keyA,
      JSON.stringify({ ns: namespaces.namespace({ organizationId: ORG_B }), v: { total: 999 } }),
    )

    const outcome = await svc.cacheOrCompute({
      scope: scopeA,
      label: 'summary',
      ttlSeconds: 60,
      cache,
      compute: async () => ({ total: 1 }),
    })
    assert.equal(outcome.source, 'miss')
    assert.deepEqual(outcome.value, { total: 1 }, '绝不得返回他组织缓存值')
  })

  test('registry degraded 资源返回低敏 warning，registered 资源无 warning', ({ assert }) => {
    const svc = new TenantDegradedModeService()
    assert.isNull(svc.resolveRegistryDegradation('project'))
    const warning = svc.resolveRegistryDegradation('source_attribution')
    assert.equal(warning?.code, 'DEGRADED_ADAPTER_MODULE')
    assert.equal(warning?.reasonCode, 'DEGRADED_RESOURCE')
    assert.notInclude(warning?.message ?? '', 'source_attribution')
  })

  test('adapter 抛错返回 unavailable 信封，不抛到无 scope 兜底分支', async ({ assert }) => {
    const svc = new TenantDegradedModeService()
    const ok = await svc.runWithAdapterFallback({
      resourceType: 'project',
      run: async () => 'value',
    })
    assert.equal(ok.envelope.decision, 'allow')
    assert.equal(ok.value, 'value')

    const failed = await svc.runWithAdapterFallback({
      resourceType: 'project',
      run: async () => {
        throw new Error('adapter down')
      },
    })
    assert.equal(failed.envelope.decision, 'unavailable')
    assert.isNull(failed.value)
  })

  test('degraded 资源即使执行成功也标记 degrade（调用方须收敛能力）', async ({ assert }) => {
    const svc = new TenantDegradedModeService()
    const result = await svc.runWithAdapterFallback({
      resourceType: 'source_attribution',
      run: async () => 'value',
    })
    assert.equal(result.envelope.decision, 'degrade')
    assert.equal(result.envelope.reasonCode, 'DEGRADED_RESOURCE')
  })

  test('PermissionDeniedException 是降级路径的统一拒绝类型（不泄露细节）', ({ assert }) => {
    const svc = ns()
    let caught: unknown = null
    try {
      svc.assertInNamespace({ organizationId: ORG_A }, 'mtns:v1:deadbeefdeadbeef:cache:x:0')
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, PermissionDeniedException)
  })
})
