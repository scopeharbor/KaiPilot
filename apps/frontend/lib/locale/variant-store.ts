/**
 * 文字变体状态模块（纯 TS，无 React 依赖，可在任意模块安全 import）。
 * - localStorage key 固定 'aiproj-text-variant'，取值 'cn' | 'tw' | 'hk'；
 * - server 端一律视为 'cn'（SSR 恒输出简体，零 hydration mismatch）；
 * - setVariant 同步 <html lang> 与 data-text-variant 属性，并通知订阅者。
 */
export type TextVariant = 'cn' | 'tw' | 'hk'

/** 变体展示名（供设置面板等 UI 使用）。 */
export const VARIANT_LABELS: Record<TextVariant, string> = {
  cn: '简体中文',
  tw: '繁體中文（台灣）',
  hk: '繁體中文（香港）',
}

const STORAGE_KEY = 'aiproj-text-variant'

const HTML_LANG: Record<TextVariant, string> = {
  cn: 'zh-CN',
  tw: 'zh-TW',
  hk: 'zh-HK',
}

const listeners = new Set<() => void>()

function isTextVariant(value: string | null): value is TextVariant {
  return value === 'cn' || value === 'tw' || value === 'hk'
}

function readStoredVariant(): TextVariant | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isTextVariant(raw) ? raw : null
  } catch {
    // localStorage 不可用（隐私模式 / 被禁用）时视同未设置
    return null
  }
}

/** 当前变体：client 读 localStorage，server 恒回 'cn'。 */
export function getVariant(): TextVariant {
  return readStoredVariant() ?? 'cn'
}

/** SSR / useSyncExternalStore.getServerSnapshot 专用：恒为简体。 */
export function getServerVariant(): TextVariant {
  return 'cn'
}

/** 订阅变体变化，返回退订函数。 */
export function subscribeVariant(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 切换变体：写 localStorage、同步 <html lang> 与 data-text-variant，并通知订阅者。 */
export function setVariant(v: TextVariant): void {
  if (typeof window === 'undefined') return // server 端不写状态
  try {
    window.localStorage.setItem(STORAGE_KEY, v)
  } catch {
    // 存储不可用不阻断切换，html 属性与通知照常
  }
  document.documentElement.lang = HTML_LANG[v]
  document.documentElement.dataset.textVariant = v
  for (const fn of listeners) fn()
}
