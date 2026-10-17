/**
 * 甘特渲染核 —— 配色与令牌桥接。
 *
 * 铁律（globals.css / CLAUDE.md 前端约定）：**零硬编码色值**，一律引用设计令牌 CSS 变量。
 * - SVG 层：直接 `fill/stroke="var(--token)"`，主题随 `[data-mode]` 级联。
 * - Canvas 层：无法吃 CSS 变量，须用 `resolveGanttTokens()` 在绘制前把令牌解析为具体色值，
 *   并在主题切换时重新解析（design D4：依赖线 Canvas 层保留隐藏 DOM/ARIA，但像素颜色来自令牌解析）。
 *
 * 配色克制（研究简报 §1）：任务条按**六状态语义色**着色（禁止每任务一色），依赖线默认极弱、
 * 仅关键路径/悬停链高亮，避免蛛网淹没主链。
 */

import type { TaskStatus } from '@/lib/api/tasks'
import type { MilestoneStatus } from '@/lib/api/milestones'

/** 六状态 → 语义色令牌（原始变量名，不含 `var()`）。 */
export const STATUS_TOKEN: Record<TaskStatus, string> = {
  completed: '--success',
  in_progress: '--in-progress',
  not_started: '--gray-400',
  blocked: '--danger',
  on_hold: '--warning',
  cancelled: '--gray-300',
}

/**
 * 里程碑五状态 → 语义色令牌（复用既有语义色，零硬编码）。供菱形按状态着色（6.3）：
 * planned=进行中蓝、at_risk=警示黄、achieved=成功绿、missed=危险红、not_started=灰。
 */
export const MILESTONE_STATUS_TOKEN: Record<MilestoneStatus, string> = {
  not_started: '--gray-400',
  planned: '--in-progress',
  at_risk: '--warning',
  achieved: '--success',
  missed: '--danger',
}

/** 里程碑状态填充令牌（供 SVG `fill`）。 */
export function milestoneStatusVar(status: MilestoneStatus): string {
  return svgVar(MILESTONE_STATUS_TOKEN[status])
}

/** 依赖线令牌。默认极弱 muted；关键路径/问题链/悬停链才提亮。 */
export const DEPENDENCY_TOKEN = {
  /** 标准入口视口内极弱常显。 */
  muted: '--gray-300',
  /** 关键路径常显（两入口）。 */
  critical: '--danger',
  /** 问题链（受阻/逾期）常显。 */
  problem: '--warning',
  /** 悬停/选中链高亮。 */
  highlight: '--primary-500',
  /** 越界聚合徽标。 */
  aggregate: '--primary-500',
} as const

/** 汇总（rollup）条与今日线令牌。 */
export const STRUCTURE_TOKEN = {
  summaryBar: '--gray-700',
  milestone: '--in-progress',
  baseline: '--gray-500',
  todayLine: '--danger',
  weekendShade: '--gray-100',
  gridLine: '--border',
  gridLineStrong: '--border-strong',
  barTrack: '--gray-200',
} as const

/** 令牌 → SVG 可用的 `var()` 引用。 */
export function svgVar(token: string): string {
  return `var(${token})`
}

/** 任务条填充令牌（供 SVG `fill`）。 */
export function statusVar(status: TaskStatus): string {
  return svgVar(STATUS_TOKEN[status])
}

/**
 * 在给定根元素（默认 `document.documentElement`）上把一组令牌解析为具体色值，
 * 供 Canvas 绘制。主题切换（`data-mode` 变化）后须重新调用以刷新缓存。
 */
export function resolveTokens(tokens: readonly string[], root?: Element): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof window === 'undefined' || typeof getComputedStyle === 'undefined') {
    return out
  }
  const el = root ?? document.documentElement
  const style = getComputedStyle(el)
  for (const token of tokens) {
    out[token] = style.getPropertyValue(token).trim()
  }
  return out
}

/** 一次性解析依赖线 Canvas 层所需的全部令牌。 */
export function resolveDependencyTokens(root?: Element): Record<string, string> {
  return resolveTokens(
    [
      DEPENDENCY_TOKEN.muted,
      DEPENDENCY_TOKEN.critical,
      DEPENDENCY_TOKEN.problem,
      DEPENDENCY_TOKEN.highlight,
      DEPENDENCY_TOKEN.aggregate,
    ],
    root,
  )
}
