/**
 * v2-5-compiler-cache-management-api —— CompilerCacheService 单元测试（无 DB，注入 store）。
 *
 * 覆盖（不依赖 DB / HTTP）：
 * - 范围→前缀映射：organization / stage（必带 stageId）/ cachePolicyVersion（降级为组织级）
 * - 切片 2 预览：affectedCount/remainingCount/sampleKeyHashes 正确、no-delete（预览后条目数不变）
 * - 切片 3 失效：需显式确认、removedCount 正确、组织范围隔离（A 失效不触及 B）
 * - 缓存后端降级：Redis 枚举失败 → 盘点/预览/失效 best-effort + degraded，不冒泡（task 6.3）
 * - 失效后重算确定性等值：Stage 缓存失效后同输入重执行输出逐位相同（task 6.1）
 */
import { test } from '@japa/runner'
import {
  MemoryCacheStore,
  RedisCacheStore,
  type RedisLikeClient,
} from '#services/cache/cache_store'
import {
  previewCacheInvalidation,
  invalidateCache,
} from '#services/compiler/compiler_cache_service'
import { StageCacheService, stageCacheKey } from '#services/compiler/stage_cache_service'

const ORG_A = 4001
const ORG_B = 4002

/** 用生产键格式（stage:<stageId>:<hash>）预填内存 store。 */
async function seedStage(
  store: MemoryCacheStore,
  orgId: number,
  stageId: string,
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await store.set(orgId, `stage:${stageId}:hash${i}`, JSON.stringify({ v: i }), 3600)
  }
}

/** Redis 假客户端：scan/delKeys 一律抛错，用于降级回归。 */
function makeFailingRedis(): RedisLikeClient {
  return {
    async get() {
      return null
    },
    async set() {},
    async del() {},
    async scan() {
      throw new Error('redis down')
    },
    async delKeys() {
      throw new Error('redis down')
    },
  }
}

// ── 范围映射 + 预览 ──

test.group('CompilerCacheService - 预览（切片 2）', () => {
  test('organization 范围预览：affected=全部、remaining=0、不删除', async ({ assert }) => {
    const store = new MemoryCacheStore()
    await seedStage(store, ORG_A, 'intent_parsing', 3)
    await seedStage(store, ORG_A, 'dag_stub', 2)

    const preview = await previewCacheInvalidation(ORG_A, { scope: 'organization' }, store)

    assert.equal(preview.affectedCount, 5)
    assert.equal(preview.remainingCount, 0)
    assert.isNotEmpty(preview.sampleKeyHashes)
    // no-delete：预览后条目数不变
    const after = await store.inventory(ORG_A, '')
    assert.equal(after.count, 5)
  })

  test('stage 范围预览：affected=该 stage、remaining=其余、必带 stageId', async ({ assert }) => {
    const store = new MemoryCacheStore()
    await seedStage(store, ORG_A, 'intent_parsing', 3)
    await seedStage(store, ORG_A, 'dag_stub', 2)

    const preview = await previewCacheInvalidation(
      ORG_A,
      { scope: 'stage', stageId: 'intent_parsing' },
      store,
    )
    assert.equal(preview.affectedCount, 3)
    assert.equal(preview.remainingCount, 2)

    // 缺 stageId → 抛错（Validator 与 service 双重防护）
    await assert.rejects(
      () => previewCacheInvalidation(ORG_A, { scope: 'stage' }, store),
      /stageId/,
    )
  })

  test('stageId 拒绝 Redis glob/前缀注入字符', async ({ assert }) => {
    const store = new MemoryCacheStore()
    await seedStage(store, ORG_A, 'intent_parsing', 3)
    await seedStage(store, ORG_A, 'dag_stub', 2)

    await assert.rejects(
      () => previewCacheInvalidation(ORG_A, { scope: 'stage', stageId: '*' }, store),
      /非法字符/,
    )
    await assert.rejects(
      () => previewCacheInvalidation(ORG_A, { scope: 'stage', stageId: 'intent:parsing' }, store),
      /非法字符/,
    )
  })

  test('cachePolicyVersion 范围预览：降级为组织级 + degraded/note', async ({ assert }) => {
    const store = new MemoryCacheStore()
    await seedStage(store, ORG_A, 'intent_parsing', 4)

    const preview = await previewCacheInvalidation(
      ORG_A,
      { scope: 'cachePolicyVersion', cachePolicyVersion: '1' },
      store,
    )
    assert.equal(preview.affectedCount, 4)
    assert.equal(preview.remainingCount, 0)
    assert.isTrue(preview.degraded)
    assert.isString(preview.note)
  })
})

// ── 受控失效 + 组织隔离 ──

test.group('CompilerCacheService - 失效（切片 3）', () => {
  test('未确认（confirm!=true）拒绝且不清除', async ({ assert }) => {
    const store = new MemoryCacheStore()
    await seedStage(store, ORG_A, 'intent_parsing', 3)

    await assert.rejects(
      () => invalidateCache(ORG_A, 1, { scope: 'organization', confirm: false }, store),
      /确认/,
    )
    const after = await store.inventory(ORG_A, '')
    assert.equal(after.count, 3, '拒绝后条目数不变')
  })

  test('stage 范围失效：只清该 stage，removedCount 正确', async ({ assert }) => {
    const store = new MemoryCacheStore()
    await seedStage(store, ORG_A, 'intent_parsing', 3)
    await seedStage(store, ORG_A, 'dag_stub', 2)

    const res = await invalidateCache(
      ORG_A,
      1,
      { scope: 'stage', stageId: 'intent_parsing', confirm: true },
      store,
    )
    assert.equal(res.removedCount, 3)
    // 其余 stage 未受影响
    const remaining = await store.inventory(ORG_A, '')
    assert.equal(remaining.count, 2)
  })

  test('组织范围隔离：对 A 失效不触及 B（task 6.2）', async ({ assert }) => {
    const store = new MemoryCacheStore()
    await seedStage(store, ORG_A, 'intent_parsing', 3)
    await seedStage(store, ORG_B, 'intent_parsing', 4)

    await invalidateCache(ORG_A, 1, { scope: 'organization', confirm: true }, store)

    const aLeft = await store.inventory(ORG_A, '')
    const bLeft = await store.inventory(ORG_B, '')
    assert.equal(aLeft.count, 0, 'A 全清')
    assert.equal(bLeft.count, 4, 'B 完全不受影响')
  })
})

// ── 缓存后端降级（task 6.3） ──

test.group('CompilerCacheService - Redis 降级不冒泡', () => {
  test('Redis 枚举失败 → 预览 best-effort + degraded，不抛', async ({ assert }) => {
    const store = new RedisCacheStore(makeFailingRedis())
    const preview = await previewCacheInvalidation(ORG_A, { scope: 'organization' }, store)
    assert.equal(preview.affectedCount, 0)
    assert.isTrue(preview.degraded)
  })

  test('Redis 删除失败 → 失效 best-effort + degraded，不抛', async ({ assert }) => {
    const store = new RedisCacheStore(makeFailingRedis())
    const res = await invalidateCache(ORG_A, 1, { scope: 'organization', confirm: true }, store)
    assert.equal(res.removedCount, 0)
    assert.isTrue(res.degraded)
  })
})

// ── 失效后重算确定性等值（task 6.1） ──

test.group('CompilerCacheService - 失效后重算确定性等值', () => {
  test('Stage 缓存失效后同输入重执行，输出逐位相同（缓存命中与否等价）', async ({ assert }) => {
    const store = new MemoryCacheStore()
    const svc = new StageCacheService(store)
    const stageId = 'intent_parsing'
    const input = { projectName: '示例', tasks: [1, 2, 3] }

    let calls = 0
    const compute = async () => {
      calls++
      return { plan: 'deterministic', at: 'v1', nums: [4, 5, 6] }
    }

    const first = await svc.getOrCompute(ORG_A, stageId, input, compute)
    assert.equal(calls, 1, '首次未命中，计算一次')
    const second = await svc.getOrCompute(ORG_A, stageId, input, compute)
    assert.equal(calls, 1, '第二次命中，不重算')
    assert.deepEqual(second, first)

    // 经受控失效清掉该 stage 缓存
    const res = await invalidateCache(ORG_A, 1, { scope: 'stage', stageId, confirm: true }, store)
    assert.equal(res.removedCount, 1)

    // 失效后同输入重执行：重算但输出与失效前逐位相同
    const third = await svc.getOrCompute(ORG_A, stageId, input, compute)
    assert.equal(calls, 2, '失效后重算一次')
    assert.deepEqual(third, first, '失效只影响是否命中缓存，不影响确定性输出')

    // 键格式即生产键格式（stage:<stageId>:<hash>），失效前缀能命中
    assert.match(stageCacheKey(stageId, input), /^stage:intent_parsing:/)
  })
})
