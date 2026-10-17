/**
 * PMO 优先级评分 —— 等级双通道视觉元数据（域内私有）。
 *
 * v3-ui-next-pmo-domain W4 · tasks 4.2 —— 优先级评分只读工作台域文件。
 *
 * 色相一律从 `--nx-*` 令牌展开（next-tokens.css），背景为令牌数值的固定透明度
 * 展开（与 org-bi heatMeta 同一暗黑仪器感 idiom）；文案通道取 @aiproj/types 的
 * `PRIORITY_LEVEL_LABELS`。禁止在组件内硬编码色值。
 */

const DANGER_HEX = '#ef4444' // --nx-status-danger
const WARNING_HEX = '#f59e0b' // --nx-status-warning
const CAUTION_HEX = '#fbbf24' // --nx-chart-4
const SUCCESS_HEX = '#10b981' // --nx-status-success
const NEUTRAL_HEX = '#7a8ba1' // --nx-text-muted

/** 语义档位（组件据此绑定令牌）。 */
export type PriorityLevelTone = 'danger' | 'warning' | 'caution' | 'success' | 'neutral'

export interface PriorityLevelVisualMeta {
  /** 语义档位。 */
  tone: PriorityLevelTone
  /** 前景令牌（CSS 变量引用）。 */
  token: string
  /** 背景固定透明度展开。 */
  bg: string
  /** 边框/描边令牌。 */
  border: string
  /** 圆点色令牌（图例/过滤 chips）。 */
  dot: string
}

function levelMeta(tone: PriorityLevelTone, hex: string, bgAlpha: number): PriorityLevelVisualMeta {
  const tokenByName: Record<PriorityLevelTone, string> = {
    danger: 'var(--nx-status-danger)',
    warning: 'var(--nx-status-warning)',
    caution: 'var(--nx-chart-4)',
    success: 'var(--nx-status-success)',
    neutral: 'var(--nx-text-muted)',
  }
  const token = tokenByName[tone]
  return {
    tone,
    token,
    bg: `rgba(${hexToRgbTriple(hex)}, ${bgAlpha})`,
    border: tone === 'neutral' ? 'var(--nx-border-hairline)' : token,
    dot: token,
  }
}

function hexToRgbTriple(hex: string): string {
  const normalized = hex.replace('#', '')
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

/** 五个等级 → 双通道视觉元数据（PRIORITY_LEVELS：critical/high/medium/low/unranked）。 */
export const PRIORITY_LEVEL_VISUAL: Record<string, PriorityLevelVisualMeta> = {
  critical: levelMeta('danger', DANGER_HEX, 0.18),
  high: levelMeta('warning', WARNING_HEX, 0.14),
  medium: levelMeta('caution', CAUTION_HEX, 0.12),
  low: levelMeta('success', SUCCESS_HEX, 0.1),
  unranked: levelMeta('neutral', NEUTRAL_HEX, 0.08),
}

export function priorityLevelVisual(level: string): PriorityLevelVisualMeta {
  return PRIORITY_LEVEL_VISUAL[level] ?? levelMeta('neutral', NEUTRAL_HEX, 0.08)
}
