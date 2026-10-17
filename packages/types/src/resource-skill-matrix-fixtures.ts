// @aiproj/types - Resource Skill Matrix test fixtures.
// v3-resource-skill-matrix: deterministic fixtures for coverage, gaps, advisory, and edge cases.

import type {
  ResourceCandidateSummary,
  ResourceSkillMatrixFreshness,
  ResourceSkillMatrixMeta,
  ResourceSkillMatrixResponse,
  ResourceSkillMatrixRow,
  ResourceSkillMatrixSummaryResponse,
  ResourceSkillMatrixWarning,
  SkillAdvisoryCandidate,
  SkillCoverageSummary,
  SkillGapEntry,
} from './resource-skill-matrix.js'

import {
  RESOURCE_SKILL_GAP_SEVERITIES,
  RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY,
  RESOURCE_SKILL_MATRIX_METRIC_VERSION,
  RESOURCE_SKILL_MATRIX_SOURCES,
  RESOURCE_SKILL_MATRIX_WARNING_CODES,
} from './resource-skill-matrix.js'

// ─── Static Skill Tags ──────────────────────────────────────────────────────

export const FIXTURE_RAW_SKILL_TAGS_DUPLICATE = [' React ', 'react', 'REACT']
export const FIXTURE_RAW_SKILL_TAGS_SPACED = ['  Vue  ', ' vue', 'VUE JS']
export const FIXTURE_RAW_SKILL_TAGS_FULLWIDTH = ['Ｐｙｔｈｏｎ', 'Python', 'python']
export const FIXTURE_RAW_SKILL_TAGS_EMPTY = ['', ' ', '', 'React']
export const FIXTURE_RAW_SKILL_TAGS_BLANK = [] as const

// ─── Coverage Fixtures ──────────────────────────────────────────────────────

export const FIXTURE_SKILL_COVERAGE_FULL: SkillCoverageSummary = {
  skillKey: 'react',
  totalResources: 5,
  skilledResources: 5,
  totalAvailableCapacityHours: 200,
  totalAllocatedCapacityHours: 100,
  coverageRatio: 0.67,
  resourceCoverageRatio: 1.0,
}

export const FIXTURE_SKILL_COVERAGE_PARTIAL: SkillCoverageSummary = {
  skillKey: 'vue',
  totalResources: 10,
  skilledResources: 3,
  totalAvailableCapacityHours: 40,
  totalAllocatedCapacityHours: 120,
  coverageRatio: 0.25,
  resourceCoverageRatio: 0.3,
}

export const FIXTURE_SKILL_COVERAGE_ZERO: SkillCoverageSummary = {
  skillKey: 'rust',
  totalResources: 10,
  skilledResources: 0,
  totalAvailableCapacityHours: 0,
  totalAllocatedCapacityHours: 0,
  coverageRatio: 0,
  resourceCoverageRatio: 0,
}

export const FIXTURE_SKILL_COVERAGES: SkillCoverageSummary[] = [
  FIXTURE_SKILL_COVERAGE_FULL,
  FIXTURE_SKILL_COVERAGE_PARTIAL,
  FIXTURE_SKILL_COVERAGE_ZERO,
]

// ─── Gap Fixtures ───────────────────────────────────────────────────────────

export const FIXTURE_GAP_CRITICAL: SkillGapEntry = {
  skillKey: 'rust',
  severity: RESOURCE_SKILL_GAP_SEVERITIES.CRITICAL,
  requirementCount: 5,
  requiredCapacityHours: 200,
  availableCapacityHours: 0,
  gapCapacityHours: 200,
  requirementSourceRefs: ['task_req:rust-backend:req-1', 'task_req:rust-api:req-2'],
  recoverySuggestion: '建议为技能 rust 补充资源或调整任务需求',
  warnings: [
    {
      code: RESOURCE_SKILL_MATRIX_WARNING_CODES.NO_CANDIDATE_FOR_REQUIREMENT,
      message: '当前无可见资源具备该技能',
      skillKey: 'rust',
      severity: 'critical',
    },
  ],
}

export const FIXTURE_GAP_HIGH: SkillGapEntry = {
  skillKey: 'typescript',
  severity: RESOURCE_SKILL_GAP_SEVERITIES.HIGH,
  requirementCount: 8,
  requiredCapacityHours: 320,
  availableCapacityHours: 120,
  gapCapacityHours: 200,
  requirementSourceRefs: ['task_req:ts-frontend:req-3'],
  warnings: [],
}

export const FIXTURE_GAP_MEDIUM: SkillGapEntry = {
  skillKey: 'go',
  severity: RESOURCE_SKILL_GAP_SEVERITIES.MEDIUM,
  requirementCount: 3,
  requiredCapacityHours: 100,
  availableCapacityHours: 55,
  gapCapacityHours: 45,
  requirementSourceRefs: ['task_req:go-micro:req-4'],
  warnings: [],
}

export const FIXTURE_GAP_NONE: SkillGapEntry = {
  skillKey: 'react',
  severity: RESOURCE_SKILL_GAP_SEVERITIES.NONE,
  requirementCount: 0,
  requiredCapacityHours: 0,
  availableCapacityHours: 160,
  gapCapacityHours: 0,
  requirementSourceRefs: [],
  warnings: [],
}

// ─── Candidate Fixtures ─────────────────────────────────────────────────────

export const FIXTURE_CANDIDATE_RESOURCE: ResourceCandidateSummary = {
  resourceId: 1,
  resourceName: '张三',
  role: 'team_lead',
  availableCapacityHours: 40,
  allocatedCapacityHours: 20,
  remainingCapacityHours: 20,
  skillTags: ['react', 'typescript'],
  matchScore: 85,
  conflictSummary: [],
}

export const FIXTURE_CANDIDATE_OVERLOADED: ResourceCandidateSummary = {
  resourceId: 2,
  resourceName: '李四（过载）',
  role: 'member',
  availableCapacityHours: 5,
  allocatedCapacityHours: 35,
  remainingCapacityHours: -5,
  skillTags: ['vue'],
  matchScore: 50,
  conflictSummary: ['超过可用容量'],
}

// ─── Skill Advisory Fixtures ────────────────────────────────────────────────

export const FIXTURE_SKILL_ADVISORY_ACTIVE: SkillAdvisoryCandidate = {
  skillName: '敏捷项目管理',
  skillKey: 'skill-pm-agile',
  skillVersion: '1.0.0',
  skillStatus: 'active',
  skillCategory: 'program_management',
  matchedTags: ['agile', 'scrum'],
  matchReason: '技能缺口与 active Skill 的领域标签匹配',
  evaluationOnly: false,
  advisoryOnly: true,
  activationApplied: false,
  drillDownUrl: '/organization/1/skills/skill-pm-agile',
}

export const FIXTURE_SKILL_ADVISORY_EVAL: SkillAdvisoryCandidate = {
  skillName: '数据项目',
  skillKey: 'skill-data-project',
  skillVersion: '1.0.0',
  skillStatus: 'eval',
  skillCategory: 'data_engineering',
  matchedTags: ['data', 'pipeline'],
  matchReason: '技能缺口与评审中 Skill 的标签匹配',
  evaluationOnly: true,
  advisoryOnly: true,
  activationApplied: false,
  drillDownUrl: '/organization/1/skills/skill-data-project',
}

export const FIXTURE_SKILL_ADVISORY_FORBIDDEN: SkillAdvisoryCandidate = {
  skillName: '',
  skillKey: '',
  skillVersion: '',
  skillStatus: '',
  matchedTags: [],
  matchReason: '',
  evaluationOnly: false,
  advisoryOnly: true,
  activationApplied: false,
  drillDownUrl: null,
}

// ─── Warning Fixtures ───────────────────────────────────────────────────────

export const FIXTURE_WARNING_CACHE_DEGRADED: ResourceSkillMatrixWarning = {
  code: RESOURCE_SKILL_MATRIX_WARNING_CODES.CACHE_DEGRADED,
  message: '资源技能矩阵派生缓存当前不可用，已直接按来源事实计算',
  severity: 'info',
}

export const FIXTURE_WARNING_SKILL_ADVISORY_FORBIDDEN: ResourceSkillMatrixWarning = {
  code: RESOURCE_SKILL_MATRIX_WARNING_CODES.SKILL_ADVISORY_FORBIDDEN,
  message: '无 Skill 查看权限，Skill advisory 已脱敏',
  severity: 'warning',
}

export const FIXTURE_WARNING_AI_UNAVAILABLE: ResourceSkillMatrixWarning = {
  code: RESOURCE_SKILL_MATRIX_WARNING_CODES.AI_UNAVAILABLE,
  message: 'AI 服务不可用，技能解释草案无法生成',
  severity: 'info',
}

// ─── Freshness Fixtures ─────────────────────────────────────────────────────

export const FIXTURE_FRESHNESS_RESOURCE: ResourceSkillMatrixFreshness = {
  source: RESOURCE_SKILL_MATRIX_SOURCES.PROJECT_RESOURCE,
  lastUpdatedAt: '2026-07-28T10:00:00.000Z',
  stale: false,
}

export const FIXTURE_FRESHNESS_STALE: ResourceSkillMatrixFreshness = {
  source: RESOURCE_SKILL_MATRIX_SOURCES.TASK_REQUIREMENT,
  lastUpdatedAt: '2026-01-01T00:00:00.000Z',
  stale: true,
  staleReason: '数据超过 30 天未更新',
}

// ─── Meta Fixtures ──────────────────────────────────────────────────────────

export const FIXTURE_META: ResourceSkillMatrixMeta = {
  calculatedAt: '2026-07-29T00:00:00.000Z',
  metricVersion: RESOURCE_SKILL_MATRIX_METRIC_VERSION,
  organizationId: 1,
  actorId: 1,
  scope: 'organization',
  visibleProjectCount: 5,
  visibleResourceCount: 20,
  visibleRequirementCount: 30,
  visibleSkillCount: 8,
  dateWindow: { from: '2026-06-29', to: '2026-07-29' },
  sourceFreshness: [FIXTURE_FRESHNESS_RESOURCE],
  inputSignatureHash: 'a1b2c3d4',
}

// ─── Matrix Row Fixtures ────────────────────────────────────────────────────

export const FIXTURE_MATRIX_ROW: ResourceSkillMatrixRow = {
  skillKey: 'react',
  skillLabel: 'React',
  resourceCount: 5,
  totalAvailableCapacityHours: 200,
  totalAllocatedCapacityHours: 100,
  remainingCapacityHours: 100,
  requirementCount: 3,
  requiredCapacityHours: 150,
  coverageRatio: 0.67,
  gapSeverity: 'medium',
  candidateResources: [FIXTURE_CANDIDATE_RESOURCE],
  skillAdvisory: [],
  conflictSummary: [],
  evidenceRefs: [
    {
      source: RESOURCE_SKILL_MATRIX_SOURCES.PROJECT_RESOURCE,
      refSeed: 'resource:react:1',
      valueSummary: '5 个资源 / 200h 可用',
      visibility: RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY.LOW_SENSITIVITY,
      lastUpdatedAt: '2026-07-28T10:00:00.000Z',
    },
  ],
  warnings: [],
}

// ─── Full Response Fixtures ─────────────────────────────────────────────────

export const FIXTURE_SUMMARY_RESPONSE: ResourceSkillMatrixSummaryResponse = {
  meta: FIXTURE_META,
  overallCoverageRatio: 0.65,
  totalGaps: 3,
  totalCandidateResources: 15,
  totalSkillAdvisories: 2,
  coverageBySkill: FIXTURE_SKILL_COVERAGES,
  criticalGaps: [FIXTURE_GAP_CRITICAL],
  warnings: [],
}

export const FIXTURE_MATRIX_RESPONSE: ResourceSkillMatrixResponse = {
  meta: FIXTURE_META,
  rows: [FIXTURE_MATRIX_ROW],
  warnings: [],
}

export const FIXTURE_EMPTY_RESPONSE: ResourceSkillMatrixSummaryResponse = {
  meta: {
    ...FIXTURE_META,
    visibleProjectCount: 0,
    visibleResourceCount: 0,
    visibleRequirementCount: 0,
    visibleSkillCount: 0,
    sourceFreshness: [],
  },
  overallCoverageRatio: 0,
  totalGaps: 0,
  totalCandidateResources: 0,
  totalSkillAdvisories: 0,
  coverageBySkill: [],
  criticalGaps: [],
  warnings: [],
}
