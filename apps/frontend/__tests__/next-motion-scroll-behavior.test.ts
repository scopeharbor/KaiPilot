/**
 * v3-motion-fallback-closure tasks 1.2 —— 滚动行为统一封装纯函数测试。
 *
 * `behavior` 是脚本参数，CSS 的 `scroll-behavior: auto !important` 兜底管不到它；
 * 全部 `scrollTo` / `scrollIntoView` 调用点统一经此解析取值（spec「JS 平滑滚动尊重
 * 减弱动效偏好」取值来源条款）。
 */
import { describe, expect, test } from 'vitest'
import { resolveScrollBehavior } from '@/lib/next/motion/scroll-behavior'

describe('lib/next/motion/scroll-behavior（tasks 1.1）', () => {
  test('减弱动效为真 → 立即滚动（auto），不做平滑动画', () => {
    expect(resolveScrollBehavior(true)).toBe('auto')
  })

  test('减弱动效为假 → 保持平滑滚动（smooth，与现状行为一致）', () => {
    expect(resolveScrollBehavior(false)).toBe('smooth')
  })

  test('返回值类型为 ScrollBehavior（可直接传给 scrollTo / scrollIntoView）', () => {
    const behavior: ScrollBehavior = resolveScrollBehavior(false)
    expect(behavior).toBe('smooth')
  })
})
