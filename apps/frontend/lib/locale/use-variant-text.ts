'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getServerVariant, getVariant, subscribeVariant } from './variant-store'
import { loadTextConverters, loadedTextConverters, type TextConverters } from './text-convert'

/**
 * 当前文字变体 + 程序化转换（AI 写的内容落在输入框 / <pre> / 图里时用）。
 * - display(text)：简体 → 当前变体（简体界面原样返回）；
 * - canonical(text)：当前变体 → 简体（用户改过的值存回去前用）。
 * 转换器按需加载；加载完成前原样返回，加载后自动重渲染。
 */
export function useVariantText() {
  const variant = useSyncExternalStore(subscribeVariant, getVariant, getServerVariant)
  const [converters, setConverters] = useState<TextConverters | null>(() => loadedTextConverters())
  useEffect(() => {
    if (variant === 'cn' || converters) return
    let alive = true
    void loadTextConverters().then((loaded) => {
      if (alive) setConverters(loaded)
    })
    return () => {
      alive = false
    }
  }, [variant, converters])

  const display = useCallback(
    (text: string) => (variant === 'cn' || !converters ? text : converters.display(variant, text)),
    [variant, converters],
  )
  const canonical = useCallback(
    (text: string) =>
      variant === 'cn' || !converters ? text : converters.canonical(variant, text),
    [variant, converters],
  )
  return { variant, ready: variant === 'cn' || converters !== null, display, canonical }
}
