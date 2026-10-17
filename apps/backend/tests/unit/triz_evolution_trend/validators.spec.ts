import { test } from '@japa/runner'
import {
  createEvolutionTrendAnalysisValidator,
  listEvolutionTrendAnalysesValidator,
  listTrendScoresValidator,
  listTrendRisksValidator,
  historyComparisonValidator,
  reviewTrendRiskValidator,
  handoffPreviewValidator,
} from '#validators/triz_evolution_trend'

// ===========================================================================
// TRIZ 进化趋势分析 Vine 验证器测试（v3-triz-evolution-trend-analysis §5.2）
//
// 覆盖分页边界、sort/filter 白名单、scope 白名单、manual signal 大小限制、
// baseline id 校验、source hash 要求与非法枚举拒绝。
// ===========================================================================

async function fails(validator: { validate: (d: unknown) => Promise<unknown> }, data: unknown) {
  try {
    await validator.validate(data)
    return false
  } catch {
    return true
  }
}

test.group('createEvolutionTrendAnalysisValidator', () => {
  test('空请求体合法（全部字段可选）', async ({ assert }) => {
    const out = await createEvolutionTrendAnalysisValidator.validate({})
    assert.isObject(out)
  })

  test('接受合法的用户补充趋势信号', async ({ assert }) => {
    const out = await createEvolutionTrendAnalysisValidator.validate({
      scopeType: 'subsystem',
      manualTrendSignals: [
        {
          trendId: 'completeness',
          direction: 'declining',
          signal: '团队缺少 QA 角色',
          sourceNote: '用户补充',
        },
      ],
      userContext: '希望识别能力缺口',
      idempotencyKey: 'run-2026-08-01',
    })
    assert.equal(out.scopeType, 'subsystem')
    assert.lengthOf(out.manualTrendSignals!, 1)
  })

  test('manual signal 超过 50 条被拒绝', async ({ assert }) => {
    const one = { trendId: 'completeness' as const, direction: 'stable' as const, signal: '信号' }
    assert.isTrue(
      await fails(createEvolutionTrendAnalysisValidator, {
        manualTrendSignals: Array.from({ length: 51 }, () => one),
      }),
    )
  })

  test('signal 文本超 2000 字符被拒绝', async ({ assert }) => {
    assert.isTrue(
      await fails(createEvolutionTrendAnalysisValidator, {
        manualTrendSignals: [{ direction: 'stable', signal: 'x'.repeat(2001) }],
      }),
    )
  })

  test('非法 scopeType 被拒绝', async ({ assert }) => {
    assert.isTrue(
      await fails(createEvolutionTrendAnalysisValidator, { scopeType: 'invalid_scope' }),
    )
  })

  test('非法 trendId 在 manual signal 中被拒绝', async ({ assert }) => {
    assert.isTrue(
      await fails(createEvolutionTrendAnalysisValidator, {
        manualTrendSignals: [{ trendId: 'not_a_trend', direction: 'stable', signal: 'x' }],
      }),
    )
  })

  test('非法 direction 被拒绝', async ({ assert }) => {
    assert.isTrue(
      await fails(createEvolutionTrendAnalysisValidator, {
        manualTrendSignals: [{ direction: 'up', signal: 'x' }],
      }),
    )
  })
})

test.group('listEvolutionTrendAnalysesValidator', () => {
  test('空查询合法', async ({ assert }) => {
    const out = await listEvolutionTrendAnalysesValidator.validate({})
    assert.isObject(out)
  })

  test('合法分页与状态过滤通过', async ({ assert }) => {
    const out = await listEvolutionTrendAnalysesValidator.validate({
      page: 1,
      perPage: 50,
      status: 'completed_with_warnings',
      scopeType: 'project',
      sort: '-createdAt',
    })
    assert.equal(out.page, 1)
    assert.equal(out.status, 'completed_with_warnings')
  })

  test('page 小于 1 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(listEvolutionTrendAnalysesValidator, { page: 0 }))
  })

  test('perPage 超过 100 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(listEvolutionTrendAnalysesValidator, { perPage: 101 }))
  })

  test('非法 status 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(listEvolutionTrendAnalysesValidator, { status: 'running' }))
  })

  test('非法 scopeType 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(listEvolutionTrendAnalysesValidator, { scopeType: 'team' }))
  })
})

test.group('listTrendScoresValidator', () => {
  test('合法 trendId 与 severity 过滤通过', async ({ assert }) => {
    const out = await listTrendScoresValidator.validate({
      trendId: 'completeness',
      severity: 'critical',
      sort: '+severity',
    })
    assert.equal(out.trendId, 'completeness')
    assert.equal(out.severity, 'critical')
  })

  test('非法 trendId 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(listTrendScoresValidator, { trendId: 'bogus' }))
  })

  test('非法 severity 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(listTrendScoresValidator, { severity: 'urgent' }))
  })

  test('perPage 超过 50 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(listTrendScoresValidator, { perPage: 51 }))
  })
})

test.group('listTrendRisksValidator', () => {
  test('合法 status/riskType/trendId/severity/stale 过滤通过', async ({ assert }) => {
    const out = await listTrendRisksValidator.validate({
      status: 'unreviewed',
      riskType: 'role_gap',
      trendId: 'completeness',
      severity: 'high',
      stale: true,
    })
    assert.equal(out.riskType, 'role_gap')
    assert.equal(out.stale, true)
  })

  test('非法 riskType 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(listTrendRisksValidator, { riskType: 'unknown_risk' }))
  })

  test('非法 status 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(listTrendRisksValidator, { status: 'pending' }))
  })

  test('stale 必须是布尔', async ({ assert }) => {
    assert.isTrue(await fails(listTrendRisksValidator, { stale: 'yes' }))
  })
})

test.group('historyComparisonValidator', () => {
  test('空查询合法（最近一次基线）', async ({ assert }) => {
    const out = await historyComparisonValidator.validate({})
    assert.isUndefined(out.baselineRunId)
  })

  test('合法 baselineRunId 通过', async ({ assert }) => {
    const out = await historyComparisonValidator.validate({ baselineRunId: 5 })
    assert.equal(out.baselineRunId, 5)
  })

  test('baselineRunId 小于 1 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(historyComparisonValidator, { baselineRunId: 0 }))
  })
})

test.group('reviewTrendRiskValidator', () => {
  test('合法 action 通过', async ({ assert }) => {
    for (const action of ['mark_reviewed', 'mark_unreviewed', 'dismiss'] as const) {
      const out = await reviewTrendRiskValidator.validate({ action })
      assert.equal(out.action, action)
    }
  })

  test('非法 action 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(reviewTrendRiskValidator, { action: 'approve' }))
  })

  test('reason 超过 2000 字符被拒绝', async ({ assert }) => {
    assert.isTrue(
      await fails(reviewTrendRiskValidator, { action: 'dismiss', reason: 'x'.repeat(2001) }),
    )
  })
})

test.group('handoffPreviewValidator', () => {
  test('空请求体合法（currentSourceHashes 可选）', async ({ assert }) => {
    const out = await handoffPreviewValidator.validate({})
    assert.isObject(out)
  })

  test('接受合法的 currentSourceHashes', async ({ assert }) => {
    const out = await handoffPreviewValidator.validate({
      currentSourceHashes: { tasks_wbs: 'abc', members: 'def' },
    })
    assert.deepEqual(out.currentSourceHashes, { tasks_wbs: 'abc', members: 'def' })
  })

  test('currentSourceHashes 值必须为字符串', async ({ assert }) => {
    assert.isTrue(
      await fails(handoffPreviewValidator, {
        currentSourceHashes: { tasks_wbs: 123 },
      }),
    )
  })
})
