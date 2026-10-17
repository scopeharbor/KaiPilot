/**
 * JS 滚动行为统一封装（v3-motion-fallback-closure D4 / spec「JS 平滑滚动尊重减弱动效偏好」）。
 *
 * `behavior` 是脚本参数，`app/globals.css` 的 `scroll-behavior: auto !important` 兜底
 * 管不到它，因此每个 `scrollTo` / `scrollIntoView` 调用点都必须经这里解析取值：
 * 减弱动效为真 → 立即滚动（`'auto'`），否则保持平滑（`'smooth'`，现状行为）。
 */
export function resolveScrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? 'auto' : 'smooth'
}
