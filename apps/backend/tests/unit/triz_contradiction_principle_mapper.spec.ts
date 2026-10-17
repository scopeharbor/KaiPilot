import PrincipleSuggestionMapper from '#services/triz_contradiction/principle_mapper'
import { test } from '@japa/runner'
import type { CandidateContradiction } from '@aiproj/types'

function tech(
  improving: CandidateContradiction['improvingParameterKey'],
  worsening: CandidateContradiction['worseningParameterKey'],
): CandidateContradiction {
  return {
    type: 'technical',
    ruleId: 'CD-001',
    severity: 'high',
    confidence: 0.8,
    improvingParameterKey: improving,
    worseningParameterKey: worsening,
    improvingDirection: '改善',
    worseningDirection: '恶化',
    parameterKey: null,
    requirementA: null,
    requirementB: null,
    title: '测试矛盾',
    evidence: [],
    affectedScope: [],
  }
}

test.group('V2 TRIZ PrincipleSuggestionMapper', () => {
  const mapper = new PrincipleSuggestionMapper()

  test('技术矛盾 duration>cost → segmentation 相关度最高', ({ assert }) => {
    const suggestions = mapper.suggestPrinciples(tech('duration', 'cost'))
    assert.isTrue(suggestions.length > 0)
    assert.equal(suggestions[0].principleId, 'segmentation')
    // 相关度降序
    for (let i = 1; i < suggestions.length; i++) {
      assert.isTrue(suggestions[i - 1].relevance >= suggestions[i].relevance)
    }
  })

  test('每条建议携带中文名与项目落地建议', ({ assert }) => {
    const suggestions = mapper.suggestPrinciples(tech('scope', 'duration'))
    for (const s of suggestions) {
      assert.isTrue(s.name.length > 0)
      assert.isTrue(s.advice.length > 0)
    }
  })

  test('物理矛盾走分离原理通用集，segmentation 相关度最高', ({ assert }) => {
    const physical: CandidateContradiction = {
      ...tech(null, null),
      type: 'physical',
      ruleId: 'CD-006',
      parameterKey: 'scope',
      requirementA: '范围要全',
      requirementB: '交付要快',
    }
    const suggestions = mapper.suggestPrinciples(physical)
    assert.isTrue(suggestions.length > 0)
    assert.equal(suggestions[0].principleId, 'segmentation')
  })

  test('精确对未命中时按恶化参数降级回退', ({ assert }) => {
    // quality>quality 精确对不在表中 → 走 quality 恶化回退
    const suggestions = mapper.suggestPrinciples(tech('quality', 'quality'))
    assert.isTrue(suggestions.length > 0)
    assert.isTrue(suggestions.every((s) => s.relevance > 0))
  })

  test('无参数/目录外 improving 时返回空数组', ({ assert }) => {
    const noParams: CandidateContradiction = {
      ...tech(null, null),
      type: 'technical',
    }
    const suggestions = mapper.suggestPrinciples(noParams)
    assert.equal(suggestions.length, 0)
  })

  test('建议最多 5 条且按相关度稳定排序', ({ assert }) => {
    const suggestions = mapper.suggestPrinciples(tech('duration', 'cost'))
    assert.isTrue(suggestions.length <= 5)
    // 相同相关度时按 principleId 字典序
    for (let i = 1; i < suggestions.length; i++) {
      const prev = suggestions[i - 1]
      const cur = suggestions[i]
      if (Math.abs(prev.relevance - cur.relevance) <= 1e-9) {
        assert.isTrue(prev.principleId.localeCompare(cur.principleId) <= 0)
      } else {
        assert.isTrue(prev.relevance > cur.relevance)
      }
    }
  })

  test('确定性：同输入同输出', ({ assert }) => {
    const c = tech('risk_level', 'cost')
    const a = mapper.suggestPrinciples(c)
    const b = mapper.suggestPrinciples(structuredClone(c))
    assert.deepEqual(a, b)
  })
})
