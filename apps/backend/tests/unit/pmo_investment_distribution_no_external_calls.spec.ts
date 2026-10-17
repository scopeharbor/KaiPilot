import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import PmoInvestmentDistributionService from '#services/pmo_investment_distribution_service'
import PmoInvestmentDistributionCache from '#services/pmo_investment_distribution_cache'
import { buildLargePortfolioFixture } from '#tests/fixtures/pmo_investment_large_portfolio'

/**
 * 无外部调用门禁（§6.3）。投入分布是只读聚合：
 * 不得调用 AIGateway/模型、不得启动 Compiler、不得触发 OAuth/Webhook/Web Push/网络。
 */

const user = { id: 3, isSuperAdmin: false } as any
const fixture = buildLargePortfolioFixture(1, 40)

/** 被禁模块词条：出现在 import/require 目标里即视为违规。 */
const FORBIDDEN_MODULE_TERMS = [
  'ai_m0',
  'ai_gateway',
  'aigateway',
  'compiler',
  'node:http',
  'node:https',
  'axios',
  'node-fetch',
  'undici',
  'got',
  'web-push',
  'webpush',
  'oauth',
  'webhook',
]

function scanForbiddenImports(source: string): string[] {
  return FORBIDDEN_MODULE_TERMS.filter((term) =>
    new RegExp(`(from|require)\\s*\\(?['"][^'"]*${term}[^'"]*['"]`, 'i').test(source),
  )
}

const CHANGE_SOURCE_FILES = [
  '../../app/services/pmo_investment_distribution_service.ts',
  '../../app/services/pmo_investment_distribution_cache.ts',
  '../../app/services/pmo_investment_distribution_audit.ts',
  '../../app/controllers/pmo_investment_distribution_controller.ts',
  '../../app/policies/pmo_investment_distribution_policy.ts',
  '../../app/validators/pmo_investment_distribution.ts',
]

function makeService() {
  return new PmoInvestmentDistributionService(
    {
      readProjects: async () => fixture.projects,
      readEstimatedEffortHours: async () => fixture.effortFacts,
      readPlannedEffortHours: async () => fixture.effortFacts,
      readResourceAllocationPercent: async () => fixture.allocationFacts,
      readSourceSignature: async () => 'no-external-sig',
    },
    new PmoInvestmentDistributionCache({ enabled: false }),
  )
}

test.group('PMO 投入分布无外部调用门禁（§6.3）', () => {
  test('实现文件不引入 AI/Compiler/OAuth/Webhook/WebPush/网络模块（含正向对照）', async ({
    assert,
  }) => {
    // 正向对照：扫描器必须能识别已知违规样本，否则「零外部调用」结论无效
    const badSample = [
      `import { AIGateway } from '#services/ai_m0/gateway'`,
      `import axios from 'axios'`,
      `const https = require('node:https')`,
      `import webpush from 'web-push'`,
    ].join('\n')
    assert.deepEqual(
      scanForbiddenImports(badSample),
      ['ai_m0', 'node:http', 'node:https', 'axios', 'web-push'],
      '正向对照：扫描器必须精确命中已知违规样本中的每一类外部依赖',
    )

    for (const relativePath of CHANGE_SOURCE_FILES) {
      const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
      assert.deepEqual(
        scanForbiddenImports(source),
        [],
        `${relativePath} 不得引入 AI/Compiler/外部网络依赖`,
      )
    }
  })

  test('summary/trends/drill-down 读取全程不触发任何 fetch', async ({ assert }) => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = (async (...args: unknown[]) => {
      fetchCalls += 1
      throw new Error(`投入分布读路径不得发起网络请求：${String(args[0])}`)
    }) as typeof fetch

    try {
      const service = makeService()
      const summary = await service.getSummary(user, 1, {
        basis: 'project_count',
        dimension: 'project_type',
      })
      const trends = await service.getTrends(user, 1, { basis: 'estimated_effort_hours' })
      const drill = await service.getDrillDown(user, 1, {
        basis: 'project_count',
        dimension: 'project_type',
        bucketKey: 'delivery',
      })

      assert.isAbove(summary.buckets.length, 0)
      assert.lengthOf(trends.data, 1)
      assert.isAbove(drill.data.length, 0)
      assert.equal(fetchCalls, 0, '读路径必须零网络调用')

      // 正向对照：探针本身可用——显式调用会被计数并抛错
      await assert.rejects(() => globalThis.fetch('https://example.invalid'))
      assert.equal(fetchCalls, 1, '探针必须真的拦截并计数 fetch 调用')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('读取路径不修改任何项目事实（无副作用）', async ({ assert }) => {
    const snapshot = JSON.stringify(fixture.projects)
    const service = makeService()

    await service.getSummary(user, 1, { basis: 'estimated_effort_hours', dimension: 'department' })
    await service.getDrillDown(user, 1, {
      basis: 'project_count',
      dimension: 'department',
      bucketKey: 'platform',
    })

    assert.equal(JSON.stringify(fixture.projects), snapshot, '读路径不得改写来源事实对象')
  })
})
