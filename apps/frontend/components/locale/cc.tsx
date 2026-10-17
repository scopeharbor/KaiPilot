'use client'

import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { getServerVariant, getVariant, subscribeVariant } from '@/lib/locale/variant-store'
import { registerConvertedOutput } from '@/lib/locale/dom-converter'

/**
 * 文本变体切换原语（由构建期 cc-loader 生成调用）。
 * - getServerSnapshot 恒回 'cn'：SSR 始终输出简体，零 hydration mismatch；
 * - client 端按当前变体直接返回对应字符串，不包裹任何 DOM 元素；
 * - 渲染 tw/hk 产物时注册为可信输出：OpenCC 对繁体输入非幂等
 *   （twp('儀表板')='儀錶板'），注册后 runtime DOM 层的 observer 遇到
 *   同值会直接跳过，避免二次转换腐蚀。
 */
export default function CC({ s, tw, hk }: { s: string; tw: string; hk: string }): ReactNode {
  const variant = useSyncExternalStore(subscribeVariant, getVariant, getServerVariant)
  if (variant === 'tw') {
    registerConvertedOutput(tw)
    return tw
  }
  if (variant === 'hk') {
    registerConvertedOutput(hk)
    return hk
  }
  return s
}
