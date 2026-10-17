/**
 * @aiproj/backend —— Evaluation Profiles：Soft Evaluator 触发与配置。
 *
 * 定义 6 个 evaluation profile，按 V-Gate 关卡控制维度子集、权重、阈值和预算。
 * 禁止默认每个 Stage 全量执行 17 维。
 *
 * Profiles:
 * - requirements_gate：需求阶段→范围/目标维度
 * - blueprint_gate：蓝图阶段→范围/目标+风险+沟通维度
 * - wbs_gate：WBS 阶段→WBS+交付物+风险+范围维度
 * - schedule_gate：排期阶段→进度资源+交付物+部分 WBS 维度
 * - resource_gate：资源阶段→进度资源维度
 * - global_sample：全局采样→全维度子集（低预算）
 */

import { SE_DIMENSION_IDS } from '@aiproj/compiler-spec'
import type { SeDimensionEntry } from './se_dimension_registry.js'
import { type SeDimensionRegistry } from './se_dimension_registry.js'

// ── Profile Definition ──

export interface EvaluationProfile {
  profileId: string
  name: string
  dimensionIds: string[]
  weightOverrides: Record<string, number>
  thresholdOverrides: Record<string, number>
  budgetTokens: number
  budgetCalls: number
  maxRetriesPerDimension: number
  enabledByDefault: boolean
  description: string
}

// ── Default Profiles ──

const DEFAULT_PROFILES: EvaluationProfile[] = [
  {
    profileId: 'requirements_gate',
    name: '需求阶段评估',
    dimensionIds: [
      SE_DIMENSION_IDS.SE_ST_01, // 范围完整性
      SE_DIMENSION_IDS.SE_ST_02, // 目标一致性
      SE_DIMENSION_IDS.SE_ST_03, // 约束可满足性
    ],
    weightOverrides: {
      [SE_DIMENSION_IDS.SE_ST_01]: 0.5,
      [SE_DIMENSION_IDS.SE_ST_02]: 0.3,
      [SE_DIMENSION_IDS.SE_ST_03]: 0.2,
    },
    thresholdOverrides: {},
    budgetTokens: 30000,
    budgetCalls: 3,
    maxRetriesPerDimension: 200,
    enabledByDefault: false,
    description: '需求阶段：评估范围完整性和目标一致性',
  },
  {
    profileId: 'blueprint_gate',
    name: '蓝图阶段评估',
    dimensionIds: [
      SE_DIMENSION_IDS.SE_ST_01, // 范围完整性
      SE_DIMENSION_IDS.SE_ST_02, // 目标一致性
      SE_DIMENSION_IDS.SE_ST_03, // 约束可满足性
      SE_DIMENSION_IDS.SE_DEL_01, // 交付物可验证性
      SE_DIMENSION_IDS.SE_RISK_01, // 风险识别充分性
      SE_DIMENSION_IDS.SE_RISK_02, // 风险缓解措施可行
      SE_DIMENSION_IDS.SE_RISK_03, // 风险概率影响一致
      SE_DIMENSION_IDS.SE_COMM_01, // 干系人覆盖完整
      SE_DIMENSION_IDS.SE_COMM_02, // 沟通频率适当
    ],
    weightOverrides: {},
    thresholdOverrides: {},
    budgetTokens: 80000,
    budgetCalls: 9,
    maxRetriesPerDimension: 200,
    enabledByDefault: true,
    description: '蓝图阶段：评估范围、交付物、风险、沟通维度',
  },
  {
    profileId: 'wbs_gate',
    name: 'WBS 阶段评估',
    dimensionIds: [
      SE_DIMENSION_IDS.SE_WBS_01, // WBS 分解完整性
      SE_DIMENSION_IDS.SE_WBS_02, // 任务粒度合理性
      SE_DIMENSION_IDS.SE_WBS_03, // 层级深度适当
      SE_DIMENSION_IDS.SE_DEL_01, // 交付物可验证性
      SE_DIMENSION_IDS.SE_DEL_02, // 验收标准可度量
      SE_DIMENSION_IDS.SE_DEL_03, // 交付物依赖明确
      SE_DIMENSION_IDS.SE_RISK_01, // 风险识别充分性
      SE_DIMENSION_IDS.SE_ST_01, // 范围完整性
      SE_DIMENSION_IDS.SE_ST_02, // 目标一致性
    ],
    weightOverrides: {
      [SE_DIMENSION_IDS.SE_WBS_01]: 0.2,
      [SE_DIMENSION_IDS.SE_WBS_02]: 0.15,
      [SE_DIMENSION_IDS.SE_WBS_03]: 0.1,
      [SE_DIMENSION_IDS.SE_DEL_01]: 0.2,
      [SE_DIMENSION_IDS.SE_DEL_02]: 0.1,
      [SE_DIMENSION_IDS.SE_DEL_03]: 0.1,
      [SE_DIMENSION_IDS.SE_RISK_01]: 0.05,
      [SE_DIMENSION_IDS.SE_ST_01]: 0.05,
      [SE_DIMENSION_IDS.SE_ST_02]: 0.05,
    },
    thresholdOverrides: {
      [SE_DIMENSION_IDS.SE_WBS_01]: 3,
      [SE_DIMENSION_IDS.SE_DEL_01]: 3,
    },
    budgetTokens: 80000,
    budgetCalls: 9,
    maxRetriesPerDimension: 200,
    enabledByDefault: true,
    description: 'WBS 阶段：评估 WBS 分解质量、交付物质量和范围',
  },
  {
    profileId: 'schedule_gate',
    name: '排期阶段评估',
    dimensionIds: [
      SE_DIMENSION_IDS.SE_PR_01, // 进度计划可信度
      SE_DIMENSION_IDS.SE_PR_03, // 里程碑可达性
      SE_DIMENSION_IDS.SE_DEL_03, // 交付物依赖明确
      SE_DIMENSION_IDS.SE_WBS_02, // 任务粒度合理性（辅助）
    ],
    weightOverrides: {
      [SE_DIMENSION_IDS.SE_PR_01]: 0.4,
      [SE_DIMENSION_IDS.SE_PR_03]: 0.3,
      [SE_DIMENSION_IDS.SE_DEL_03]: 0.2,
      [SE_DIMENSION_IDS.SE_WBS_02]: 0.1,
    },
    thresholdOverrides: {},
    budgetTokens: 40000,
    budgetCalls: 4,
    maxRetriesPerDimension: 200,
    enabledByDefault: true,
    description: '排期阶段：评估进度计划可信度和里程碑可达性',
  },
  {
    profileId: 'resource_gate',
    name: '资源阶段评估',
    dimensionIds: [
      SE_DIMENSION_IDS.SE_PR_02, // 资源分配合理性
    ],
    weightOverrides: {},
    thresholdOverrides: {},
    budgetTokens: 15000,
    budgetCalls: 1,
    maxRetriesPerDimension: 200,
    enabledByDefault: false,
    description: '资源阶段：评估资源分配合理性',
  },
  {
    profileId: 'global_sample',
    name: '全局采样评估',
    dimensionIds: [
      SE_DIMENSION_IDS.SE_WBS_01,
      SE_DIMENSION_IDS.SE_WBS_02,
      SE_DIMENSION_IDS.SE_DEL_01,
      SE_DIMENSION_IDS.SE_RISK_01,
      SE_DIMENSION_IDS.SE_PR_01,
      SE_DIMENSION_IDS.SE_ST_01,
      SE_DIMENSION_IDS.SE_COMM_01,
    ],
    weightOverrides: {},
    thresholdOverrides: {},
    budgetTokens: 50000,
    budgetCalls: 7,
    maxRetriesPerDimension: 200,
    enabledByDefault: false,
    description: '全局采样：跨分组选代表性维度，不做全量 17 维',
  },
]

// ── Profile Service ──

/**
 * Evaluation Profile 服务。
 * 管理 profile 到维度子集的映射、权重、阈值和预算解析。
 */
export class EvaluationProfileService {
  readonly #profiles: Map<string, EvaluationProfile> = new Map()
  readonly #dimensionRegistry: SeDimensionRegistry

  constructor(dimensionRegistry: SeDimensionRegistry) {
    this.#dimensionRegistry = dimensionRegistry
    this.#loadDefaults()
  }

  /** 获取 profile。 */
  getProfile(profileId: string): EvaluationProfile | undefined {
    return this.#profiles.get(profileId)
  }

  /** 获取 profile 的维度列表（含权重覆盖和阈值覆盖）。 */
  resolveDimensions(profileId: string): {
    dimensions: SeDimensionEntry[]
    weights: Record<string, number>
    thresholds: Record<string, number>
  } {
    const profile = this.#profiles.get(profileId)
    if (!profile) {
      return { dimensions: [], weights: {}, thresholds: {} }
    }

    const dimensions = profile.dimensionIds
      .map((did) => this.#dimensionRegistry.getDimension(did))
      .filter((d): d is SeDimensionEntry => d !== undefined)

    // 权重：先按 profile weightOverrides，再按注册表默认权重
    const weights: Record<string, number> = {}
    for (const dim of dimensions) {
      weights[dim.dimensionId] = profile.weightOverrides[dim.dimensionId] ?? dim.weight
    }

    // 阈值：先按 profile thresholdOverrides，再按注册表默认阈值
    const thresholds: Record<string, number> = {}
    for (const dim of dimensions) {
      thresholds[dim.dimensionId] =
        profile.thresholdOverrides[dim.dimensionId] ?? dim.defaultThreshold
    }

    return { dimensions, weights, thresholds }
  }

  /** 获取所有 profile。 */
  getAllProfiles(): EvaluationProfile[] {
    return Array.from(this.#profiles.values())
  }

  /** 注册自定义 profile。 */
  registerProfile(profile: EvaluationProfile): void {
    this.#profiles.set(profile.profileId, profile)
  }

  #loadDefaults(): void {
    for (const p of DEFAULT_PROFILES) {
      this.#profiles.set(p.profileId, p)
    }
  }
}
