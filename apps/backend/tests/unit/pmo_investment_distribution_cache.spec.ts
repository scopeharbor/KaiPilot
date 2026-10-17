import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import PmoInvestmentDistributionCache, {
  buildInvestmentCacheKey,
} from '#services/pmo_investment_distribution_cache'
import PmoInvestmentDistributionService, {
  type InvestmentProjectFact,
} from '#services/pmo_investment_distribution_service'
import { PMO_INVESTMENT_WARNING_CODES } from '@aiproj/types'

const user = { id: 11, isSuperAdmin: false } as any

const projects: InvestmentProjectFact[] = [
  {
    id: 1,
    organizationId: 1,
    name: 'Alpha',
    category: 'delivery',
    priority: 'high',
    status: 'active',
    createdBy: 11,
    updatedAt: '2026-07-28T00:00:00.000Z',
    settings: { lifecyclePhase: 'build' },
  },
  {
    id: 2,
    organizationId: 1,
    name: 'Beta',
    category: 'delivery',
    priority: 'medium',
    status: 'active',
    createdBy: 11,
    updatedAt: '2026-07-27T00:00:00.000Z',
    settings: { lifecyclePhase: 'build' },
  },
  {
    id: 3,
    organizationId: 1,
    name: 'Gamma',
    category: 'research',
    priority: 'low',
    status: 'active',
    createdBy: 11,
    updatedAt: '2026-07-26T00:00:00.000Z',
    settings: { lifecyclePhase: 'discover' },
  },
]

function makeReaders(signature: () => string, counter?: { reads: number }) {
  return {
    readProjects: async () => {
      if (counter) counter.reads += 1
      return projects
    },
    readSourceSignature: async () => signature(),
  }
}

const cacheKeyInput = {
  organizationId: 1,
  actorId: 11,
  metricVersion: 'pmo-investment-distribution.v1',
  basis: 'project_count',
  dimension: 'project_type',
  displayMode: 'donut',
  topN: 10,
  trendWindow: 'last_30_days',
}

test.group('PMO 投入分布派生缓存（§4.13/§4.14）', () => {
  test('缓存未命中后写入，同签名重复读取命中且不再回源', async ({ assert }) => {
    const counter = { reads: 0 }
    const cache = new PmoInvestmentDistributionCache({ enabled: true })
    const service = new PmoInvestmentDistributionService(
      makeReaders(() => 'sig-1', counter),
      cache,
    )

    const first = await service.getSummaryWithCacheInfo(user, 1, {})
    assert.isFalse(first.cacheHit)
    assert.equal(counter.reads, 1)
    assert.isAbove(first.summary.buckets.length, 0)

    const second = await service.getSummaryWithCacheInfo(user, 1, {})
    assert.isTrue(second.cacheHit)
    assert.equal(counter.reads, 1, '命中缓存时不得重复回源读取项目事实')
    assert.deepEqual(second.summary.buckets, first.summary.buckets)
  })

  test('TTL 过期视为未命中并重新计算', async ({ assert }) => {
    let now = 1_000
    const cache = new PmoInvestmentDistributionCache({
      enabled: true,
      ttlMs: 500,
      now: () => now,
    })
    const key = buildInvestmentCacheKey(cacheKeyInput)
    const summary = { meta: {}, buckets: [], warnings: [] } as any

    cache.set(key, 1, summary, 'sig-1')
    assert.equal(cache.get(key, 'sig-1').reason, 'hit')

    now += 501
    const expired = cache.get(key, 'sig-1')
    assert.isFalse(expired.hit)
    assert.equal(expired.reason, 'expired')
    assert.equal(cache.size(), 0, '过期条目必须被清除')
  })

  test('来源事实变化导致签名变化时缓存失效', async ({ assert }) => {
    const counter = { reads: 0 }
    let signature = 'sig-1'
    const cache = new PmoInvestmentDistributionCache({ enabled: true })
    const service = new PmoInvestmentDistributionService(
      makeReaders(() => signature, counter),
      cache,
    )

    await service.getSummaryWithCacheInfo(user, 1, {})
    assert.equal(counter.reads, 1)

    signature = 'sig-2'
    const afterChange = await service.getSummaryWithCacheInfo(user, 1, {})
    assert.isFalse(afterChange.cacheHit, '来源签名变化后不得复用旧结果')
    assert.equal(counter.reads, 2)
  })

  test('组织级失效只清本组织条目', async ({ assert }) => {
    const cache = new PmoInvestmentDistributionCache({ enabled: true })
    const summary = { meta: {}, buckets: [], warnings: [] } as any
    cache.set('org1:a', 1, summary, 'sig')
    cache.set('org1:b', 1, summary, 'sig')
    cache.set('org2:a', 2, summary, 'sig')

    assert.equal(cache.invalidateOrganization(1), 2)
    assert.equal(cache.size(), 1)
    assert.equal(cache.get('org2:a', 'sig').reason, 'hit')
  })

  test('缓存关闭时读路径仍返回 bounded 结果且无降级 warning', async ({ assert }) => {
    const counter = { reads: 0 }
    const service = new PmoInvestmentDistributionService(
      makeReaders(() => 'sig-1', counter),
      new PmoInvestmentDistributionCache({ enabled: false }),
    )

    const first = await service.getSummaryWithCacheInfo(user, 1, { topN: 2 })
    const second = await service.getSummaryWithCacheInfo(user, 1, { topN: 2 })

    assert.isFalse(first.cacheHit)
    assert.isFalse(second.cacheHit)
    assert.isFalse(first.cacheDegraded)
    assert.equal(counter.reads, 2, '缓存关闭时每次都直接按来源事实计算')
    assert.isAtMost(first.summary.buckets.length, 3, 'topN 上限仍然生效')
    assert.notInclude(
      first.summary.warnings.map((warning) => warning.code),
      PMO_INVESTMENT_WARNING_CODES.CACHE_DEGRADED,
    )
  })

  test('缓存层不可用时降级为直接计算并附 CACHE_DEGRADED warning', async ({ assert }) => {
    const brokenCache = new PmoInvestmentDistributionCache({ enabled: true })
    brokenCache.get = () => {
      throw new Error('cache store unavailable')
    }

    const service = new PmoInvestmentDistributionService(
      makeReaders(() => 'sig-1'),
      brokenCache,
    )

    const result = await service.getSummaryWithCacheInfo(user, 1, {})
    assert.isTrue(result.cacheDegraded)
    assert.isFalse(result.cacheHit)
    assert.isAbove(result.summary.buckets.length, 0, '降级后仍必须返回真实分布')
    assert.include(
      result.summary.warnings.map((warning) => warning.code),
      PMO_INVESTMENT_WARNING_CODES.CACHE_DEGRADED,
    )
  })

  test('缓存实现不依赖 Redis/PostgreSQL/Kafka/VectorDB（含正向对照）', async ({ assert }) => {
    const forbidden = [
      'ioredis',
      'redis',
      'kafkajs',
      'kafka',
      'pg',
      'postgres',
      'postgresql',
      'chromadb',
      'pinecone',
      'weaviate',
      'qdrant',
    ]
    const scan = (source: string) =>
      forbidden.filter((term) =>
        new RegExp(`(from|require)\\s*\\(?['"][^'"]*${term}[^'"]*['"]`, 'i').test(source),
      )

    // 正向对照：扫描器必须能识别已知违规样本，否则「零依赖」结论无效
    const badSample = [
      `import Redis from 'ioredis'`,
      `import { Kafka } from 'kafkajs'`,
      `const pool = require('pg')`,
      `import { ChromaClient } from 'chromadb'`,
    ].join('\n')
    assert.deepEqual(
      scan(badSample),
      ['ioredis', 'redis', 'kafkajs', 'kafka', 'pg', 'chromadb'],
      '正向对照：扫描器必须精确命中已知违规样本中的每一类外部存储依赖',
    )

    const cacheSource = await readFile(
      new URL('../../app/services/pmo_investment_distribution_cache.ts', import.meta.url),
      'utf8',
    )
    assert.deepEqual(scan(cacheSource), [], '缓存实现只能是进程内 Map，不得引入外部存储依赖')
  })
})
