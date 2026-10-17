/**
 * v3-copilot-skill-injection — L3 排除（红线 1）单元测试（§4）。
 *
 * 覆盖：
 * - §4.2 负例：含 L3 条目的 Skill fixture，断言该条目被拒且不进切面
 * - §4.3 含 L3 的 Skill 不导致整个切面失败（只剔除违规条目并记录）
 * - §4.5 eval 查询路径下 L3 允许、生产路径下 L3 拒绝两条分支
 */
import { describe, it, expect } from 'vitest'
import {
  COPILOT_PRODUCTION_KNOWLEDGE_TIERS,
  COPILOT_EVAL_KNOWLEDGE_TIERS,
  assertEligibleKnowledgeTiersExcludeL3,
  knowledgeTiersIncludeSynthetic,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 辅助：模拟装配服务 Step 5 的 L3 过滤逻辑
// ---------------------------------------------------------------------------

interface GuidanceItem {
  itemId: string
  skillKey: string
  label: string
  summary: string
  sourceRef: string
  knowledgeRef?: string
  activationRuleId: string
  activationReason: string
  knowledgeTier?: string
}

interface FilterResult {
  kept: GuidanceItem[]
  excludedCount: number
  excludedTiers: string[]
}

/**
 * 模拟装配服务 Step 5 的 L3 过滤逻辑（与 copilot_context_assembly_service.ts 一致）。
 */
function filterL3Items(
  items: readonly GuidanceItem[],
  queryPath: 'production' | 'eval',
): FilterResult {
  if (queryPath !== 'production') {
    return { kept: [...items], excludedCount: 0, excludedTiers: [] }
  }

  const kept: GuidanceItem[] = []
  let excludedCount = 0
  const excludedTiers: string[] = []

  for (const item of items) {
    if (item.knowledgeTier === 'L3') {
      excludedCount++
      if (!excludedTiers.includes('L3')) {
        excludedTiers.push('L3')
      }
    } else {
      kept.push(item)
    }
  }

  return { kept, excludedCount, excludedTiers }
}

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

function makeGuidanceItem(overrides: Partial<GuidanceItem> = {}): GuidanceItem {
  return {
    itemId: overrides.itemId ?? 'skill-1:rules:0',
    skillKey: overrides.skillKey ?? 'test-skill',
    label: overrides.label ?? '测试规则',
    summary: overrides.summary ?? '测试规则描述',
    sourceRef: overrides.sourceRef ?? 'skill:test-skill:v1.0.0:rules:0',
    activationRuleId: overrides.activationRuleId ?? 'test-skill.activation',
    activationReason: overrides.activationReason ?? 'auto: 项目级匹配',
    knowledgeTier: overrides.knowledgeTier,
  }
}

// ---------------------------------------------------------------------------
// §4.2 负例：含 L3 条目的 Skill fixture，断言该条目被拒且不进切面
// ---------------------------------------------------------------------------

describe('§4.2 L3 条目被拒且不进切面', () => {
  it('生产路径下，knowledgeTier=L3 的条目被过滤掉', () => {
    const items = [
      makeGuidanceItem({ itemId: 'l1-item', knowledgeTier: 'L1' }),
      makeGuidanceItem({ itemId: 'l3-item', knowledgeTier: 'L3' }),
      makeGuidanceItem({ itemId: 'l2-item', knowledgeTier: 'L2' }),
    ]

    const result = filterL3Items(items, 'production')

    expect(result.kept).toHaveLength(2)
    expect(result.kept.map((i) => i.itemId)).toEqual(['l1-item', 'l2-item'])
    expect(result.excludedCount).toBe(1)
  })

  it('L3 条目不出现在返回的 guidanceItems 中', () => {
    const items = [makeGuidanceItem({ itemId: 'only-l3', knowledgeTier: 'L3' })]

    const result = filterL3Items(items, 'production')

    expect(result.kept).toHaveLength(0)
    expect(result.kept.some((i) => i.knowledgeTier === 'L3')).toBe(false)
  })

  it('无 knowledgeTier 的条目不被过滤（保守放行）', () => {
    const items = [
      makeGuidanceItem({ itemId: 'no-tier' }), // knowledgeTier = undefined
    ]

    const result = filterL3Items(items, 'production')

    expect(result.kept).toHaveLength(1)
    expect(result.kept[0]!.itemId).toBe('no-tier')
  })
})

// ---------------------------------------------------------------------------
// §4.3 含 L3 的 Skill 不导致整个切面失败（只剔除违规条目并记录）
// ---------------------------------------------------------------------------

describe('§4.3 L3 条目不导致切面失败', () => {
  it('混合 L1/L2/L3/L4 条目时，只剔除 L3，其余保留', () => {
    const items = [
      makeGuidanceItem({ itemId: 'l1', knowledgeTier: 'L1' }),
      makeGuidanceItem({ itemId: 'l2', knowledgeTier: 'L2' }),
      makeGuidanceItem({ itemId: 'l3-a', knowledgeTier: 'L3' }),
      makeGuidanceItem({ itemId: 'l4', knowledgeTier: 'L4' }),
      makeGuidanceItem({ itemId: 'l3-b', knowledgeTier: 'L3' }),
    ]

    const result = filterL3Items(items, 'production')

    expect(result.kept).toHaveLength(3)
    expect(result.kept.map((i) => i.itemId)).toEqual(['l1', 'l2', 'l4'])
    expect(result.excludedCount).toBe(2)
  })

  it('全部为 L3 时，切面为空但不报错', () => {
    const items = [
      makeGuidanceItem({ itemId: 'l3-1', knowledgeTier: 'L3' }),
      makeGuidanceItem({ itemId: 'l3-2', knowledgeTier: 'L3' }),
    ]

    const result = filterL3Items(items, 'production')

    expect(result.kept).toHaveLength(0)
    expect(result.excludedCount).toBe(2)
    // 不抛错 = 切面不失败
  })

  it('零条目时正常返回空结果', () => {
    const result = filterL3Items([], 'production')
    expect(result.kept).toHaveLength(0)
    expect(result.excludedCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// §4.5 eval 查询路径下 L3 允许、生产路径下 L3 拒绝
// ---------------------------------------------------------------------------

describe('§4.5 eval vs production 查询路径分支', () => {
  it('eval 路径下 L3 条目不被过滤', () => {
    const items = [
      makeGuidanceItem({ itemId: 'l1', knowledgeTier: 'L1' }),
      makeGuidanceItem({ itemId: 'l3', knowledgeTier: 'L3' }),
    ]

    const result = filterL3Items(items, 'eval')

    expect(result.kept).toHaveLength(2)
    expect(result.excludedCount).toBe(0)
    expect(result.kept.map((i) => i.itemId)).toEqual(['l1', 'l3'])
  })

  it('production 路径下 L3 条目被过滤', () => {
    const items = [
      makeGuidanceItem({ itemId: 'l1', knowledgeTier: 'L1' }),
      makeGuidanceItem({ itemId: 'l3', knowledgeTier: 'L3' }),
    ]

    const result = filterL3Items(items, 'production')

    expect(result.kept).toHaveLength(1)
    expect(result.kept[0]!.itemId).toBe('l1')
    expect(result.excludedCount).toBe(1)
  })

  it('生产路径合格层不含 L3（类型级断言）', () => {
    expect(COPILOT_PRODUCTION_KNOWLEDGE_TIERS).not.toContain('L3')
    expect(assertEligibleKnowledgeTiersExcludeL3(COPILOT_PRODUCTION_KNOWLEDGE_TIERS).ok).toBe(true)
  })

  it('eval 路径合格层含 L3（类型级断言）', () => {
    expect(COPILOT_EVAL_KNOWLEDGE_TIERS).toContain('L3')
    expect(knowledgeTiersIncludeSynthetic(COPILOT_EVAL_KNOWLEDGE_TIERS)).toBe(true)
    expect(assertEligibleKnowledgeTiersExcludeL3(COPILOT_EVAL_KNOWLEDGE_TIERS).ok).toBe(false)
  })

  it('L4 条目在两条路径下都不被过滤', () => {
    const items = [makeGuidanceItem({ itemId: 'l4', knowledgeTier: 'L4' })]

    const prodResult = filterL3Items(items, 'production')
    const evalResult = filterL3Items(items, 'eval')

    expect(prodResult.kept).toHaveLength(1)
    expect(evalResult.kept).toHaveLength(1)
  })
})
