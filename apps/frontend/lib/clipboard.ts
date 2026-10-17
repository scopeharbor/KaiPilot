/**
 * 剪贴板写入助手（统一降级路径）。
 *
 * 优先 `navigator.clipboard.writeText`；窗口失焦等场景下该 API 会抛
 * `NotAllowedError: Document is not focused`，此时降级为 textarea +
 * `document.execCommand('copy')`。返回是否复制成功，任何情况下不向外抛异常，
 * 调用方不会产生未捕获的 Promise rejection。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 写入被拒绝（如文档未聚焦）或 API 异常：落入降级路径
    }
  }

  if (typeof document === 'undefined') return false

  try {
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
    return success
  } catch {
    return false
  }
}
