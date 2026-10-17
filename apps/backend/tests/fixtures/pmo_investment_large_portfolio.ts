import type {
  InvestmentBasisFact,
  InvestmentProjectFact,
} from '#services/pmo_investment_distribution_service'

/**
 * PMO 投入分布大组织性能夹具（v3-pmo-investment-distribution §6.1）。
 *
 * 覆盖：多维度（项目类型/阶段/优先级/状态/负责人/部门/战略主题）、
 * 缺失来源（部分项目没有工时事实）、以及只有单一项目的低基数桶
 * （触发受限桶合并路径）。纯内存生成，不触库、不触网。
 */

export const LARGE_PORTFOLIO_PROJECT_COUNT = 1000

const CATEGORIES = ['delivery', 'research', 'ops', 'platform', 'compliance', 'growth']
const PHASES = ['discover', 'define', 'build', 'verify', 'run']
const PRIORITIES = ['critical', 'high', 'medium', 'low']
const STATUSES = ['active', 'planning', 'on_hold', 'completed']
const DEPARTMENTS = ['platform', 'ai', 'ops', 'delivery-east', 'delivery-west']
const THEMES = ['efficiency', 'expansion', 'compliance', 'quality']

export interface LargePortfolioFixture {
  projects: InvestmentProjectFact[]
  /** 只有 70% 项目有工时事实，用于验证缺失来源不会造数据。 */
  effortFacts: InvestmentBasisFact[]
  /** 只有 40% 项目有资源分配事实。 */
  allocationFacts: InvestmentBasisFact[]
}

export function buildLargePortfolioFixture(
  organizationId = 1,
  size = LARGE_PORTFOLIO_PROJECT_COUNT,
): LargePortfolioFixture {
  const projects: InvestmentProjectFact[] = []
  const effortFacts: InvestmentBasisFact[] = []
  const allocationFacts: InvestmentBasisFact[] = []

  for (let index = 0; index < size; index += 1) {
    const id = index + 1
    // 最后一个项目独占一个类型/部门，制造低基数桶
    const isSingleton = index === size - 1
    const dayOffset = index % 45

    projects.push({
      id,
      organizationId,
      name: `组合项目 ${id}`,
      category: isSingleton ? 'singleton-type' : CATEGORIES[index % CATEGORIES.length]!,
      status: STATUSES[index % STATUSES.length]!,
      priority: PRIORITIES[index % PRIORITIES.length]!,
      createdBy: 1000 + (index % 17),
      updatedAt: new Date(Date.UTC(2026, 6, 28) - dayOffset * 86_400_000).toISOString(),
      settings: {
        lifecyclePhase: PHASES[index % PHASES.length]!,
        department: isSingleton ? 'singleton-dept' : DEPARTMENTS[index % DEPARTMENTS.length]!,
        strategicTheme: THEMES[index % THEMES.length]!,
        managerLabel: `manager-${index % 23}`,
        trafficLightStatus: ['green', 'yellow', 'red'][index % 3]!,
      },
    })

    if (index % 10 < 7) {
      effortFacts.push({
        projectId: id,
        value: 8 + (index % 120),
        updatedAt: new Date(Date.UTC(2026, 6, 28) - dayOffset * 3_600_000).toISOString(),
      })
    }

    if (index % 10 < 4) {
      allocationFacts.push({
        projectId: id,
        value: 5 + (index % 60),
        updatedAt: new Date(Date.UTC(2026, 6, 28) - dayOffset * 3_600_000).toISOString(),
      })
    }
  }

  return { projects, effortFacts, allocationFacts }
}
