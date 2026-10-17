/**
 * 测试替身的类型标注工具。
 *
 * 测试里的 mock 往往只提供组件真正读到的那几个字段（例如 TanStack Query 的
 * `UseQueryResult` 有二十多个字段，测试只关心 `data`/`isLoading`/`error`），
 * 直接传结构子集会被 TS 拒绝。以前的写法是 `{...} as any`，代价是这个位置的
 * 类型检查被整段关掉——字段名写错、契约改了字段类型，测试都不会报。
 *
 * `asMock` 只把「结构子集 → 完整类型」这一步的检查让掉：目标类型 `T` 由调用位置
 * 的上下文（`mockReturnValue` 的形参类型）推断出来，仍然是具体类型而不是 `any`，
 * 后续对返回值的使用照常受检。
 */

import type * as React from 'react'

/** 把一个字段子集标注成调用位置期望的完整类型。 */
export function asMock<T>(partial: unknown): T {
  return partial as T
}

/**
 * `vi.mock` 工厂里 UI 桩组件的 props。
 *
 * 只列桩件真正读到的字段——解构一个不存在的字段会被 TS 拒绝，这正是原来
 * `: any` 拿不到的保护。继承 `HTMLAttributes` 是为了 `{...rest}` 能直接摊到
 * div/span 上（页面会给卡片挂 role/aria-label 之类的可访问性属性）。
 *
 * 类型引用会被编译期擦除，因此在被提升（hoist）的 `vi.mock` 工厂里引用它是安全的，
 * 不会触发 "Cannot access before initialization"。
 */
export interface StubProps extends React.HTMLAttributes<HTMLElement> {
  variant?: string
  size?: string
  value?: string
  open?: boolean
  disabled?: boolean
}
