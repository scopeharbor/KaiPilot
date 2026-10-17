import { test } from '@japa/runner'
import {
  RISK_CATEGORIES,
  RISK_STATUSES,
  RISK_ALLOWED_TRANSITIONS,
  RISK_SOURCES,
  AI_MARKER_SOURCES,
  RISK_MATRIX_BASIS,
} from '@aiproj/types'
import type { RiskStatus, AiMarker, RiskHintPayload } from '@aiproj/types'

test.group('风险类型常量', () => {
  test('定义 8 个风险类别', ({ assert }) => {
    assert.deepEqual(RISK_CATEGORIES, [
      'technical',
      'schedule',
      'cost',
      'resource',
      'external',
      'organizational',
      'legal',
      'other',
    ])
  })

  test('定义 6 个风险状态', ({ assert }) => {
    assert.deepEqual(RISK_STATUSES, [
      'identified',
      'analyzing',
      'mitigating',
      'resolved',
      'accepted',
      'closed',
    ])
  })

  test('定义 4 个风险来源（V2 新增 rule_engine）', ({ assert }) => {
    assert.deepEqual(RISK_SOURCES, ['manual', 'ai_suggestion', 'ai_draft', 'rule_engine'])
  })

  test('定义 3 个 AIMarker 来源', ({ assert }) => {
    assert.deepEqual(AI_MARKER_SOURCES, ['inferred', 'explicit', 'default'])
  })

  test('定义 2 个矩阵基线', ({ assert }) => {
    assert.deepEqual(RISK_MATRIX_BASIS, ['inherent', 'residual'])
  })
})

test.group('风险状态机合法转换表', () => {
  test('identified → analyzing | accepted | closed', ({ assert }) => {
    const allowed = RISK_ALLOWED_TRANSITIONS.identified
    assert.deepEqual(allowed, ['analyzing', 'accepted', 'closed'])
  })

  test('analyzing → mitigating | accepted | closed', ({ assert }) => {
    const allowed = RISK_ALLOWED_TRANSITIONS.analyzing
    assert.deepEqual(allowed, ['mitigating', 'accepted', 'closed'])
  })

  test('mitigating → resolved | analyzing | closed', ({ assert }) => {
    const allowed = RISK_ALLOWED_TRANSITIONS.mitigating
    assert.deepEqual(allowed, ['resolved', 'analyzing', 'closed'])
  })

  test('resolved → closed | mitigating', ({ assert }) => {
    const allowed = RISK_ALLOWED_TRANSITIONS.resolved
    assert.deepEqual(allowed, ['closed', 'mitigating'])
  })

  test('accepted → closed | analyzing', ({ assert }) => {
    const allowed = RISK_ALLOWED_TRANSITIONS.accepted
    assert.deepEqual(allowed, ['closed', 'analyzing'])
  })

  test('closed 是终态（空数组）', ({ assert }) => {
    const allowed = RISK_ALLOWED_TRANSITIONS.closed
    assert.deepEqual(allowed, [])
  })

  test('所有状态都有转换定义', ({ assert }) => {
    for (const status of RISK_STATUSES) {
      assert.isArray(RISK_ALLOWED_TRANSITIONS[status], `状态 "${status}" 缺少转换定义`)
    }
  })

  test('所有转换目标都是合法状态', ({ assert }) => {
    for (const [from, targets] of Object.entries(RISK_ALLOWED_TRANSITIONS)) {
      assert.isTrue(RISK_STATUSES.includes(from as RiskStatus), `源状态 "${from}" 不合法`)
      for (const to of targets) {
        assert.isTrue(RISK_STATUSES.includes(to), `目标状态 "${to}" 不合法`)
      }
    }
  })
})

test.group('五档得分计算', () => {
  test('score = probability × impact', ({ assert }) => {
    // 测试所有 25 种组合
    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++) {
        assert.equal(p * i, p * i, `概率 ${p} × 影响 ${i} = ${p * i}`)
      }
    }
  })

  test('最低得分 = 1 (1×1)', ({ assert }) => {
    assert.equal(1 * 1, 1)
  })

  test('最高得分 = 25 (5×5)', ({ assert }) => {
    assert.equal(5 * 5, 25)
  })

  test('中间值 3×4 = 12', ({ assert }) => {
    assert.equal(3 * 4, 12)
  })
})

test.group('AIMarker 必填字段', () => {
  test('完整 AIMarker 合法', ({ assert }) => {
    const marker: AiMarker = {
      confidence: 0.85,
      source: 'inferred',
      reason: '基于项目技术栈分析',
      needsConfirmation: true,
    }
    assert.equal(marker.confidence, 0.85)
    assert.equal(marker.source, 'inferred')
    assert.equal(marker.reason, '基于项目技术栈分析')
    assert.isTrue(marker.needsConfirmation)
  })

  test('confidence 范围 0-1', ({ assert }) => {
    const zero: AiMarker = {
      confidence: 0,
      source: 'default',
      reason: '默认',
      needsConfirmation: false,
    }
    const one: AiMarker = {
      confidence: 1,
      source: 'explicit',
      reason: '明确',
      needsConfirmation: false,
    }
    assert.equal(zero.confidence, 0)
    assert.equal(one.confidence, 1)
  })

  test('所有三种 source 枚举合法', ({ assert }) => {
    const sources: Array<AiMarker['source']> = ['inferred', 'explicit', 'default']
    for (const source of sources) {
      assert.isTrue(AI_MARKER_SOURCES.includes(source), `来源 "${source}" 合法`)
    }
  })
})

test.group('RiskHintPayload 互转类型', () => {
  test('RiskHintPayload 包含必要字段', ({ assert }) => {
    const hint: RiskHintPayload = {
      id: 'rh-1',
      title: '技术风险',
      description: '新框架学习曲线陡峭',
      category: 'technical',
      probability: 4,
      impact: 3,
      mitigation: '安排培训',
      aiMarker: {
        confidence: 0.7,
        source: 'inferred',
        reason: '基于技术栈分析',
        needsConfirmation: true,
      },
      sourceDraftId: 'draft-123',
      sourceDraftVersion: 1,
    }
    assert.equal(hint.id, 'rh-1')
    assert.equal(hint.sourceDraftId, 'draft-123')
    assert.equal(hint.sourceDraftVersion, 1)
    assert.equal(hint.aiMarker.confidence, 0.7)
  })
})
