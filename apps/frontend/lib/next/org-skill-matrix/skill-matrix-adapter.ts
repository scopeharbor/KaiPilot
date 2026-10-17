/**
 * v3-ui-next-org-portfolio-domains W8 · tasks 8.1 —— 技能矩阵展示层纯函数适配器。
 *
 * 新轨技能矩阵工作台（/next/resources/skill-matrix，全局跨项目视角）的纯计算底座，
 * 语义对齐旧轨 `lib/resource-skill-matrix-ui.ts`（formatCoveragePercent /
 * formatCapacityHours / getGapSeverityColor / getGapSeverityLabel），零 UI、零网络、
 * 零 store 依赖：
 * - 覆盖率百分比与容量小时格式化（含负缺口小时语义：缺 N 小时）；
 * - 缺口严重度中文标签与语义色阶（双通道：颜色令牌 + 文字徽标类），颜色全部消费
 *   `app/(next)/next-tokens.css` 既有令牌变量，杜绝臆造令牌；chipClass 内 rgba 值
 *   为对应令牌色值的固定透明度展开（0.45 发丝边框 / 0.14 底色），与知识库适配器
 *   同款纪律；
 * - 覆盖率色阶（0.8 / 0.5 / 0.25 分档）与中文档位标签；
 * - 候选资源关键词匹配（命中资源名 / 角色 / 技能标签任一即命中）；
 * - fresh 来源中文标签（来源枚举同 @aiproj/types RESOURCE_SKILL_MATRIX_SOURCES）。
 */
import type { ResourceSkillGapSeverity, ResourceSkillMatrixSource } from '@aiproj/types'
import { RESOURCE_SKILL_GAP_SEVERITY_ORDER, RESOURCE_SKILL_MATRIX_SOURCES } from '@aiproj/types'

// ─── 缺口严重度语义映射 ──────────────────────────────────────────────────────

/** 缺口严重度中文标签（与旧轨 lib/resource-skill-matrix-ui 语义一致）。 */
export const GAP_SEVERITY_LABELS: Record<ResourceSkillGapSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  none: '无缺口',
}

/**
 * 缺口严重度令牌色（CSS var 字符串，供内联图形/描边消费）。
 * 色阶（冷色适配，来源 next-tokens.css 实码）：
 *   critical → --nx-status-danger #ef4444（警戒红）
 *   high     → --nx-status-warning #f59e0b（琥珀）
 *   medium   → --nx-workspace-blue #4f75ff（仪器蓝）
 *   low      → --nx-status-success #10b981（恢复绿）
 *   none     → --nx-text-muted #7a8ba1（中性）
 */
export const GAP_SEVERITY_COLORS: Record<ResourceSkillGapSeverity, string> = {
  critical: 'var(--nx-status-danger)',
  high: 'var(--nx-status-warning)',
  medium: 'var(--nx-workspace-blue)',
  low: 'var(--nx-status-success)',
  none: 'var(--nx-text-muted)',
}

/** 令牌色 → rgba 固定透明度展开（0.45 发丝边框 / 0.14 底色），双通道徽标类。 */
const GAP_SEVERITY_CHIP_BORDER_BG: Record<ResourceSkillGapSeverity, string> = {
  critical: 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)]',
  high: 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)]',
  medium: 'border-[rgba(79,117,255,0.45)] bg-[rgba(79,117,255,0.14)]',
  low: 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)]',
  none: 'border-[rgba(122,139,161,0.45)] bg-[rgba(122,139,161,0.14)]',
}

const GAP_SEVERITY_CHIP_TEXT: Record<ResourceSkillGapSeverity, string> = {
  critical: 'text-[var(--nx-status-danger)]',
  high: 'text-[var(--nx-status-warning)]',
  medium: 'text-[var(--nx-workspace-blue)]',
  low: 'text-[var(--nx-status-success)]',
  none: 'text-[var(--nx-text-muted)]',
}

/** 未知严重度中性回落（不臆造新色）。 */
const NEUTRAL_CHIP_CLASS =
  'border-[rgba(122,139,161,0.45)] bg-[rgba(122,139,161,0.14)] text-[var(--nx-text-muted)]'

/** 缺口严重度徽标类（双通道：颜色 + 文字）。 */
export function getGapSeverityChipClass(severity: ResourceSkillGapSeverity): string {
  return `${GAP_SEVERITY_CHIP_BORDER_BG[severity] ?? NEUTRAL_CHIP_CLASS} ${GAP_SEVERITY_CHIP_TEXT[severity] ?? 'text-[var(--nx-text-muted)]'}`
}

/** 缺口严重度中文标签（旧轨 getGapSeverityLabel 语义；未知原样回落）。 */
export function getGapSeverityLabel(severity: ResourceSkillGapSeverity): string {
  return GAP_SEVERITY_LABELS[severity] ?? severity
}

/** 缺口严重度令牌色（旧轨 getGapSeverityColor 语义；未知回落中性）。 */
export function getGapSeverityColor(severity: ResourceSkillGapSeverity): string {
  return GAP_SEVERITY_COLORS[severity] ?? 'var(--nx-text-muted)'
}

/** 缺口条目按严重度稳定排序（critical → none）。 */
export function sortGapsBySeverity<T extends { severity: ResourceSkillGapSeverity }>(
  gaps: readonly T[],
): T[] {
  return [...gaps].sort(
    (a, b) =>
      RESOURCE_SKILL_GAP_SEVERITY_ORDER[a.severity] - RESOURCE_SKILL_GAP_SEVERITY_ORDER[b.severity],
  )
}

// ─── 覆盖率格式化与色阶 ──────────────────────────────────────────────────────

/** 覆盖率百分比格式化（旧轨 formatCoveragePercent 语义：0.234 → '23%'）。 */
export function formatCoveragePercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** 容量小时格式化（旧轨 formatCapacityHours 语义：负数 → 「缺 N 小时」）。 */
export function formatCapacityHours(hours: number): string {
  if (hours < 0) return `缺 ${Math.abs(Math.round(hours))} 小时`
  return `${Math.round(hours)} 小时`
}

/** 覆盖率档位标签（双通道语义文案）。 */
export function getCoverageToneLabel(ratio: number): string {
  if (ratio >= 0.8) return '覆盖充足'
  if (ratio >= 0.5) return '覆盖一般'
  if (ratio >= 0.25) return '覆盖偏低'
  return '覆盖严重不足'
}

/** 覆盖率档位令牌色（健康 → 绿 / 一般 → 仪器蓝 / 偏低 → 琥珀 / 严重不足 → 警戒红）。 */
export function getCoverageToneColor(ratio: number): string {
  if (ratio >= 0.8) return 'var(--nx-status-success)'
  if (ratio >= 0.5) return 'var(--nx-workspace-blue)'
  if (ratio >= 0.25) return 'var(--nx-status-warning)'
  return 'var(--nx-status-danger)'
}

/** 覆盖率档位徽标类（颜色 + 文字双通道）。 */
export function getCoverageToneChipClass(ratio: number): string {
  if (ratio >= 0.8) {
    return 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)] text-[var(--nx-status-success)]'
  }
  if (ratio >= 0.5) {
    return 'border-[rgba(79,117,255,0.45)] bg-[rgba(79,117,255,0.14)] text-[var(--nx-workspace-blue)]'
  }
  if (ratio >= 0.25) {
    return 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]'
  }
  return 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)] text-[var(--nx-status-danger)]'
}

// ─── 候选资源关键词匹配 ──────────────────────────────────────────────────────

export interface SkillCandidateMatchInput {
  resourceName: string
  role: string
  skillTags: string[]
}

/**
 * 候选资源关键词匹配：任一关键词命中 资源名/角色/技能标签 即命中；
 * 关键词去空、大小写不敏感；空关键词列表恒命中（等价不过滤）。
 */
export function matchCandidateKeywords(
  candidate: SkillCandidateMatchInput,
  keywords: readonly string[],
): boolean {
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)
  if (normalized.length === 0) return true
  const haystack = [candidate.resourceName, candidate.role, ...(candidate.skillTags ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.toLowerCase())
  return normalized.every((keyword) => haystack.some((value) => value.includes(keyword)))
}

// ─── Fresh 来源标签 ──────────────────────────────────────────────────────────

/** fresh 来源中文标签（来源枚举同 @aiproj/types RESOURCE_SKILL_MATRIX_SOURCES）。 */
export const SKILL_SOURCE_LABELS: Record<ResourceSkillMatrixSource, string> = {
  [RESOURCE_SKILL_MATRIX_SOURCES.PROJECT_RESOURCE]: '项目资源',
  [RESOURCE_SKILL_MATRIX_SOURCES.TASK_REQUIREMENT]: '任务需求',
  [RESOURCE_SKILL_MATRIX_SOURCES.RESOURCE_LOAD]: '资源负载',
  [RESOURCE_SKILL_MATRIX_SOURCES.RESOURCE_CONFLICT]: '资源冲突',
  [RESOURCE_SKILL_MATRIX_SOURCES.SKILL_REGISTRY]: 'Skill 注册表',
  [RESOURCE_SKILL_MATRIX_SOURCES.RESOURCE_POOL]: '资源池',
}

/** fresh 来源中文标签（未知来源回落原值）。 */
export function getSkillSourceLabel(source: ResourceSkillMatrixSource): string {
  return SKILL_SOURCE_LABELS[source] ?? source
}

// ─── Warning 语义色阶 ───────────────────────────────────────────────────────

/** warning 严重度徽标类（info/warning/critical 三档，中性回落 info）。 */
export function getWarningToneChipClass(severity: 'info' | 'warning' | 'critical' | undefined) {
  if (severity === 'critical') {
    return 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)] text-[var(--nx-status-danger)]'
  }
  if (severity === 'warning') {
    return 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]'
  }
  return 'border-[rgba(122,139,161,0.45)] bg-[rgba(122,139,161,0.14)] text-[var(--nx-text-secondary)]'
}
