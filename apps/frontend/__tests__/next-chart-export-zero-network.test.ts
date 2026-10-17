/**
 * v3-ui-next-chart-export W3（tasks 3.1）—— 纯客户端零网络请求与断网离线导出集成测试。
 *
 * 验证（spec「纯客户端零网络请求与数据零外发（红线）」）：
 * - 断网/离线环境（navigator.onLine=false + offline 事件）下，看板全套导出管线
 *   （PNG 2x / JPG 白底 / SVG 矢量 / 底层 Blob / 剪贴板降级）100% 本地完成；
 * - 全程 spy 监听全局 `fetch` 与 `window.XMLHttpRequest`，严苛断言调用次数为 0，
 *   无任何图像 payload / 业务元数据外发（RL-01）；
 * - 本地下载仅经 `blob:` Object URL 调度，锚点 href 绝无 http(s) 外链；
 * - 垫白模式（whiteBackdrop）与沉浸档光晕平整化注入同样零网络。
 */
import { toBlob, toJpeg, toPng, toSvg } from 'html-to-image'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('html-to-image', () => ({
  toSvg: vi.fn(),
  toPng: vi.fn(),
  toJpeg: vi.fn(),
  toBlob: vi.fn(),
}))

vi.mock('@/components/ui/Toast', () => ({
  toast: vi.fn(),
}))

import {
  copyBlobToClipboard,
  exportNodeToBlob,
  exportNodeToJpeg,
  exportNodeToPng,
  exportNodeToSvg,
} from '@/lib/next/chart-export'

const urlMock = URL as unknown as {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}
const createObjectURLMock = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url')
const revokeObjectURLMock = vi.fn<(url: string) => void>()

let clickSpy: ReturnType<typeof vi.spyOn>
let fetchSpy: ReturnType<typeof vi.fn>
let xhrSpy: ReturnType<typeof vi.fn>

/** 看板工作面模拟节点：四列任务卡片 + 沉浸档氛围层类（近似 ProjectSpaceContainer）。 */
function buildBoardNode(): HTMLElement {
  const section = document.createElement('section')
  section.setAttribute('data-project-space-board-slot', '')
  section.className = 'nx-space-atmosphere'
  section.style.backgroundColor = 'var(--nx-workspace-bg)'
  section.style.color = 'var(--nx-text-primary)'
  const columns = ['待处理', '进行中', '已完成', '其他']
  columns.forEach((name, index) => {
    const column = document.createElement('div')
    column.setAttribute('data-kanban-column', String(index))
    const heading = document.createElement('h4')
    heading.textContent = name
    column.appendChild(heading)
    for (let i = 0; i < 2; i += 1) {
      const card = document.createElement('div')
      card.className = 'kanban-card'
      card.textContent = `任务 ${index}-${i}`
      column.appendChild(card)
    }
    section.appendChild(column)
  })
  return section
}

/** 标准 image/png Blob 测试样本（分享卡复制路径）。 */
function pngBlob(): Blob {
  return new Blob(['png'], { type: 'image/png' })
}

/** 冲刷引擎异步 revoke 调度（setTimeout 0）。 */
async function flushMacrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 模拟断网：navigator.onLine=false 并派发 offline 事件。 */
function goOffline(): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  window.dispatchEvent(new Event('offline'))
}

beforeEach(() => {
  vi.clearAllMocks()
  urlMock.createObjectURL = createObjectURLMock as unknown as typeof urlMock.createObjectURL
  urlMock.revokeObjectURL = revokeObjectURLMock as unknown as typeof urlMock.revokeObjectURL
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  vi.mocked(toPng).mockResolvedValue('data:image/png;base64,AAAA')
  vi.mocked(toJpeg).mockResolvedValue('data:image/jpeg;base64,AAAA')
  vi.mocked(toSvg).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  vi.mocked(toBlob).mockResolvedValue(new Blob(['mock'], { type: 'image/png' }))
  fetchSpy = vi.fn()
  xhrSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  vi.stubGlobal('XMLHttpRequest', xhrSpy)
  goOffline()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clickSpy.mockRestore()
  document.body.innerHTML = ''
  document.head.querySelectorAll('[data-export-atmosphere-flatten]').forEach((el) => el.remove())
  delete (navigator as { onLine?: boolean }).onLine
})

describe('断网离线导出（spec「离线断网状态下图表导出依然正常完成」）', () => {
  it('离线环境下看板全套导出管线成功完成：PNG / JPG / SVG / Blob 四路全部产出', async () => {
    const board = buildBoardNode()
    document.body.appendChild(board)

    const png = await exportNodeToPng(board, {
      entityName: '智能车载系统研发',
      viewType: '看板工作面',
    })
    const jpeg = await exportNodeToJpeg(board, {
      entityName: '智能车载系统研发',
      viewType: '看板工作面',
    })
    const svg = await exportNodeToSvg(board, {
      entityName: '智能车载系统研发',
      viewType: '看板工作面',
    })
    const blob = await exportNodeToBlob(board, 'png', {
      entityName: '智能车载系统研发',
      viewType: '看板工作面',
    })
    await flushMacrotasks()

    expect(png).toMatch(/^data:image\/png;base64,/)
    expect(jpeg).toMatch(/^data:image\/jpeg;base64,/)
    expect(svg).toContain('<svg')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
    // PNG / JPG / SVG 三路触发本地下载（Object URL → 锚点 → revoke 释放）；
    // exportNodeToBlob 为底层 Blob 产出（供剪贴板路径复用），不额外下载。
    expect(createObjectURLMock).toHaveBeenCalledTimes(3)
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(3)
  })

  it('离线看板全套导出管线网络活动严格为 0：fetch / XMLHttpRequest 零调用', async () => {
    const board = buildBoardNode()
    document.body.appendChild(board)

    await exportNodeToPng(board, { entityName: '开项', viewType: '看板工作面' })
    await exportNodeToJpeg(board, { entityName: '开项', viewType: '看板工作面' })
    await exportNodeToSvg(board, { entityName: '开项', viewType: '看板工作面' })
    await exportNodeToBlob(board, 'png', { entityName: '开项', viewType: '看板工作面' })
    await copyBlobToClipboard(pngBlob(), '开项-分享卡.png')
    await flushMacrotasks()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })

  it('下载调度仅走本地 blob: Object URL，锚点 href 绝无 http(s) 外链', async () => {
    const board = buildBoardNode()
    document.body.appendChild(board)

    await exportNodeToPng(board, { entityName: '开项', viewType: '看板工作面' })
    await exportNodeToJpeg(board, { entityName: '开项', viewType: '看板工作面' })
    await exportNodeToSvg(board, { entityName: '开项', viewType: '看板工作面' })
    await flushMacrotasks()

    // createObjectURL 收到的全部为本地 Blob（image/*），非 base64/data/text 外发负载
    const capturedBlobs = createObjectURLMock.mock.calls.map((call) => call[0])
    expect(capturedBlobs).toHaveLength(3)
    for (const blob of capturedBlobs) {
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toMatch(/^image\//)
    }
    // 触发的锚点 href 全部为本地 Object URL（blob: 协议），无任何外链
    for (const instance of clickSpy.mock.instances) {
      const anchor = instance as HTMLAnchorElement
      expect(anchor.href).toMatch(/^blob:/)
    }
  })

  it('剪贴板不支持时分享卡复制平滑降级为本地下载，同样零网络（RL-01 降级通道）', async () => {
    delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem
    delete (navigator as { clipboard?: unknown }).clipboard

    const result = await copyBlobToClipboard(pngBlob(), '智能车载系统研发-分享卡.png')
    await flushMacrotasks()

    expect(result).toBe('downloaded')
    const anchor = clickSpy.mock.instances.at(-1) as HTMLAnchorElement
    expect(anchor.download).toBe('智能车载系统研发-分享卡.png')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })

  it('垫白模式（whiteBackdrop）与光晕平整化注入全程零网络请求', async () => {
    const board = buildBoardNode()
    document.body.appendChild(board)

    await exportNodeToPng(board, {
      entityName: '开项',
      viewType: '看板工作面',
      whiteBackdrop: true,
    })
    await exportNodeToJpeg(board, {
      entityName: '开项',
      viewType: '看板工作面',
      whiteBackdrop: true,
    })
    await exportNodeToSvg(board, {
      entityName: '开项',
      viewType: '看板工作面',
      whiteBackdrop: true,
    })
    await flushMacrotasks()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
    // 垫白主题注入使用后已还原，实时工作面零污染
    expect(board.hasAttribute('data-export-theme')).toBe(false)
    expect(board.style.getPropertyValue('--nx-text-primary')).toBe('')
    // 光晕平整化临时样式已移除
    expect(document.head.querySelector('[data-export-atmosphere-flatten]')).toBeNull()
  })

  it('导出异常容错不影响零网络底线：渲染失败仅抛本地错误，无任何网络活动', async () => {
    vi.mocked(toPng).mockImplementation(() => Promise.reject(new Error('render timeout')))
    const board = buildBoardNode()
    document.body.appendChild(board)

    await expect(
      exportNodeToPng(board, { entityName: '开项', viewType: '看板工作面' }),
    ).rejects.toMatchObject({ message: 'render timeout' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })
})
