import type {
  ResourceSkillGapSeverity,
  ResourceSkillMatrixScope,
  ResourceSkillMatrixGroupBy,
  ResourceSkillMatrixSortField,
  ResourceSkillMatrixWarningCode,
  SkillCoverageSummary,
  SkillGapEntry,
  ResourceSkillMatrixRow,
  SkillAdvisoryCandidate,
  ResourceSkillMatrixWarning,
} from '@aiproj/types'

// ─── Labels ─────────────────────────────────────────────────────────────────

export const RESOURCE_SKILL_MATRIX_SCOPE_LABELS: Record<ResourceSkillMatrixScope, string> = {
  organization: '组织级',
  project: '项目级',
}

export const RESOURCE_SKILL_MATRIX_GROUP_BY_LABELS: Record<ResourceSkillMatrixGroupBy, string> = {
  skill: '按技能',
  resource: '按资源',
  project: '按项目',
  role: '按角色',
}

export const RESOURCE_SKILL_MATRIX_SORT_LABELS: Record<ResourceSkillMatrixSortField, string> = {
  coverage: '覆盖率',
  skill_key: '技能键',
  resource_name: '资源名',
  project_name: '项目名',
  gap_severity: '缺口严重度',
  available_capacity: '可用容量',
  skill_name: '技能名',
}

export const RESOURCE_SKILL_GAP_SEVERITY_LABELS: Record<ResourceSkillGapSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  none: '无缺口',
}

export const RESOURCE_SKILL_GAP_SEVERITY_COLORS: Record<ResourceSkillGapSeverity, string> = {
  critical: '#DC2626',
  high: '#D97706',
  medium: '#2563EB',
  low: '#16A34A',
  none: '#64748B',
}

export const RESOURCE_SKILL_MATRIX_WARNING_LABELS: Record<ResourceSkillMatrixWarningCode, string> =
  {
    DATA_PARTIALLY_REDACTED: '部分数据已脱敏',
    SKILL_ADVISORY_FORBIDDEN: '无 Skill 查看权限',
    RESOURCE_DETAIL_FORBIDDEN: '无资源详情权限',
    NORMALIZATION_AMBIGUOUS: '技能标签存在歧义',
    LOW_CONFIDENCE_ALIAS: '别名置信度较低',
    UNMATCHED_SKILL: '未匹配到技能',
    STALE_RESOURCE_DATA: '资源数据过旧',
    STALE_SKILL_DATA: 'Skill 数据过旧',
    CAPACITY_INSUFFICIENT: '容量不足',
    OVERALLOCATED_RESOURCE: '资源过载',
    NO_CANDIDATE_FOR_REQUIREMENT: '无候选资源',
    CONFLICT_DETECTED: '检测到冲突',
    CACHE_DEGRADED: '缓存降级',
    AI_UNAVAILABLE: 'AI 不可用',
    PARTIAL_ORGANIZATION_SCOPE: '部分组织数据不可见',
    RESOURCE_POOL_UNAVAILABLE: '资源池不可用',
  }

// ─── Format Helpers ─────────────────────────────────────────────────────────

export function formatCoveragePercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

export function formatCapacityHours(hours: number): string {
  if (hours < 0) return `缺 ${Math.abs(Math.round(hours))} 小时`
  return `${Math.round(hours)} 小时`
}

export function getGapSeverityColor(severity: ResourceSkillGapSeverity): string {
  return RESOURCE_SKILL_GAP_SEVERITY_COLORS[severity] ?? '#64748B'
}

export function getGapSeverityLabel(severity: ResourceSkillGapSeverity): string {
  return RESOURCE_SKILL_GAP_SEVERITY_LABELS[severity] ?? severity
}

// ─── Derived Computations ───────────────────────────────────────────────────

export function computeOverallCoverage(coverageBySkill: SkillCoverageSummary[]): number {
  if (coverageBySkill.length === 0) return 0
  const sum = coverageBySkill.reduce((acc, cov) => acc + cov.coverageRatio, 0)
  return Math.round((sum / coverageBySkill.length) * 100) / 100
}

export function countGapsBySeverity(
  gaps: SkillGapEntry[],
  severity: ResourceSkillGapSeverity,
): number {
  return gaps.filter((gap) => gap.severity === severity).length
}

export function isAdvisoryOnly(advisory: SkillAdvisoryCandidate): boolean {
  return advisory.advisoryOnly === true && advisory.activationApplied === false
}

export function hasWarnings(
  row: ResourceSkillMatrixRow,
  code?: ResourceSkillMatrixWarningCode,
): boolean {
  if (code) return row.warnings.some((warning) => warning.code === code)
  return row.warnings.length > 0
}

export function getWarningCountBySeverity(
  warnings: ResourceSkillMatrixWarning[],
  severity: 'info' | 'warning' | 'critical',
): number {
  return warnings.filter((warning) => warning.severity === severity).length
}
