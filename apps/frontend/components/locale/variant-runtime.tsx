'use client'

import { useEffect } from 'react'
import { getVariant, subscribeVariant } from '@/lib/locale/variant-store'
import { createDomConverter, type DomConverter } from '@/lib/locale/dom-converter'

/**
 * 运行时变体转换挂载点：订阅变体状态，tw/hk 启动 DOM 转换，cn 停止并还原。
 * SSR 端渲染为空，不做任何 DOM 操作；由根布局在 client hydration 后挂载。
 */
export default function VariantRuntime(): null {
  useEffect(() => {
    let converter: DomConverter | null = null
    let activeVariant: 'tw' | 'hk' | null = null

    function teardown(): void {
      if (converter) {
        converter.stop() // 先断开观察器再还原，避免还原被当作外部写入重新转换
        converter.restore()
        converter = null
      }
      activeVariant = null
    }

    function sync(): void {
      const variant = getVariant()
      if (variant === 'cn') {
        teardown()
        return
      }
      if (variant === activeVariant) return
      teardown()
      activeVariant = variant
      converter = createDomConverter(variant)
      void converter.start().catch((err) => {
        // 转换器加载失败不应拖垮页面；保留错误可见性便于排查
        console.error('[locale] DOM 转换启动失败:', err)
      })
    }

    sync() // 挂载时按当前变体启动
    const unsubscribe = subscribeVariant(sync)
    return () => {
      unsubscribe()
      teardown()
    }
  }, [])

  return null
}
