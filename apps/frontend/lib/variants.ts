/**
 * 组件基类与变体约定（tasks 4.1）。
 * - 统一 focus ring：可交互组件键盘聚焦显 `--shadow-focus`（AI 元素用 `--shadow-ai`）；
 *   不依赖颜色单通道传达聚焦。
 * - 统一禁用态、错误态（aria-invalid 驱动 danger ring + shake）。
 * - 触摸目标 ≥36px 由各组件 `size=default` 的 `h-9` 保证。
 */

/** 键盘可见 focus ring（3px 蓝）。 */
export const focusRing = 'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]'

/** AI 元素 focus ring（3px 紫）。 */
export const aiFocusRing = 'focus-visible:outline-none focus-visible:shadow-[var(--shadow-ai)]'

/** 禁用态：灰化 + 禁用光标 + 阻断指针。 */
export const disabledCls =
  'disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed'

/** 错误态（aria-invalid=true）：danger 边框 + danger ring + 一次 shake。 */
export const invalidCls =
  'aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[0_0_0_3px_rgba(220,38,38,0.18)] aria-[invalid=true]:animate-shake'
