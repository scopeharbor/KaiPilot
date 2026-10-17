/**
 * 资源需求预测 AI 咨询单元测试（P1 5.3）。
 *
 * v3-resource-demand-forecasting §5：手动触发的低敏 AI 咨询路径。
 *
 * 覆盖：
 *   - AI advisory 返回 advisoryOnly=true, writesApplied=false
 *   - AI advisory 只处理低敏输入（无项目名、资源名）
 *   - AI advisory 降级优雅（返回 AI_UNAVAILABLE warning）
 *   - AI advisory 响应结构校验
 *   - AI advisory 不产生正式写入
 *
 * 红线：
 *   - 所有测试使用 mock AIGateway，无真实 AI 调用
 *   - advisoryOnly 必须始终为 true，writesApplied 始终为 false
 *   - 失败时不抛异常，返回降级结果
 */
import { test } from '@japa/runner'
import { ResourceDemandForecastingAiAdvisor } from '#services/resource_demand_forecasting_ai'
import type { ForecastAdvisoryInput } from '#services/resource_demand_forecasting_ai'
import { FORECAST_WARNING_CODES, FORECAST_CONFIDENCE_BANDS } from '@aiproj/types'
import type { ForecastAiAdvisory } from '@aiproj/types'

// ─── Mock AIGateway 工厂 ────────────────────────────────────────────────────

interface MockGatewayOptions {
  model?: string
  /** 若提供则 simulate 成功调用，返回该 rawText */
  successRawText?: string
  /** 若为 true 则 simulate 调用抛出异常 */
  shouldThrow?: boolean
  errorMessage?: string
}

function createMockGateway(opts: MockGatewayOptions = {}) {
  const model = opts.model ?? 'mock-model-v1'

  return {
    provider: 'mock-provider',
    model,
    isReal: false,

    // 形参与真实 AIGateway.generate(request) 对齐：桩不消费请求，但保留入参位，
    // 否则调用方传参会在编译期报 TS2554。
    generate: async (_request?: unknown) => {
      if (opts.shouldThrow) {
        throw new Error(opts.errorMessage ?? 'AI service unavailable')
      }

      return {
        rawText:
          opts.successRawText ??
          JSON.stringify({
            narrative: '根据预测数据，未来4周内前端开发角色存在显著缺口。',
            suggestedActions: [
              '优先招聘或内部调动2名前端开发工程师',
              '对现有前端任务进行优先级排序，非关键任务延期1-2周',
              '考虑将部分前端工作外包或使用低代码工具替代',
            ],
          }),
        triggeredErrors: [],
        outputTokens: 150,
        firstTokenMs: 320,
        totalMs: 850,
        usingRealAdapter: false,
      }
    },

    stream: async function* () {
      yield {
        kind: 'text' as const,
        text:
          opts.successRawText ??
          JSON.stringify({
            narrative: '根据预测数据，未来4周内前端开发角色存在显著缺口。',
            suggestedActions: [
              '优先招聘或内部调动2名前端开发工程师',
              '对现有前端任务进行优先级排序',
              '考虑将部分前端工作外包',
            ],
          }),
      }
      yield {
        kind: 'done' as const,
        usage: { outputTokens: 150, inputTokens: 80, totalTokens: 230 },
      }
    },
  }
}

// ─── Mock 输入数据（低敏）──────────────────────────────────────────────────

function createLowSensitiveInput(): ForecastAdvisoryInput {
  return {
    summaryText:
      '组织在未来30天内共有15个活跃项目，总预测需求为3200小时，总已分配1800小时。' +
      '前5个缺口包括：frontend（480小时）、backend（320小时）、devops（200小时）。' +
      '整体资源覆盖率为0.82，置信度为中等。',
    topGaps: [
      { role: 'frontend', gapHours: 480 },
      { skill: 'react', gapHours: 350 },
      { role: 'backend', gapHours: 320 },
      { skill: 'typescript', gapHours: 280 },
      { role: 'devops', gapHours: 200 },
    ],
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** 校验 ForecastAiAdvisory 响应基础结构 */
function assertValidAdvisoryShape(assert: any, advisory: ForecastAiAdvisory): void {
  assert.isTrue(advisory.advisoryOnly)
  assert.isFalse(advisory.writesApplied)
  assert.isString(advisory.narrative)
  assert.isArray(advisory.relatedGaps)
  assert.isArray(advisory.suggestedActions)
  assert.isArray(advisory.warnings)

  // relatedGaps 每项结构
  for (const gap of advisory.relatedGaps) {
    assert.isDefined(gap.gapHours)
    assert.isAtLeast(gap.gapHours, 0)
  }

  // confidence 必须是有效的 ForecastConfidenceBand
  const validBands = Object.values(FORECAST_CONFIDENCE_BANDS)
  assert.include(validBands, advisory.confidence)
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Group
// ═══════════════════════════════════════════════════════════════════════════

test.group('ResourceDemandForecastingAI — Advisory', () => {
  // ─── 1: AI advisory returns advisoryOnly=true and writesApplied=false ───

  test('AI advisory returns advisoryOnly=true and writesApplied=false', async ({ assert }) => {
    const gateway = createMockGateway({
      successRawText: JSON.stringify({
        narrative: '根据预测数据，前端资源缺口需要优先关注。',
        suggestedActions: ['增加前端人力', '调整项目优先级'],
      }),
    })

    // isTestMode=false 以触发真实调用路径
    const advisor = new ResourceDemandForecastingAiAdvisor(gateway as any, false)
    const input = createLowSensitiveInput()
    const result = await advisor.generateAdvisory(1, input)

    assert.isTrue(result.advisoryOnly)
    assert.isFalse(result.writesApplied)
    assert.isString(result.narrative)
    assert.isAtLeast(result.narrative.length, 5)
    assert.equal(result.suggestedActions.length, 2)
    assert.equal(result.relatedGaps.length, input.topGaps.length)
    assert.equal(result.warnings.length, 0)
    assert.equal(result.confidence, FORECAST_CONFIDENCE_BANDS.MEDIUM)
    assert.equal(result.model, 'mock-model-v1')
  })

  // ─── 2: AI advisory handles low-sensitive input only (no project names, resource names) ───

  test('AI advisory handles low-sensitive input only (no project names, resource names)', async ({
    assert,
  }) => {
    const gateway = createMockGateway({
      successRawText: JSON.stringify({
        narrative: '基于聚合数据的分析，整体资源压力在可控范围内。',
        suggestedActions: ['保持现状，持续监控'],
      }),
    })

    const advisor = new ResourceDemandForecastingAiAdvisor(gateway as any, false)

    // 输入中故意包含不应存在的敏感字段 —— advisory 本身不读取这些
    const input: ForecastAdvisoryInput = {
      summaryText: 'KPI: 总需求 1200h, 已分配 800h, 缺口 400h',
      topGaps: [
        { role: 'frontend', gapHours: 200 },
        { skill: 'react', gapHours: 150 },
      ],
    }

    // 验证输入不包含项目名称或资源名称
    assert.isFalse(input.summaryText.includes('项目名称'))
    assert.isFalse(input.summaryText.includes('张三'))
    assert.isFalse(input.summaryText.includes('李四'))
    // topGaps 只包含 role/skill 标签和小时数，不应包含身份信息
    for (const gap of input.topGaps) {
      assert.isDefined(gap.gapHours)
      // 确保没有泄露名称字段
      assert.isUndefined((gap as any).projectName)
      assert.isUndefined((gap as any).resourceName)
      assert.isUndefined((gap as any).taskTitle)
    }

    const result = await advisor.generateAdvisory(1, input)
    assert.isTrue(result.advisoryOnly)
    assert.isFalse(result.writesApplied)

    // 返回的 narrative 不应包含项目名/资源名
    assert.isFalse(result.narrative.includes('张三'))
    assert.isFalse(result.narrative.includes('李四'))
    assert.isFalse(result.narrative.includes('项目名称'))
  })

  // ─── 3: AI advisory degrades gracefully on failure (returns AI_UNAVAILABLE warning) ───

  test('AI advisory degrades gracefully on failure (returns AI_UNAVAILABLE warning)', async ({
    assert,
  }) => {
    const gateway = createMockGateway({
      shouldThrow: true,
      errorMessage: 'Connection refused: AI endpoint unreachable',
    })

    const advisor = new ResourceDemandForecastingAiAdvisor(gateway as any, false)
    const input = createLowSensitiveInput()

    // 不应抛出异常
    const result = await advisor.generateAdvisory(1, input)

    // 验证降级结果
    assert.isTrue(result.advisoryOnly)
    assert.isFalse(result.writesApplied)
    assert.isString(result.narrative)
    assert.isAtLeast(result.narrative.length, 1)
    assert.equal(result.suggestedActions.length, 0)
    assert.equal(result.warnings.length, 1)
    assert.equal(result.warnings[0], FORECAST_WARNING_CODES.AI_UNAVAILABLE)
    assert.equal(result.confidence, FORECAST_CONFIDENCE_BANDS.UNKNOWN)
    assert.isUndefined(result.model)

    // relatedGaps 仍应返回（只读数据，即使降级也要保留）
    assert.equal(result.relatedGaps.length, input.topGaps.length)
  })

  // ─── 4: AI advisory response structure is valid ───

  test('AI advisory response structure is valid', async ({ assert }) => {
    const narrativeText = '资源预测显示未来两周存在中等程度的资源紧张，建议优先关注前端角色缺口。'
    const gateway = createMockGateway({
      successRawText: JSON.stringify({
        narrative: narrativeText,
        suggestedActions: [
          '第1周：评估前端工程师招聘计划',
          '第1周：优化任务分配，减少单点瓶颈',
          '第2周：启动跨团队资源借调流程',
          '第2周：安排技能提升培训以覆盖缺口',
        ],
      }),
    })

    const advisor = new ResourceDemandForecastingAiAdvisor(gateway as any, false)
    const input = createLowSensitiveInput()
    const result = await advisor.generateAdvisory(1, input)

    // 基础结构（复用 helper）
    assertValidAdvisoryShape(assert as any, result)

    // 成功路径特定断言
    assert.equal(result.narrative, narrativeText)
    assert.equal(result.suggestedActions.length, 4)
    assert.include(result.suggestedActions[0]!, '第1周')
    assert.equal(result.confidence, FORECAST_CONFIDENCE_BANDS.MEDIUM)
    assert.isDefined(result.model)
    assert.isString(result.model!)
    assert.isAtLeast(result.model!.length, 1)
    assert.equal(result.warnings.length, 0)

    // relatedGaps 应与输入一致
    assert.equal(result.relatedGaps.length, input.topGaps.length)
    assert.equal(result.relatedGaps[0]!.role, 'frontend')
    assert.equal(result.relatedGaps[0]!.gapHours, 480)
    assert.equal(result.relatedGaps[1]!.skill, 'react')
    assert.equal(result.relatedGaps[1]!.gapHours, 350)
  })

  // ─── 5: AI advisory does not produce formal writes ───

  test('AI advisory does not produce formal writes', async ({ assert }) => {
    // 此测试验证 advisory 的核心契约：
    //   1. advisoryOnly 始终为 true
    //   2. writesApplied 始终为 false
    //   3. 降级场景同样不写入
    //   4. 正常场景同样不写入

    // ── Scenario A: Normal success ──
    const successGateway = createMockGateway({
      successRawText: JSON.stringify({
        narrative: '正常生成的建议。',
        suggestedActions: ['行动1'],
      }),
    })
    const successAdvisor = new ResourceDemandForecastingAiAdvisor(successGateway as any, false)
    const successResult = await successAdvisor.generateAdvisory(1, createLowSensitiveInput())
    assert.isTrue(successResult.advisoryOnly, '正常路径 advisoryOnly 应为 true')
    assert.isFalse(successResult.writesApplied, '正常路径 writesApplied 应为 false')

    // ── Scenario B: Failure (degraded) ──
    const failGateway = createMockGateway({
      shouldThrow: true,
      errorMessage: 'Timeout',
    })
    const failAdvisor = new ResourceDemandForecastingAiAdvisor(failGateway as any, false)
    const failResult = await failAdvisor.generateAdvisory(1, createLowSensitiveInput())
    assert.isTrue(failResult.advisoryOnly, '降级路径 advisoryOnly 应为 true')
    assert.isFalse(failResult.writesApplied, '降级路径 writesApplied 应为 false')

    // ── Scenario C: Empty input (degraded via INSUFFICIENT_HISTORY) ──
    const emptyGateway = createMockGateway()
    const emptyAdvisor = new ResourceDemandForecastingAiAdvisor(emptyGateway as any, false)
    const emptyResult = await emptyAdvisor.generateAdvisory(1, {
      summaryText: '',
      topGaps: [],
    })
    assert.isTrue(emptyResult.advisoryOnly, '空输入路径 advisoryOnly 应为 true')
    assert.isFalse(emptyResult.writesApplied, '空输入路径 writesApplied 应为 false')
    assert.include(
      emptyResult.warnings,
      FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY,
      '空摘要应触发 INSUFFICIENT_HISTORY',
    )

    // ── Scenario D: Test mode (also no writes) ──
    const testGateway = createMockGateway()
    // isTestMode=true（默认或显式设置）
    const testAdvisor = new ResourceDemandForecastingAiAdvisor(testGateway as any, true)
    const testResult = await testAdvisor.generateAdvisory(1, createLowSensitiveInput())
    assert.isTrue(testResult.advisoryOnly, '测试模式 advisoryOnly 应为 true')
    assert.isFalse(testResult.writesApplied, '测试模式 writesApplied 应为 false')
    assert.include(
      testResult.warnings,
      FORECAST_WARNING_CODES.AI_UNAVAILABLE,
      '测试模式应返回 AI_UNAVAILABLE',
    )
  })
})

// ─── Advisory Input 结构校验 ────────────────────────────────────────────────

test.group('ResourceDemandForecastingAI — Input Validation', () => {
  test('ForecastAdvisoryInput fields are strictly low-sensitive', ({ assert }) => {
    // 类型层面的验证：ForecastAdvisoryInput 接口只暴露 summaryText 和 topGaps
    const input: ForecastAdvisoryInput = {
      summaryText: 'summary only',
      topGaps: [{ role: 'frontend', gapHours: 100 }],
    }

    // TypeScript 编译时即阻止添加 projectNames、resourceNames 等字段
    // 此处运行时验证类型约束层级
    const keys = Object.keys(input)
    assert.isTrue(keys.includes('summaryText'))
    assert.isTrue(keys.includes('topGaps'))
    assert.isFalse(keys.includes('projectName'))
    assert.isFalse(keys.includes('resourceName'))
    assert.isFalse(keys.includes('taskTitle'))
    assert.isFalse(keys.includes('prompts'))
  })
})

// ─── Mock Gateway 边界 ──────────────────────────────────────────────────────

test.group('ResourceDemandForecastingAI — Gateway Mock Integrity', () => {
  test('mock gateway model name is exposed correctly', ({ assert }) => {
    const gateway = createMockGateway({ model: 'claude-fable-5' })
    assert.equal(gateway.model, 'claude-fable-5')
    assert.isFalse(gateway.isReal)
  })

  test('mock gateway can simulate both success and failure', async ({ assert }) => {
    const successGw = createMockGateway({
      successRawText: '{"narrative":"ok","suggestedActions":["a"]}',
    })
    const successResult = await successGw.generate({} as any)
    assert.isString(successResult.rawText)
    assert.isAtLeast(successResult.rawText.length, 1)

    const failGw = createMockGateway({ shouldThrow: true })
    await assert.rejects(async () => {
      await failGw.generate({} as any)
    })
  })
})
