'use client'

import { useCallback, useState } from 'react'

/**
 * 复制代码 hook（v3-document-code-block-support §4.3）。
 *
 * - 优先 `navigator.clipboard.writeText`
 * - 降级 textarea + execCommand
 * - 纯客户端、无网络请求
 * - 成功/失败有可见反馈
 */

export interface UseCopyCodeReturn {
  copied: boolean
  error: string | null
  copy: (text: string) => Promise<void>
  resetCopy: () => void
}

export function useCopyCode(): UseCopyCodeReturn {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const copy = useCallback(async (text: string) => {
    setError(null)
    setCopied(false)

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        return
      }

      // 降级路径：textarea + execCommand
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.top = '-9999px'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()

      const success = document.execCommand('copy')
      document.body.removeChild(textarea)

      if (success) {
        setCopied(true)
      } else {
        throw new Error('execCommand 复制失败')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '复制失败'
      setError(message)
    }
  }, [])

  const resetCopy = useCallback(() => {
    setCopied(false)
    setError(null)
  }, [])

  return { copied, error, copy, resetCopy }
}
