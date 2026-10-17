import { createJSONStorage, type PersistStorage, type StorageValue } from 'zustand/middleware'

/**
 * 合并写入的 sessionStorage 持久化（2026-09-28）。
 *
 * zustand persist 每次 set 都把白名单里的整份状态（草案、项目上下文、追问会话……几十 KB）
 * 序列化写一次。生成时模型每吐一个片段就 set 一次，几千个片段就是几千次整份序列化——
 * 实测页面在生成后半段与重连回放时完全卡死。这里只记下最新值，`delayMs` 后写一次；
 * 读同名键时先返回尚未写入的最新值，页面隐藏 / 关闭前立即写入，刷新不丢。
 */
export function throttledSessionStorage<S>(delayMs = 500): PersistStorage<S> | undefined {
  const json = createJSONStorage<S>(() => sessionStorage)
  if (!json) return undefined
  let pending: { name: string; value: StorageValue<S> } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    const next = pending
    pending = null
    if (next) void json.setItem(next.name, next.value)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  }
  return {
    getItem: (name) => (pending?.name === name ? pending.value : json.getItem(name)),
    setItem: (name, value) => {
      if (pending && pending.name !== name) flush()
      pending = { name, value }
      if (!timer) timer = setTimeout(flush, delayMs)
    },
    removeItem: (name) => {
      if (pending?.name === name) pending = null
      return json.removeItem(name)
    },
  }
}
