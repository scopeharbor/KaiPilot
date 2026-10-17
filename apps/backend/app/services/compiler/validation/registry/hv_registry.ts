/**
 * @aiproj/backend —— Hard Validator 规则注册表（HV-001~HV-025）。
 *
 * 保留 V2/V3 资料包中定义的 25 个规范规则 ID。
 * 实现层允许一个 RuleImplementation 覆盖多个 sourceRuleIds，
 * 但报告必须按规范 ID 展开。
 *
 * @aiproj/backend
 */

import type {
  HardRuleCategory,
  HardRuleDefaultSeverity,
  HardRuleApplicableProfile,
  HardRuleRequiredInput,
} from '@aiproj/compiler-spec'
import { HV_RULE_IDS } from '@aiproj/compiler-spec'

// ── Rule Registry Entry ──

export interface HvRegistryEntry {
  /** 规范规则 ID，如 "HV-001"。 */
  ruleId: string
  /** 规则名称。 */
  name: string
  /** 规则类别。 */
  category: HardRuleCategory
  /** 描述。 */
  description: string
  /** 默认严重度。 */
  defaultSeverity: HardRuleDefaultSeverity
  /** 适用的 V-Gate profile 列表。 */
  applicableProfiles: HardRuleApplicableProfile[]
  /** 需要哪些确定性输入。 */
  requiredInputs: HardRuleRequiredInput[]
  /** 实现层规则 ID。 */
  implementationId: string
  /** 来源规则 ID 列表（当该条目是聚合实现时）。 */
  sourceRuleIds: string[]
  /** 是否自动可修复。 */
  autoFixable: boolean
  /** 是否需要人工复核。 */
  requiresHumanReview: boolean
}

// ── Implementation Entry ──

export interface HvImplementationEntry {
  /** 实现 ID。 */
  implementationId: string
  /** 覆盖的规范规则 ID 列表。 */
  sourceRuleIds: string[]
  /** 实现描述。 */
  description: string
  /** 所需输入。 */
  requiredInputs: HardRuleRequiredInput[]
}

// ── Default Registry ──

/**
 * HV-001~HV-025 默认注册表。
 * 所有实现规则对应一个 implementation ID，多个相近规则可共享同一 implementation。
 */
const DEFAULT_REGISTRY: HvRegistryEntry[] = [
  // ── Schema Parse（HV-001~HV-002）──
  {
    ruleId: HV_RULE_IDS.HV_001,
    name: 'PDM Schema Parse 完整',
    category: 'schema_parse',
    description: '验证 PDM 是否按 schema 完整解析，无必填字段缺失',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['pdm_schema_parse'],
    implementationId: 'impl-schema-parse',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: false,
  },
  {
    ruleId: HV_RULE_IDS.HV_002,
    name: 'Enum/Format 字段正确',
    category: 'schema_parse',
    description: '验证 enum 值和 format 字段（如日期格式、状态枚举）正确性',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['pdm_schema_parse'],
    implementationId: 'impl-schema-parse',
    sourceRuleIds: [],
    autoFixable: true,
    requiresHumanReview: false,
  },

  // ── Reference Integrity（HV-003~HV-006）──
  {
    ruleId: HV_RULE_IDS.HV_003,
    name: '依赖目标存在',
    category: 'reference_integrity',
    description: '所有依赖关系的目标实体在 PDM 中存在',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['graph_validation'],
    implementationId: 'impl-reference-integrity',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },
  {
    ruleId: HV_RULE_IDS.HV_004,
    name: '资源分配目标存在',
    category: 'reference_integrity',
    description: '所有资源分配的目标（resourceId）在资源列表中',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-reference-integrity',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },
  {
    ruleId: HV_RULE_IDS.HV_005,
    name: 'RACI 角色存在',
    category: 'reference_integrity',
    description: '所有 RACI 矩阵中引用的角色/人员在干系人列表中',
    defaultSeverity: 'warning',
    applicableProfiles: ['all'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-reference-integrity',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: false,
  },
  {
    ruleId: HV_RULE_IDS.HV_006,
    name: '里程碑关联任务存在',
    category: 'reference_integrity',
    description: '所有里程碑关联的目标任务在 PDM 中存在',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-reference-integrity',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },

  // ── Structure（HV-007~HV-010）
  // HV-007, HV-009 聚合为 impl-hierarchy；HV-008 单独；HV-010 单独
  {
    ruleId: HV_RULE_IDS.HV_007,
    name: '层级完整性（无 gap/orphan）',
    category: 'structure',
    description: 'WBS 层级无缺口（gap）和孤立实体（orphan）',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-hierarchy',
    sourceRuleIds: [HV_RULE_IDS.HV_009],
    autoFixable: true,
    requiresHumanReview: false,
  },
  {
    ruleId: HV_RULE_IDS.HV_008,
    name: '依赖环路检测',
    category: 'structure',
    description: '任务依赖图中无环路',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['graph_validation'],
    implementationId: 'impl-cycle-detection',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },
  {
    ruleId: HV_RULE_IDS.HV_009,
    name: '非循环依赖',
    category: 'structure',
    description: 'DAG 无循环（impl-hierarchy 覆盖此规则）',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['graph_validation'],
    implementationId: 'impl-hierarchy',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },
  {
    ruleId: HV_RULE_IDS.HV_010,
    name: '拓扑排序可行性',
    category: 'structure',
    description: '依赖图可进行拓扑排序',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['graph_validation'],
    implementationId: 'impl-topo-sort',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },

  // ── Date / Schedule（HV-011~HV-014）──
  {
    ruleId: HV_RULE_IDS.HV_011,
    name: '日期一致性（end >= start）',
    category: 'date_schedule',
    description: '所有任务的计划结束日期不早于开始日期',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['schedule_result'],
    implementationId: 'impl-date-consistency',
    sourceRuleIds: [],
    autoFixable: true,
    requiresHumanReview: false,
  },
  {
    ruleId: HV_RULE_IDS.HV_012,
    name: '依赖日期逻辑',
    category: 'date_schedule',
    description: '依赖关系中前驱任务完成日期不晚于后继任务开始日期',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['graph_validation', 'schedule_result'],
    implementationId: 'impl-dependency-dates',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },
  {
    ruleId: HV_RULE_IDS.HV_013,
    name: '日历合规',
    category: 'date_schedule',
    description: '任务排期符合项目日历（非工作日不排任务）',
    defaultSeverity: 'warning',
    applicableProfiles: ['all'],
    requiredInputs: ['schedule_result', 'stage_metadata'],
    implementationId: 'impl-calendar-compliance',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: false,
  },
  {
    ruleId: HV_RULE_IDS.HV_014,
    name: '里程碑日期对齐',
    category: 'date_schedule',
    description: '里程碑日期与关联任务完成日期对齐',
    defaultSeverity: 'warning',
    applicableProfiles: ['all'],
    requiredInputs: ['schedule_result', 'pdm_snapshot'],
    implementationId: 'impl-milestone-dates',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: false,
  },

  // ── Numeric（HV-015~HV-018）──
  {
    ruleId: HV_RULE_IDS.HV_015,
    name: 'Effort 汇总一致性',
    category: 'numeric',
    description: '子任务 effort 之和不大于父任务 effort',
    defaultSeverity: 'warning',
    applicableProfiles: ['all'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-effort-summary',
    sourceRuleIds: [],
    autoFixable: true,
    requiresHumanReview: false,
  },
  {
    ruleId: HV_RULE_IDS.HV_016,
    name: 'Budget 汇总一致性',
    category: 'numeric',
    description: '子任务 budget 之和不大于父任务 budget',
    defaultSeverity: 'warning',
    applicableProfiles: ['blueprint_gate', 'global_sample'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-budget-summary',
    sourceRuleIds: [],
    autoFixable: true,
    requiresHumanReview: false,
  },
  {
    ruleId: HV_RULE_IDS.HV_017,
    name: 'Progress 数值范围',
    category: 'numeric',
    description: '所有 progress 值在 0-100 范围内',
    defaultSeverity: 'warning',
    applicableProfiles: ['blueprint_gate', 'global_sample'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-progress-range',
    sourceRuleIds: [],
    autoFixable: true,
    requiresHumanReview: false,
  },
  {
    ruleId: HV_RULE_IDS.HV_018,
    name: '工期非负',
    category: 'numeric',
    description: '所有任务工期不为负数',
    defaultSeverity: 'blocking',
    applicableProfiles: ['all'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-duration-non-negative',
    sourceRuleIds: [],
    autoFixable: true,
    requiresHumanReview: false,
  },

  // ── Resource（HV-019~HV-021）──
  {
    ruleId: HV_RULE_IDS.HV_019,
    name: '资源容量未超载',
    category: 'resource',
    description: '资源分配不超出可用容量',
    defaultSeverity: 'warning',
    applicableProfiles: ['resource_gate', 'global_sample'],
    requiredInputs: ['resource_load_result'],
    implementationId: 'impl-resource-capacity',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },
  {
    ruleId: HV_RULE_IDS.HV_020,
    name: '资源分配不重叠',
    category: 'resource',
    description: '同一时间同一资源不被分配给多个任务',
    defaultSeverity: 'warning',
    applicableProfiles: ['resource_gate', 'global_sample'],
    requiredInputs: ['resource_load_result'],
    implementationId: 'impl-resource-overlap',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },
  {
    ruleId: HV_RULE_IDS.HV_021,
    name: '资源技能匹配',
    category: 'resource',
    description: '资源技能与任务需求匹配',
    defaultSeverity: 'info',
    applicableProfiles: ['resource_gate'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-resource-skill',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: false,
  },

  // ── RACI（HV-022~HV-023）──
  {
    ruleId: HV_RULE_IDS.HV_022,
    name: 'RACI 矩阵完整',
    category: 'raci',
    description: '所有任务都有 R（责任人）和 A（负责人）角色分配',
    defaultSeverity: 'warning',
    applicableProfiles: ['blueprint_gate', 'global_sample'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-raci-completeness',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: false,
  },
  {
    ruleId: HV_RULE_IDS.HV_023,
    name: '关键任务有负责人',
    category: 'raci',
    description: '关键路径上的任务都有明确的负责人',
    defaultSeverity: 'blocking',
    applicableProfiles: ['schedule_gate', 'global_sample'],
    requiredInputs: ['critical_path_result', 'pdm_snapshot'],
    implementationId: 'impl-critical-owner',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },

  // ── Risk（HV-024）──
  {
    ruleId: HV_RULE_IDS.HV_024,
    name: '风险登记册完整',
    category: 'risk',
    description: '风险登记册包含已识别风险的概率、影响和缓解措施',
    defaultSeverity: 'info',
    applicableProfiles: ['blueprint_gate', 'global_sample'],
    requiredInputs: ['pdm_snapshot'],
    implementationId: 'impl-risk-completeness',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: false,
  },

  // ── Blueprint Consistency（HV-025）──
  {
    ruleId: HV_RULE_IDS.HV_025,
    name: 'Blueprint 映射一致性',
    category: 'blueprint_consistency',
    description: 'PDM 实体与 Blueprint 定义之间的映射一致性',
    defaultSeverity: 'warning',
    applicableProfiles: ['blueprint_gate', 'global_sample'],
    requiredInputs: ['diff_result', 'pdm_schema_parse'],
    implementationId: 'impl-blueprint-consistency',
    sourceRuleIds: [],
    autoFixable: false,
    requiresHumanReview: true,
  },
]

/** implementation ID → implementation 映射。 */
const DEFAULT_IMPLEMENTATIONS: HvImplementationEntry[] = [
  {
    implementationId: 'impl-schema-parse',
    sourceRuleIds: [HV_RULE_IDS.HV_001, HV_RULE_IDS.HV_002],
    description: 'PDM schema parse 完整性检查，覆盖 enum/format 字段验证',
    requiredInputs: ['pdm_schema_parse'],
  },
  {
    implementationId: 'impl-reference-integrity',
    sourceRuleIds: [HV_RULE_IDS.HV_003, HV_RULE_IDS.HV_004, HV_RULE_IDS.HV_005, HV_RULE_IDS.HV_006],
    description: '引用完整性检查：依赖/资源/RACI/里程碑目标存在性',
    requiredInputs: ['graph_validation', 'pdm_snapshot'],
  },
  {
    implementationId: 'impl-hierarchy',
    sourceRuleIds: [HV_RULE_IDS.HV_007, HV_RULE_IDS.HV_009],
    description: '层级完整性与非循环依赖检查',
    requiredInputs: ['pdm_snapshot', 'graph_validation'],
  },
  {
    implementationId: 'impl-cycle-detection',
    sourceRuleIds: [HV_RULE_IDS.HV_008],
    description: '依赖环路检测',
    requiredInputs: ['graph_validation'],
  },
  {
    implementationId: 'impl-topo-sort',
    sourceRuleIds: [HV_RULE_IDS.HV_010],
    description: '拓扑排序可行性',
    requiredInputs: ['graph_validation'],
  },
  {
    implementationId: 'impl-date-consistency',
    sourceRuleIds: [HV_RULE_IDS.HV_011],
    description: '日期一致性检查',
    requiredInputs: ['schedule_result'],
  },
  {
    implementationId: 'impl-dependency-dates',
    sourceRuleIds: [HV_RULE_IDS.HV_012],
    description: '依赖日期逻辑检查',
    requiredInputs: ['graph_validation', 'schedule_result'],
  },
  {
    implementationId: 'impl-calendar-compliance',
    sourceRuleIds: [HV_RULE_IDS.HV_013],
    description: '日历合规检查',
    requiredInputs: ['schedule_result', 'stage_metadata'],
  },
  {
    implementationId: 'impl-milestone-dates',
    sourceRuleIds: [HV_RULE_IDS.HV_014],
    description: '里程碑日期对齐检查',
    requiredInputs: ['schedule_result', 'pdm_snapshot'],
  },
  {
    implementationId: 'impl-effort-summary',
    sourceRuleIds: [HV_RULE_IDS.HV_015],
    description: 'Effort 汇总一致性',
    requiredInputs: ['pdm_snapshot'],
  },
  {
    implementationId: 'impl-budget-summary',
    sourceRuleIds: [HV_RULE_IDS.HV_016],
    description: 'Budget 汇总一致性',
    requiredInputs: ['pdm_snapshot'],
  },
  {
    implementationId: 'impl-progress-range',
    sourceRuleIds: [HV_RULE_IDS.HV_017],
    description: 'Progress 数值范围检查',
    requiredInputs: ['pdm_snapshot'],
  },
  {
    implementationId: 'impl-duration-non-negative',
    sourceRuleIds: [HV_RULE_IDS.HV_018],
    description: '工期非负检查',
    requiredInputs: ['pdm_snapshot'],
  },
  {
    implementationId: 'impl-resource-capacity',
    sourceRuleIds: [HV_RULE_IDS.HV_019],
    description: '资源容量未超载',
    requiredInputs: ['resource_load_result'],
  },
  {
    implementationId: 'impl-resource-overlap',
    sourceRuleIds: [HV_RULE_IDS.HV_020],
    description: '资源分配不重叠',
    requiredInputs: ['resource_load_result'],
  },
  {
    implementationId: 'impl-resource-skill',
    sourceRuleIds: [HV_RULE_IDS.HV_021],
    description: '资源技能匹配',
    requiredInputs: ['pdm_snapshot'],
  },
  {
    implementationId: 'impl-raci-completeness',
    sourceRuleIds: [HV_RULE_IDS.HV_022],
    description: 'RACI 矩阵完整性',
    requiredInputs: ['pdm_snapshot'],
  },
  {
    implementationId: 'impl-critical-owner',
    sourceRuleIds: [HV_RULE_IDS.HV_023],
    description: '关键任务有负责人',
    requiredInputs: ['critical_path_result', 'pdm_snapshot'],
  },
  {
    implementationId: 'impl-risk-completeness',
    sourceRuleIds: [HV_RULE_IDS.HV_024],
    description: '风险登记册完整性',
    requiredInputs: ['pdm_snapshot'],
  },
  {
    implementationId: 'impl-blueprint-consistency',
    sourceRuleIds: [HV_RULE_IDS.HV_025],
    description: 'Blueprint 映射一致性',
    requiredInputs: ['diff_result', 'pdm_schema_parse'],
  },
]

// ── Registry Class ──

/**
 * Hard Validator 规则注册表。
 */
export class HvRuleRegistry {
  readonly #rules: Map<string, HvRegistryEntry> = new Map()
  readonly #implementations: Map<string, HvImplementationEntry> = new Map()

  constructor() {
    this.#loadDefaults()
  }

  /** 注册单条规则。 */
  registerRule(entry: HvRegistryEntry): void {
    this.#rules.set(entry.ruleId, entry)
  }

  /** 注册实现。 */
  registerImplementation(impl: HvImplementationEntry): void {
    this.#implementations.set(impl.implementationId, impl)
  }

  /** 按 ruleId 获取规则。 */
  getRule(ruleId: string): HvRegistryEntry | undefined {
    return this.#rules.get(ruleId)
  }

  /** 获取所有规则（按 ruleId 排序）。 */
  getAllRules(): HvRegistryEntry[] {
    return Array.from(this.#rules.values()).sort((a, b) => a.ruleId.localeCompare(b.ruleId))
  }

  /** 获取规则数量。 */
  get ruleCount(): number {
    return this.#rules.size
  }

  /** 按 implementationId 获取实现。 */
  getImplementation(implId: string): HvImplementationEntry | undefined {
    return this.#implementations.get(implId)
  }

  /** 获取所有实现。 */
  getAllImplementations(): HvImplementationEntry[] {
    return Array.from(this.#implementations.values())
  }

  /** 加载默认注册表。 */
  #loadDefaults(): void {
    for (const entry of DEFAULT_REGISTRY) {
      this.#rules.set(entry.ruleId, entry)
    }
    for (const impl of DEFAULT_IMPLEMENTATIONS) {
      this.#implementations.set(impl.implementationId, impl)
    }
  }
}
