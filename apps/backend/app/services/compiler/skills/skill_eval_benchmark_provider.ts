/**
 * v3-skill-eval-system —— Skill 评测基准 Provider（D4）。
 *
 * 提供 BenchmarkProvider 抽象接口 + L3BenchmarkProvider（消费四层底座 L3 Synthetic）
 * + FixtureBenchmarkProvider（确定性内置评测集，不联网）。
 *
 * 降级逻辑：底座未接线 / 无 L3 数据 / 向量库降级时回退 fixture，报告标注 benchmarkSource='fixture'。
 *
 * @aiproj/backend
 */

import type { BenchmarkInput, Skill } from '@aiproj/types'
import type { ActivationContext } from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════
// BenchmarkProvider 抽象接口
// ═══════════════════════════════════════════════════════════════════════

export interface BenchmarkProvider {
  /** Provider 名称，用于审计和 benchmarkSource 标注。 */
  readonly name: 'L3' | 'fixture'

  /**
   * 获取评测输入集。
   * @param skill 待评测的 Skill
   * @returns BenchmarkInput 数组
   */
  getInputs(skill: Skill): Promise<BenchmarkInput[]>

  /**
   * 检查 Provider 是否可用。
   * @returns true 表示 Provider 可用
   */
  isAvailable(): Promise<boolean>
}

// ═══════════════════════════════════════════════════════════════════════
// L3BenchmarkProvider
// ═══════════════════════════════════════════════════════════════════════

/**
 * L3 评测集 Provider —— 消费四层底座 L3 Synthetic。
 *
 * 通过 `query(layer=L3, evalContext=true)` 取合成测试案例。
 * 底座未接线、无 L3 数据或查询失败时降级。
 */
export class L3BenchmarkProvider implements BenchmarkProvider {
  readonly name = 'L3' as const

  constructor(
    private readonly knowledgeQuery?: (
      layer: string,
      evalContext: boolean,
      domain?: string,
      purpose?: string,
    ) => Promise<unknown[]>,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      if (!this.knowledgeQuery) return false
      const results = await this.knowledgeQuery('L3', true)
      return Array.isArray(results) && results.length > 0
    } catch {
      return false
    }
  }

  async getInputs(skill: Skill): Promise<BenchmarkInput[]> {
    if (!this.knowledgeQuery) return []

    try {
      const items = await this.knowledgeQuery('L3', true, skill.category.primary, 'eval')
      if (!Array.isArray(items) || items.length === 0) return []

      // 将 L3 Synthetic 条目转为 BenchmarkInput
      return items.map((item, index) => {
        const record = item as Record<string, unknown>
        return {
          label: `L3-${skill.skillKey}-${index}`,
          context: (record.context as ActivationContext) ?? { projectType: skill.category.primary },
          skills: [skill],
          expectedActivatedKeys: record.expectedActivatedKeys as string[] | undefined,
        }
      })
    } catch {
      return []
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FixtureBenchmarkProvider
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fixture 评测集 Provider —— 确定性内置评测集，不联网。
 *
 * 提供一组固定的评测输入，用于基准回归。
 */
export class FixtureBenchmarkProvider implements BenchmarkProvider {
  readonly name = 'fixture' as const

  async isAvailable(): Promise<boolean> {
    return true
  }

  async getInputs(skill: Skill): Promise<BenchmarkInput[]> {
    // 确定性 fixture 评测集：针对不同 Skill 分类提供基础回归案例
    const inputs: BenchmarkInput[] = [
      {
        label: `${skill.skillKey}-fixture-1`,
        context: { projectType: skill.category?.primary ?? 'software' },
        skills: [skill],
        expectedActivatedKeys: [skill.skillKey],
      },
      {
        label: `${skill.skillKey}-fixture-2`,
        context: {
          projectType: skill.category?.primary ?? 'software',
          manualSelections: [skill.skillKey],
        },
        skills: [skill],
        expectedActivatedKeys: [skill.skillKey],
      },
    ]

    return inputs
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Provider 降级工厂
// ═══════════════════════════════════════════════════════════════════════

/**
 * 获取可用的 BenchmarkProvider。
 *
 * 优先 L3 底座，底座未接线或无数据时降级到 fixture。
 *
 * @param knowledgeQuery L3 知识查询函数（可选，未提供则直降 fixture）
 * @returns 可用的 BenchmarkProvider
 */
export async function resolveBenchmarkProvider(
  knowledgeQuery?: (layer: string, evalContext: boolean) => Promise<unknown[]>,
): Promise<BenchmarkProvider> {
  if (knowledgeQuery) {
    const l3Provider = new L3BenchmarkProvider(knowledgeQuery)
    if (await l3Provider.isAvailable()) {
      return l3Provider
    }
  }

  return new FixtureBenchmarkProvider()
}
