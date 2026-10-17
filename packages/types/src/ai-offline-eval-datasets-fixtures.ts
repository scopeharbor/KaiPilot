/**
 * v3-ai-offline-eval-datasets-fixtures —— 离线回归评测数据集测试夹具。
 *
 * 从现有 fixture 中提取样本，NOT 新造样本：
 * - intent_routing: 从 compiler-skill-builtin-seeds + skill-activation 提取
 * - draft_quality: 从 ai-automated-evaluation deterministic evaluator 提取
 * - context_assembly: 从 copilot-context-assembly-fixtures 七态提取
 * - structured_output: 从 copilot-structured-output-fixtures 五态提取
 *
 * 零运行时依赖，确定性纯数据。
 */

import type {
  IntentRoutingSample,
  DraftQualitySample,
  ContextAssemblySample,
  StructuredOutputSample,
  OfflineEvalDataset,
  DatasetVersion,
  ScoringConfigVersion,
  OfflineEvalReport,
  OfflineEvalSample,
} from './ai-offline-eval-datasets.js'
import type { ActivationContext } from './skill-activation.js'

// ═══════════════════════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════════════════════

/** 当前数据集版本。 */
export const CURRENT_DATASET_VERSION: DatasetVersion = { major: 1, minor: 0, patch: 0 }

/** 当前评分配置版本。 */
export const CURRENT_SCORING_CONFIG_VERSION: ScoringConfigVersion = {
  version: '1.0.0',
  skillEvalVersion: '1.0.0',
  deterministicEvalVersion: '1.0.0',
}

// ═══════════════════════════════════════════════════════════════════════════════
// 意图路由准确率样本（从 builtin seeds + skill-activation 提取）
// ═══════════════════════════════════════════════════════════════════════════════

/** 从 builtin seed 构造 minimal Skill（供 BenchmarkInput 消费）。 */
function buildSkillForBenchmark(seed: {
  skillKey: string
  name: string
  version: string
  description: string
  category: { primary: string; secondary?: string }
  tags: string[]
  dependencies: string[]
  activation: Record<string, unknown>
  basePriority: number
}) {
  return {
    id: 1,
    organizationId: 1,
    skillKey: seed.skillKey,
    name: seed.name,
    version: seed.version,
    description: seed.description,
    status: 'active' as const,
    category: seed.category as { primary: 'domain'; secondary?: string },
    tags: seed.tags,
    dependencies: seed.dependencies,
    activation: seed.activation as Record<string, unknown>,
    knowledge: {},
    basePriority: seed.basePriority,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

// 内联 builtin seed 元数据（只取路由需要的字段，不重复全部内容）
const SW_DEV_SEED = {
  skillKey: 'skill-sw-dev',
  name: '软件开发',
  version: '1.0.0',
  description: '软件开发领域 Skill',
  category: { primary: 'domain' as const, secondary: 'software_engineering' },
  tags: ['software', 'development'],
  dependencies: [],
  activation: { projectTypes: ['software'], domains: ['software_engineering'], priority: 80 },
  basePriority: 80,
}

const AGILE_SEED = {
  skillKey: 'skill-agile',
  name: '敏捷项目管理',
  version: '1.0.0',
  description: '敏捷项目管理方法论',
  category: { primary: 'methodology' as const, secondary: 'agile' },
  tags: ['agile', 'scrum'],
  dependencies: [],
  activation: { projectTypes: ['software'], domains: ['agile'], priority: 70 },
  basePriority: 70,
}

const MARKETING_SEED = {
  skillKey: 'skill-marketing',
  name: '营销活动',
  version: '1.0.0',
  description: '营销活动管理 Skill',
  category: { primary: 'domain' as const, secondary: 'marketing' },
  tags: ['marketing'],
  dependencies: [],
  activation: { projectTypes: ['marketing'], domains: ['marketing'], priority: 60 },
  basePriority: 60,
}

const DEVOPS_SEED = {
  skillKey: 'skill-devops',
  name: 'DevOps',
  version: '1.0.0',
  description: 'DevOps 实践 Skill',
  category: { primary: 'domain' as const, secondary: 'devops' },
  tags: ['devops', 'ci-cd'],
  dependencies: [],
  activation: { projectTypes: ['software'], domains: ['devops'], priority: 65 },
  basePriority: 65,
}

/** 软件项目上下文——期望 sw-dev + agile 激活。 */
const SOFTWARE_CONTEXT: ActivationContext = {
  projectType: 'software',
  projectTags: ['software_engineering', 'agile'],
}

/** 营销项目上下文——期望 marketing 激活。 */
const MARKETING_CONTEXT: ActivationContext = {
  projectType: 'marketing',
  projectTags: ['marketing'],
}

const ALL_SKILLS = [
  buildSkillForBenchmark(SW_DEV_SEED),
  buildSkillForBenchmark(AGILE_SEED),
  buildSkillForBenchmark(MARKETING_SEED),
  buildSkillForBenchmark(DEVOPS_SEED),
]

/** Intent routing 准确率样本——4 个场景。 */
export const INTENT_ROUTING_SAMPLES: IntentRoutingSample[] = [
  {
    sampleId: 'ir-001',
    label: '软件项目激活 skill-sw-dev 和 skill-agile',
    benchmarkInput: {
      label: '软件项目激活',
      context: SOFTWARE_CONTEXT,
      skills: ALL_SKILLS,
      expectedActivatedKeys: ['skill-sw-dev', 'skill-agile'],
    },
    expectedActivatedKeys: ['skill-sw-dev', 'skill-agile'],
  },
  {
    sampleId: 'ir-002',
    label: '营销项目激活 skill-marketing',
    benchmarkInput: {
      label: '营销项目激活',
      context: MARKETING_CONTEXT,
      skills: ALL_SKILLS,
      expectedActivatedKeys: ['skill-marketing'],
    },
    expectedActivatedKeys: ['skill-marketing'],
  },
  {
    sampleId: 'ir-003',
    label: '空上下文不激活任何 Skill',
    benchmarkInput: {
      label: '空上下文',
      context: {},
      skills: ALL_SKILLS,
      expectedActivatedKeys: [],
    },
    expectedActivatedKeys: [],
  },
  {
    sampleId: 'ir-004',
    label: '手动选择 skill-devops',
    benchmarkInput: {
      label: '手动选择',
      context: { manualSelections: ['skill-devops'] },
      skills: ALL_SKILLS,
      expectedActivatedKeys: ['skill-devops'],
    },
    expectedActivatedKeys: ['skill-devops'],
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// 草案质量样本（从 deterministic evaluator 提取）
// ═══════════════════════════════════════════════════════════════════════════════

/** Draft quality 准确率样本——4 个场景。 */
export const DRAFT_QUALITY_SAMPLES: DraftQualitySample[] = [
  {
    sampleId: 'dq-001',
    label: '完整草案结构（全部必需字段）',
    evaluatorInput: {
      dimension: 'draft_structural_compliance',
      artifact: {
        artifactKind: 'draft_version',
        artifactRef: 'draft:v1:complete',
        contentHash: 'hash_complete_draft',
      },
      features: {
        wbsNodes: [
          { id: '1', name: '需求分析' },
          { id: '2', name: '设计' },
        ],
        taskDependencies: [{ from: '1', to: '2', type: 'FS' }],
        acceptanceCriteria: ['功能完整', '性能达标'],
      },
      organizationId: 1,
    },
    expectedScoreValue: 1,
  },
  {
    sampleId: 'dq-002',
    label: '缺失 wbsNodes 的草案',
    evaluatorInput: {
      dimension: 'draft_structural_compliance',
      artifact: {
        artifactKind: 'draft_version',
        artifactRef: 'draft:v1:no-wbs',
        contentHash: 'hash_no_wbs',
      },
      features: {
        taskDependencies: [{ from: '1', to: '2', type: 'FS' }],
        acceptanceCriteria: ['功能完整'],
      },
      organizationId: 1,
    },
    expectedScoreValue: 0,
  },
  {
    sampleId: 'dq-003',
    label: '空 wbsNodes 数组的草案',
    evaluatorInput: {
      dimension: 'draft_structural_compliance',
      artifact: {
        artifactKind: 'draft_version',
        artifactRef: 'draft:v1:empty-wbs',
        contentHash: 'hash_empty_wbs',
      },
      features: {
        wbsNodes: [],
        taskDependencies: [{ from: '1', to: '2', type: 'FS' }],
        acceptanceCriteria: ['功能完整'],
      },
      organizationId: 1,
    },
    expectedScoreValue: 0,
  },
  {
    sampleId: 'dq-004',
    label: '全部必需字段缺失的草案',
    evaluatorInput: {
      dimension: 'draft_structural_compliance',
      artifact: {
        artifactKind: 'draft_version',
        artifactRef: 'draft:v1:empty',
        contentHash: 'hash_empty_draft',
      },
      features: {},
      organizationId: 1,
    },
    expectedScoreValue: 0,
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// 上下文组装完备度样本（从 copilot-context-assembly-fixtures 七态提取）
// ═══════════════════════════════════════════════════════════════════════════════

/** Context assembly 完备度样本——7 个场景（对应七态 fixture）。 */
export const CONTEXT_ASSEMBLY_SAMPLES: ContextAssemblySample[] = [
  {
    sampleId: 'ca-001',
    label: 'complete 态：三来源 granted、零截断、零不确定',
    assemblyState: 'complete',
    sourceCount: 3,
    truncated: false,
    hasWarnings: false,
    expectedCompleteness: 'pass',
  },
  {
    sampleId: 'ca-002',
    label: 'truncated 态：十二来源超预算，走声明式截断',
    assemblyState: 'truncated',
    sourceCount: 12,
    truncated: true,
    hasWarnings: false,
    expectedCompleteness: 'pass',
  },
  {
    sampleId: 'ca-003',
    label: 'stale 态：task 来源 hash 失配',
    assemblyState: 'stale',
    sourceCount: 2,
    truncated: false,
    hasWarnings: true,
    expectedCompleteness: 'fail',
  },
  {
    sampleId: 'ca-004',
    label: 'permission-missing 态：denied-hidden 来源省略',
    assemblyState: 'permission-missing',
    sourceCount: 2,
    truncated: false,
    hasWarnings: true,
    expectedCompleteness: 'fail',
  },
  {
    sampleId: 'ca-005',
    label: 'zero-result 态：来源 matched=false',
    assemblyState: 'zero-result',
    sourceCount: 1,
    truncated: false,
    hasWarnings: false,
    expectedCompleteness: 'fail',
  },
  {
    sampleId: 'ca-006',
    label: 'methodology-injected 态：注入 agile-delivery 方法论',
    assemblyState: 'methodology-injected',
    sourceCount: 3,
    truncated: false,
    hasWarnings: false,
    expectedCompleteness: 'pass',
  },
  {
    sampleId: 'ca-007',
    label: 'general-scope 态：global scope、零来源',
    assemblyState: 'general-scope',
    sourceCount: 0,
    truncated: false,
    hasWarnings: false,
    expectedCompleteness: 'fail',
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// 结构化输出符合度样本（从 copilot-structured-output-fixtures 提取）
// ═══════════════════════════════════════════════════════════════════════════════

/** Structured output 符合度样本——5 个场景。 */
export const STRUCTURED_OUTPUT_SAMPLES: StructuredOutputSample[] = [
  {
    sampleId: 'so-001',
    label: '表格命中：完整表格，每行有 sourceRef',
    blockKind: 'table',
    guardPassed: true,
    hasSourceRefs: true,
    expectedConformance: 'pass',
  },
  {
    sampleId: 'so-002',
    label: '图命中：完整图，每节点有 sourceRef，守卫通过',
    blockKind: 'diagram',
    guardPassed: true,
    hasSourceRefs: true,
    expectedConformance: 'pass',
  },
  {
    sampleId: 'so-003',
    label: '守卫拒绝：图被守卫拒绝',
    blockKind: 'diagram',
    guardPassed: false,
    hasSourceRefs: true,
    expectedConformance: 'fail',
  },
  {
    sampleId: 'so-004',
    label: '零可追溯行：所有行均无 sourceRef',
    blockKind: 'absent',
    guardPassed: true,
    hasSourceRefs: false,
    expectedConformance: 'fail',
  },
  {
    sampleId: 'so-005',
    label: '截断：表格超预算，截断后保留部分行',
    blockKind: 'table',
    guardPassed: true,
    hasSourceRefs: true,
    expectedConformance: 'pass',
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// 完整数据集构建器
// ═══════════════════════════════════════════════════════════════════════════════

/** 构建完整的离线回归评测数据集。 */
export function buildOfflineEvalDataset(
  overrides?: Partial<OfflineEvalDataset>,
): OfflineEvalDataset {
  return {
    datasetId: overrides?.datasetId ?? 'offline-eval-v1',
    version: overrides?.version ?? CURRENT_DATASET_VERSION,
    description:
      overrides?.description ??
      'V3 离线回归评测数据集 v1：覆盖意图路由/草案质量/上下文组装/结构化输出四类目标组',
    samples: overrides?.samples ?? {
      intentRouting: INTENT_ROUTING_SAMPLES,
      draftQuality: DRAFT_QUALITY_SAMPLES,
      contextAssembly: CONTEXT_ASSEMBLY_SAMPLES,
      structuredOutput: STRUCTURED_OUTPUT_SAMPLES,
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2.9 五态回归报告 Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

/** 共享报告元数据。 */
const REPORT_META = {
  reportId: 'report-fixture-001',
  datasetId: 'offline-eval-v1',
  datasetVersion: CURRENT_DATASET_VERSION,
  scoringConfigVersion: CURRENT_SCORING_CONFIG_VERSION,
  ranAt: '2026-08-21T00:00:00.000Z',
  subjectVersion: '1.0.0',
}

// ── Fixture 1: 全通过 ────────────────────────────────────────────────

/** 全通过报告：所有样本 pass。 */
export const fixtureAllPassReport: OfflineEvalReport = {
  ...REPORT_META,
  reportId: 'report-all-pass',
  sampleResults: [
    {
      sampleId: 'ir-001',
      targetGroup: 'intent_routing_accuracy',
      label: 'IR 001',
      score: 1,
      scoreLabel: 'pass',
      explanation: 'Intent routing correct',
    },
    {
      sampleId: 'dq-001',
      targetGroup: 'draft_quality',
      label: 'DQ 001',
      score: 1,
      scoreLabel: 'pass',
      explanation: 'Draft structure complete',
    },
  ],
  summary: {
    totalSamples: 2,
    passCount: 2,
    failCount: 0,
    notEvaluatedCount: 0,
    improvedCount: 0,
    regressedCount: 0,
    unchangedCount: 0,
    hasBaseline: false,
  },
  contentHash: 'all-pass-hash',
}

// ── Fixture 2: 单样本回归 ────────────────────────────────────────────

/** 单样本回归报告：一个样本 regresses，其余不变。 */
export const fixtureSingleSampleRegressionReport: OfflineEvalReport = {
  ...REPORT_META,
  reportId: 'report-single-regression',
  baselineRunId: 'baseline-run-001',
  sampleResults: [
    {
      sampleId: 'ir-001',
      targetGroup: 'intent_routing_accuracy',
      label: 'IR 001',
      score: 1,
      scoreLabel: 'pass',
      explanation: 'Intent routing correct',
      difference: {
        sampleId: 'ir-001',
        currentScore: 1,
        baselineScore: 1,
        direction: 'unchanged',
        delta: 0,
      },
    },
    {
      sampleId: 'dq-001',
      targetGroup: 'draft_quality',
      label: 'DQ 001',
      score: 0,
      scoreLabel: 'fail',
      explanation: 'Draft structure regression',
      difference: {
        sampleId: 'dq-001',
        currentScore: 0,
        baselineScore: 1,
        direction: 'regressed',
        delta: 1,
      },
    },
  ],
  summary: {
    totalSamples: 2,
    passCount: 1,
    failCount: 1,
    notEvaluatedCount: 0,
    improvedCount: 0,
    regressedCount: 1,
    unchangedCount: 1,
    hasBaseline: true,
  },
  contentHash: 'single-regression-hash',
}

// ── Fixture 3: 轻微整体下滑 ────────────────────────────────────────

/** 轻微整体下滑报告：多个样本轻微下降。 */
export const fixtureMildOverallDeclineReport: OfflineEvalReport = {
  ...REPORT_META,
  reportId: 'report-mild-decline',
  baselineRunId: 'baseline-run-002',
  sampleResults: [
    {
      sampleId: 'ir-001',
      targetGroup: 'intent_routing_accuracy',
      label: 'IR 001',
      score: 0.8,
      scoreLabel: 'pass',
      explanation: 'Slight regression',
      difference: {
        sampleId: 'ir-001',
        currentScore: 0.8,
        baselineScore: 1,
        direction: 'regressed',
        delta: 0.2,
      },
    },
    {
      sampleId: 'dq-001',
      targetGroup: 'draft_quality',
      label: 'DQ 001',
      score: 0.9,
      scoreLabel: 'pass',
      explanation: 'Slight regression',
      difference: {
        sampleId: 'dq-001',
        currentScore: 0.9,
        baselineScore: 1,
        direction: 'regressed',
        delta: 0.1,
      },
    },
    {
      sampleId: 'ca-001',
      targetGroup: 'context_assembly_completeness',
      label: 'CA 001',
      score: 0.7,
      scoreLabel: 'pass',
      explanation: 'Slight regression',
      difference: {
        sampleId: 'ca-001',
        currentScore: 0.7,
        baselineScore: 0.9,
        direction: 'regressed',
        delta: 0.2,
      },
    },
  ],
  summary: {
    totalSamples: 3,
    passCount: 3,
    failCount: 0,
    notEvaluatedCount: 0,
    improvedCount: 0,
    regressedCount: 3,
    unchangedCount: 0,
    hasBaseline: true,
  },
  contentHash: 'mild-decline-hash',
}

// ── Fixture 4: L3 数据集 ────────────────────────────────────────────

/** L3 Synthetic 来源样本（D4：L3 允许出现在数据集中）。 */
export const fixtureL3Samples: readonly OfflineEvalSample[] = [
  {
    sampleId: 'l3-001',
    input: { prompt: 'Generate a WBS for software project' },
    expectedOutput: { wbsNodes: 3 },
    benchmarkSource: 'L3',
  },
  {
    sampleId: 'l3-002',
    input: { prompt: 'Draft project charter' },
    expectedProperties: { hasSections: true },
    benchmarkSource: 'L3',
  },
]

/** L3 数据集报告：L3 样本可用于回归。 */
export const fixtureL3DatasetReport: OfflineEvalReport = {
  ...REPORT_META,
  reportId: 'report-l3-dataset',
  sampleResults: [
    {
      sampleId: 'l3-001',
      targetGroup: 'draft_quality',
      label: 'L3 WBS',
      score: 1,
      scoreLabel: 'pass',
      explanation: 'L3 synthetic WBS generation correct',
    },
    {
      sampleId: 'l3-002',
      targetGroup: 'draft_quality',
      label: 'L3 Charter',
      score: 0,
      scoreLabel: 'fail',
      explanation: 'L3 synthetic charter missing sections',
    },
  ],
  summary: {
    totalSamples: 2,
    passCount: 1,
    failCount: 1,
    notEvaluatedCount: 0,
    improvedCount: 0,
    regressedCount: 0,
    unchangedCount: 0,
    hasBaseline: false,
  },
  contentHash: 'l3-dataset-hash',
}

// ── Fixture 5: 授权门未开 ────────────────────────────────────────────

/** 授权门未开报告：默认 fixture provider，零真实模型调用。 */
export const fixtureAuthGateNotOpenedReport: OfflineEvalReport = {
  ...REPORT_META,
  reportId: 'report-auth-gate-closed',
  sampleResults: [
    {
      sampleId: 'ir-001',
      targetGroup: 'intent_routing_accuracy',
      label: 'IR 001 (fixture)',
      score: 1,
      scoreLabel: 'pass',
      explanation: 'Fixture provider: no real model call',
    },
  ],
  summary: {
    totalSamples: 1,
    passCount: 1,
    failCount: 0,
    notEvaluatedCount: 0,
    improvedCount: 0,
    regressedCount: 0,
    unchangedCount: 0,
    hasBaseline: false,
  },
  contentHash: 'auth-gate-closed-hash',
}

// ── 五态汇总 ────────────────────────────────────────────────────────

/** 五态回归报告 fixtures 汇总。 */
export const offlineEvalReportFixtures = {
  fixtureAllPassReport,
  fixtureSingleSampleRegressionReport,
  fixtureMildOverallDeclineReport,
  fixtureL3DatasetReport,
  fixtureAuthGateNotOpenedReport,
  fixtureL3Samples,
} as const
