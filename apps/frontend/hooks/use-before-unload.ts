'use client'

import { useEffect } from 'react'

/**
 * 浏览器刷新/关闭前拦截。当 shouldBlock() 返回 true 时，浏览器弹出原生确认框。
 *
 * 注意：现代浏览器忽略自定义消息，显示默认文本。
 */
export function useBeforeUnload(shouldBlock: () => boolean, _message?: string) {
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (shouldBlock()) {
        event.preventDefault()
        // 现代浏览器忽略自定义消息
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [shouldBlock])
}
