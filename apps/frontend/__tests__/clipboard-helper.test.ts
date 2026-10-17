/**
 * 剪贴板写入助手（lib/clipboard）契约测试：
 * 1. navigator.clipboard.writeText 成功时直接返回 true；
 * 2. writeText 抛 NotAllowedError（如文档失焦）时降级 execCommand 且不向外抛异常；
 * 3. 无 clipboard API 时走降级路径；
 * 4. 全链路降级失败时返回 false（调用方不会产生未捕获 rejection）。
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { copyTextToClipboard } from '@/lib/clipboard'

/** jsdom 未实现 document.execCommand，直接赋桩（afterEach 删除）。 */
function stubExecCommand(returns: boolean) {
  const execCommand = vi.fn().mockReturnValue(returns)
  Object.defineProperty(document, 'execCommand', {
    value: execCommand,
    configurable: true,
    writable: true,
  })
  return execCommand
}

describe('lib/clipboard · copyTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (document as { execCommand?: unknown }).execCommand
    vi.restoreAllMocks()
  })

  test('writeText 成功时返回 true 且不产生异常', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyTextToClipboard('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  test('writeText 抛 NotAllowedError（文档失焦）时降级 execCommand', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(new DOMException('Document is not focused.', 'NotAllowedError'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const execCommand = stubExecCommand(true)

    await expect(copyTextToClipboard('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  test('无 clipboard API 时直接走 textarea + execCommand 降级路径', async () => {
    vi.stubGlobal('navigator', {})
    const execCommand = stubExecCommand(true)

    await expect(copyTextToClipboard('hello')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  test('降级路径也失败时返回 false，不向外抛异常', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const execCommand = stubExecCommand(false)

    await expect(copyTextToClipboard('hello')).resolves.toBe(false)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })
})
