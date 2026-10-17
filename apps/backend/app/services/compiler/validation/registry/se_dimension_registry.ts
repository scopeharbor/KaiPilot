/**
 * @aiproj/backend —— Soft Evaluator 维度注册表（SE-WBS-01~SE-COMM-02，共 17 维）。
 *
 * 保留 V2/V3 资料包中的 17 个维度定义，每个维度包含：
 * - dimensionId：规范 ID
 * - name：名称
 * - group：分组（wbs / deliverable / risk / progress_resource / scope_target / communication）
 * - weight：组内权重
 * - rubric：1-5 分制的评分标准
 * - inputSliceSchema：输入片段描述
 * - applicableProfiles：适用的 V-Gate profile
 * - defaultThreshold：默认评分阈值
 * - deterministicSignals：可注入的确定性信号
 */

import { SE_DIMENSION_IDS } from '@aiproj/compiler-spec'
import type { SoftDimensionGroup } from '@aiproj/compiler-spec'

// ── Dimension Entry ──

export interface SeDimensionEntry {
  dimensionId: string
  name: string
  group: SoftDimensionGroup
  weight: number
  rubric: { score: number; description: string; criteria: string[] }[]
  inputSliceSchema: string
  applicableProfiles: string[]
  defaultThreshold: number
  deterministicSignals: string[]
}

// ── Default Registry ──

const DEFAULT_DIMENSIONS: SeDimensionEntry[] = [
  // ── WBS（3 dimensions）──
  {
    dimensionId: SE_DIMENSION_IDS.SE_WBS_01,
    name: 'WBS 分解完整性',
    group: 'wbs',
    weight: 0.4,
    rubric: [
      {
        score: 1,
        description: 'WBS 严重不完整，缺少关键工作包',
        criteria: ['missing > 50% workstreams'],
      },
      { score: 2, description: '部分工作包缺失或不清晰', criteria: ['missing 20-50% workstreams'] },
      {
        score: 3,
        description: 'WBS 基本完整，少量可优化',
        criteria: ['all major workstreams present'],
      },
      { score: 4, description: 'WBS 较完整，层级清晰', criteria: ['full coverage, minor gaps'] },
      { score: 5, description: 'WBS 完整无缺，结构合理', criteria: ['all levels complete'] },
    ],
    inputSliceSchema: 'WBS 层级树、workstream 列表、work_package 列表',
    applicableProfiles: ['wbs_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['workstream_count', 'wp_count', 'hierarchy_depth'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_WBS_02,
    name: '任务粒度合理性',
    group: 'wbs',
    weight: 0.3,
    rubric: [
      { score: 1, description: '任务粒度过粗或过细', criteria: ['avg L2 task > 4 weeks'] },
      { score: 2, description: '多数任务粒度不适当', criteria: ['多数 L2 > 3 weeks'] },
      { score: 3, description: '任务粒度基本合理', criteria: ['多数 L2 1-3 weeks'] },
      { score: 4, description: '任务粒度合理', criteria: ['L2 tasks 1-2 weeks average'] },
      { score: 5, description: '任务粒度非常合理', criteria: ['all L2 < 2 weeks'] },
    ],
    inputSliceSchema: '任务列表、duration、层级、依赖数量',
    applicableProfiles: ['wbs_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['avg_task_duration', 'long_task_count', 'child_distribution'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_WBS_03,
    name: '层级深度适当',
    group: 'wbs',
    weight: 0.3,
    rubric: [
      { score: 1, description: 'WBS 层级深度严重不当', criteria: ['depth > 7 or < 2'] },
      { score: 2, description: '层级深度需调整', criteria: ['depth > 5'] },
      { score: 3, description: '层级深度基本合理', criteria: ['depth 3-4'] },
      { score: 4, description: '层级深度合理', criteria: ['depth 3, balanced'] },
      { score: 5, description: '层级深度非常合理', criteria: ['depth 3, well balanced'] },
    ],
    inputSliceSchema: 'WBS 层级深度统计',
    applicableProfiles: ['wbs_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['max_depth', 'depth_distribution', 'workstream_depth'],
  },

  // ── Deliverable（3 dimensions）──
  {
    dimensionId: SE_DIMENSION_IDS.SE_DEL_01,
    name: '交付物可验证性',
    group: 'deliverable',
    weight: 0.4,
    rubric: [
      { score: 1, description: '交付物定义模糊不可验证', criteria: ['无明确交付物'] },
      { score: 2, description: '部分交付物定义清晰', criteria: ['< 50% deliverables clear'] },
      { score: 3, description: '多数交付物可验证', criteria: ['50-70% deliverables clear'] },
      { score: 4, description: '大部分交付物可验证', criteria: ['70-90% deliverables clear'] },
      { score: 5, description: '所有交付物明确定义', criteria: ['all deliverables clear'] },
    ],
    inputSliceSchema: '交付物列表、验收标准、完成条件',
    applicableProfiles: ['wbs_gate', 'blueprint_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['deliverable_count', 'ac_criteria_count'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_DEL_02,
    name: '验收标准可度量',
    group: 'deliverable',
    weight: 0.3,
    rubric: [
      { score: 1, description: '验收标准主观不可度量', criteria: ['all criteria subjective'] },
      { score: 2, description: '大部分验收标准主观', criteria: ['> 50% subjective'] },
      { score: 3, description: '部分验收标准可度量', criteria: ['some quantitative criteria'] },
      { score: 4, description: '多数验收标准可度量', criteria: ['> 70% quantitative'] },
      { score: 5, description: '所有验收标准可度量', criteria: ['all criteria measurable'] },
    ],
    inputSliceSchema: '验收标准列表、描述',
    applicableProfiles: ['wbs_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['ac_quantitative_ratio'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_DEL_03,
    name: '交付物依赖明确',
    group: 'deliverable',
    weight: 0.3,
    rubric: [
      { score: 1, description: '交付物依赖链不明确', criteria: ['no dependencies documented'] },
      { score: 2, description: '部分依赖明确', criteria: ['< 50% dependencies clear'] },
      { score: 3, description: '多数依赖明确', criteria: ['50-70% clear'] },
      { score: 4, description: '大部分依赖明确', criteria: ['70-90% clear'] },
      { score: 5, description: '所有依赖清晰定义', criteria: ['all dependencies defined'] },
    ],
    inputSliceSchema: '交付物依赖链、前后置关系',
    applicableProfiles: ['wbs_gate', 'schedule_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['dependency_count_per_deliverable'],
  },

  // ── Risk（3 dimensions）──
  {
    dimensionId: SE_DIMENSION_IDS.SE_RISK_01,
    name: '风险识别充分性',
    group: 'risk',
    weight: 0.4,
    rubric: [
      { score: 1, description: '风险登记册严重不足', criteria: ['no or 1-2 risks'] },
      { score: 2, description: '风险识别不充分', criteria: ['只覆盖主要风险'] },
      { score: 3, description: '风险识别基本充分', criteria: ['覆盖项目主要风险'] },
      { score: 4, description: '风险识别较充分', criteria: ['覆盖多数可预见风险'] },
      { score: 5, description: '风险识别充分', criteria: ['全面覆盖项目风险'] },
    ],
    inputSliceSchema: '风险登记册列表、分类',
    applicableProfiles: ['blueprint_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['risk_count', 'risk_category_coverage'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_RISK_02,
    name: '风险缓解措施可行',
    group: 'risk',
    weight: 0.3,
    rubric: [
      { score: 1, description: '无缓解措施', criteria: ['all risks without mitigation'] },
      { score: 2, description: '少数缓解措施可行', criteria: ['< 30% have mitigation'] },
      { score: 3, description: '部分缓解措施可行', criteria: ['30-60% have mitigation'] },
      { score: 4, description: '多数缓解措施可行', criteria: ['60-90% have mitigation'] },
      { score: 5, description: '所有风险有可行缓解方案', criteria: ['all risks have mitigations'] },
    ],
    inputSliceSchema: '风险缓解措施描述',
    applicableProfiles: ['blueprint_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['mitigation_ratio'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_RISK_03,
    name: '风险概率影响一致',
    group: 'risk',
    weight: 0.3,
    rubric: [
      { score: 1, description: '风险概率影响评分不一致', criteria: ['多数评分矛盾'] },
      { score: 2, description: '部分一致性差', criteria: ['> 30% inconsistent'] },
      { score: 3, description: '基本一致', criteria: ['多数概率影响匹配'] },
      { score: 4, description: '一致性较好', criteria: ['评分矩阵较协调'] },
      { score: 5, description: '一致性非常好', criteria: ['评分矩阵协调一致'] },
    ],
    inputSliceSchema: '风险概率、影响评分矩阵',
    applicableProfiles: ['blueprint_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['probability_impact_correlation'],
  },

  // ── Progress / Resource（3 dimensions）──
  {
    dimensionId: SE_DIMENSION_IDS.SE_PR_01,
    name: '进度计划可信度',
    group: 'progress_resource',
    weight: 0.4,
    rubric: [
      { score: 1, description: '进度计划不可信', criteria: ['estimated duration unrealistic'] },
      { score: 2, description: '进度计划需大幅调整', criteria: ['多数任务估计不准确'] },
      { score: 3, description: '进度计划基本可信', criteria: ['多数估计在合理范围'] },
      { score: 4, description: '进度计划较可信', criteria: ['估计基于历史数据'] },
      { score: 5, description: '进度计划高度可信', criteria: ['估计有可靠依据'] },
    ],
    inputSliceSchema: '任务 duration、排期、关键路径',
    applicableProfiles: ['schedule_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['avg_duration', 'critical_path_length', 'task_count_vs_duration'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_PR_02,
    name: '资源分配合理性',
    group: 'progress_resource',
    weight: 0.3,
    rubric: [
      { score: 1, description: '资源分配严重不合理', criteria: ['> 50% overload'] },
      { score: 2, description: '资源分配需优化', criteria: ['多处资源超载'] },
      { score: 3, description: '资源分配基本合理', criteria: ['少数超载'] },
      { score: 4, description: '资源分配较合理', criteria: ['无超载，分配均衡'] },
      { score: 5, description: '资源分配非常合理', criteria: ['最优分配'] },
    ],
    inputSliceSchema: '资源负载、分配矩阵',
    applicableProfiles: ['resource_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['overload_count', 'resource_utilization', 'Hard_warning_summary'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_PR_03,
    name: '里程碑可达性',
    group: 'progress_resource',
    weight: 0.3,
    rubric: [
      { score: 1, description: '里程碑不可达', criteria: ['里程碑日期与排期脱节'] },
      { score: 2, description: '多数里程碑需调整', criteria: ['> 50% milestones at risk'] },
      { score: 3, description: '里程碑基本可达', criteria: ['关键里程碑可达'] },
      { score: 4, description: '里程碑较可达', criteria: ['多数里程碑有缓冲'] },
      { score: 5, description: '里程碑高度可达', criteria: ['所有里程碑合理可达'] },
    ],
    inputSliceSchema: '里程碑列表、日期、关联任务',
    applicableProfiles: ['schedule_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['milestone_buffer_days', 'milestone_dependency_count'],
  },

  // ── Scope / Target（3 dimensions）──
  {
    dimensionId: SE_DIMENSION_IDS.SE_ST_01,
    name: '范围完整性',
    group: 'scope_target',
    weight: 0.4,
    rubric: [
      { score: 1, description: '项目范围严重不完整', criteria: ['missing key scope areas'] },
      { score: 2, description: '范围定义不完整', criteria: ['多个范围领域缺失'] },
      { score: 3, description: '范围基本完整', criteria: ['主要范围已定义'] },
      { score: 4, description: '范围较完整', criteria: ['范围定义详细'] },
      { score: 5, description: '范围非常完整', criteria: ['范围边界清晰'] },
    ],
    inputSliceSchema: '项目范围描述、验收标准',
    applicableProfiles: ['requirements_gate', 'blueprint_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['scope_requirement_count'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_ST_02,
    name: '目标一致性',
    group: 'scope_target',
    weight: 0.3,
    rubric: [
      { score: 1, description: '项目目标冲突', criteria: ['目标相互矛盾'] },
      { score: 2, description: '部分目标不一致', criteria: ['> 20% goals inconsistent'] },
      { score: 3, description: '目标基本一致', criteria: ['主要目标协调'] },
      { score: 4, description: '目标一致性好', criteria: ['大多数目标形成体系'] },
      { score: 5, description: '目标体系高度一致', criteria: ['SMART 目标体系'] },
    ],
    inputSliceSchema: '项目目标列表、描述',
    applicableProfiles: ['requirements_gate', 'blueprint_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['goal_count', 'goal_category_coverage'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_ST_03,
    name: '约束可满足性',
    group: 'scope_target',
    weight: 0.3,
    rubric: [
      { score: 1, description: '约束条件不可满足', criteria: ['预算/时间严重不足'] },
      { score: 2, description: '多数约束难以满足', criteria: ['主要约束紧张'] },
      { score: 3, description: '约束基本可满足', criteria: ['约束在正常范围'] },
      { score: 4, description: '约束较易满足', criteria: ['有足够缓冲'] },
      { score: 5, description: '约束很容易满足', criteria: ['充分资源'] },
    ],
    inputSliceSchema: '项目约束（预算、时间、资源）',
    applicableProfiles: ['requirements_gate', 'blueprint_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['budget_ratio', 'schedule_buffer'],
  },

  // ── Communication（2 dimensions）──
  {
    dimensionId: SE_DIMENSION_IDS.SE_COMM_01,
    name: '干系人覆盖完整',
    group: 'communication',
    weight: 0.6,
    rubric: [
      { score: 1, description: '干系人严重缺失', criteria: ['few stakeholders identified'] },
      { score: 2, description: '部分干系人缺失', criteria: ['> 30% stakeholders missing'] },
      { score: 3, description: '干系人基本覆盖', criteria: ['关键干系人已覆盖'] },
      { score: 4, description: '干系人覆盖较完整', criteria: ['多数干系人已识别'] },
      { score: 5, description: '干系人全面覆盖', criteria: ['所有干系人已识别'] },
    ],
    inputSliceSchema: '干系人列表、角色、沟通需求',
    applicableProfiles: ['blueprint_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['stakeholder_count', 'stakeholder_role_coverage'],
  },
  {
    dimensionId: SE_DIMENSION_IDS.SE_COMM_02,
    name: '沟通频率适当',
    group: 'communication',
    weight: 0.4,
    rubric: [
      { score: 1, description: '沟通计划缺失', criteria: ['no communication plan'] },
      { score: 2, description: '沟通计划不充分', criteria: ['只覆盖部分干系人'] },
      { score: 3, description: '沟通计划基本合理', criteria: ['主要干系人有沟通计划'] },
      { score: 4, description: '沟通计划较好', criteria: ['沟通频率合理'] },
      { score: 5, description: '沟通计划非常合理', criteria: ['差异化沟通策略'] },
    ],
    inputSliceSchema: '沟通计划、频率、渠道',
    applicableProfiles: ['blueprint_gate', 'global_sample'],
    defaultThreshold: 3,
    deterministicSignals: ['communication_plan_count'],
  },
]

// ── Registry Class ──

/**
 * Soft Evaluator 维度注册表。
 */
export class SeDimensionRegistry {
  readonly #dimensions: Map<string, SeDimensionEntry> = new Map()

  constructor() {
    this.#loadDefaults()
  }

  /** 注册维度。 */
  registerDimension(entry: SeDimensionEntry): void {
    this.#dimensions.set(entry.dimensionId, entry)
  }

  /** 按 dimensionId 获取维度。 */
  getDimension(dimId: string): SeDimensionEntry | undefined {
    return this.#dimensions.get(dimId)
  }

  /** 获取所有维度。 */
  getAllDimensions(): SeDimensionEntry[] {
    return Array.from(this.#dimensions.values())
  }

  /** 按分组获取维度。 */
  getByGroup(group: SoftDimensionGroup): SeDimensionEntry[] {
    return this.getAllDimensions().filter((d) => d.group === group)
  }

  /** 获取维度数量。 */
  get dimensionCount(): number {
    return this.#dimensions.size
  }

  #loadDefaults(): void {
    for (const dim of DEFAULT_DIMENSIONS) {
      this.#dimensions.set(dim.dimensionId, dim)
    }
  }
}
