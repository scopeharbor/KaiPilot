import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toBlob, toJpeg, toPng, toSvg } from 'html-to-image'

vi.mock('html-to-image', () => ({
  toSvg: vi.fn(),
  toPng: vi.fn(),
  toJpeg: vi.fn(),
  toBlob: vi.fn(),
}))

vi.mock('@/components/ui/Toast', () => ({
  toast: vi.fn(),
}))

import { toast } from '@/components/ui/Toast'
import type { Task } from '@/lib/api/tasks'
import { ChartShareCardModal } from '@/components/next/export/ChartShareCardModal'
import { KanbanShareCardTemplate } from '@/components/next/export/KanbanShareCardTemplate'

const urlMock = URL as unknown as {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}
const createObjectURLMock = vi.fn(() => 'blob:mock-url')
const revokeObjectURLMock = vi.fn()

let clickSpy: ReturnType<typeof vi.spyOn>

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    projectId: 1,
    name: '测试任务',
    description: null,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: null,
    endDate: null,
    actualStartDate: null,
    actualEndDate: null,
    durationDays: null,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 0,
    assigneeId: null,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function renderModal(overrides: { open?: boolean } = {}) {
  const onOpenChange = vi.fn()
  const utils = render(
    <ChartShareCardModal
      open={overrides.open ?? true}
      title="看板分享卡"
      entityName="智能车载系统研发"
      viewType="看板工作面"
      filenameViewType="分享卡"
      onOpenChange={onOpenChange}
    >
      <KanbanShareCardTemplate
        boardData={{
          pendingTasks: [makeTask({ id: 1, name: '架构重构' })],
          completedTasks: [makeTask({ id: 2, name: '原型评审', status: 'completed' })],
        }}
      />
    </ChartShareCardModal>,
  )
  return { onOpenChange, ...utils }
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
})

afterEach(() => {
  clickSpy.mockRestore()
  vi.unstubAllGlobals()
  delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem
  delete (navigator as { clipboard?: unknown }).clipboard
  document.body.innerHTML = ''
})

describe('ChartShareCardModal（分享卡预览与导出模态框）', () => {
  it('open=true 渲染预览卡片、标题与三个操作按钮；open=false 不渲染', () => {
    const first = renderModal()
    expect(screen.getByRole('dialog', { name: '看板分享卡' })).toBeInTheDocument()
    expect(screen.getByText('智能车载系统研发')).toBeInTheDocument()
    expect(screen.getByText('下载分享卡 (PNG)')).toBeInTheDocument()
    expect(screen.getByText('下载兼容图 (JPG)')).toBeInTheDocument()
    expect(screen.getByText('复制卡片到剪贴板')).toBeInTheDocument()
    expect(screen.getByText('架构重构')).toBeInTheDocument()

    first.unmount()
    render(
      <ChartShareCardModal
        open={false}
        title="看板分享卡"
        entityName="开项"
        viewType="看板工作面"
        onOpenChange={vi.fn()}
      >
        <div />
      </ChartShareCardModal>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('点击关闭按钮与键盘 Escape 触发 onOpenChange(false)', () => {
    const { onOpenChange } = renderModal()
    fireEvent.click(screen.getByLabelText('关闭'))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    onOpenChange.mockClear()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('点击遮罩空白区域触发 onOpenChange(false)，点击面板内部不触发', () => {
    const { onOpenChange, container } = renderModal()
    const dialog = screen.getByRole('dialog')
    fireEvent.mouseDown(dialog)
    expect(onOpenChange).not.toHaveBeenCalled()

    const overlay = container.querySelector('[data-chart-share-modal]') as HTMLElement
    fireEvent.mouseDown(overlay)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('下载 PNG：捕获满尺寸卡片节点并以 2x 超采样导出', async () => {
    renderModal()
    fireEvent.click(screen.getByText('下载分享卡 (PNG)'))

    await waitFor(() => expect(toPng).toHaveBeenCalledTimes(1))
    const [node, rawOptions] = vi.mocked(toPng).mock.calls[0]!
    const options = rawOptions as unknown as {
      pixelRatio: number
      skipFonts: boolean
      cacheBust: boolean
      backgroundColor?: string
    }
    expect((node as HTMLElement).style.width).toBe('1200px')
    expect(options.pixelRatio).toBe(2)
    expect(options.skipFonts).toBe(true)
    expect(options.cacheBust).toBe(false)
    expect(options.backgroundColor).toBeUndefined()

    // 实体名/视图仅用于文件名规范（[实体]-[视图]-[时间戳].png），不透传 html-to-image。
    const instance = clickSpy.mock.instances.at(-1) as HTMLAnchorElement | undefined
    expect(instance?.download).toMatch(/^智能车载系统研发-分享卡-\d{8}_\d{6}\.png$/)
    expect(toast).not.toHaveBeenCalled()
  })

  it('下载 JPG：捕获同一卡片节点并强制白底垫底', async () => {
    renderModal()
    fireEvent.click(screen.getByText('下载兼容图 (JPG)'))

    await waitFor(() => expect(toJpeg).toHaveBeenCalledTimes(1))
    const options = vi.mocked(toJpeg).mock.calls[0]![1]!
    expect(options.backgroundColor).toBe('#ffffff')
    expect(options.type).toBe('image/jpeg')
    const instance = clickSpy.mock.instances.at(-1) as HTMLAnchorElement | undefined
    expect(instance?.download).toMatch(/\.jpg$/)
  })

  it('导出中的 loading 防抖：按钮 aria-busy 且全组禁用，完成后复位', async () => {
    let resolveRender: (value: string) => void = () => undefined
    vi.mocked(toPng).mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolveRender = resolve)),
    )
    renderModal()

    fireEvent.click(screen.getByText('下载分享卡 (PNG)'))
    const busyButton = screen.getByText('下载分享卡 (PNG)').closest('button')!
    expect(busyButton).toHaveAttribute('aria-busy', 'true')
    expect(busyButton).toBeDisabled()
    expect(screen.getByText('下载兼容图 (JPG)').closest('button')).toBeDisabled()
    expect(screen.getByText('复制卡片到剪贴板').closest('button')).toBeDisabled()

    resolveRender('data:image/png;base64,AAAA')
    await waitFor(() => expect(busyButton).not.toBeDisabled())
    expect(busyButton).toHaveAttribute('aria-busy', 'false')
  })

  it('复制到剪贴板：支持环境下写入 PNG Blob 成功并弹出成功 Toast', async () => {
    const writeMock = vi.fn<(data: ClipboardItems) => Promise<void>>(() => Promise.resolve())
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: class ClipboardItemMock {
        items: Record<string, Blob>
        constructor(items: Record<string, Blob>) {
          this.items = items
        }
      },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: writeMock },
    })

    renderModal()
    fireEvent.click(screen.getByText('复制卡片到剪贴板'))

    await waitFor(() => expect(writeMock).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(toBlob).toHaveBeenCalledTimes(1)
    const options = vi.mocked(toBlob).mock.calls[0]![1]!
    expect(options.pixelRatio).toBe(2)
    const item = writeMock.mock.calls[0]![0]![0] as unknown as {
      items: Record<string, Blob>
    }
    expect(item.items['image/png']).toBeInstanceOf(Blob)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '分享卡已复制到剪贴板' }))
    expect(createObjectURLMock).not.toHaveBeenCalled()
  })

  it('复制到剪贴板：环境不支持时降级本地下载并提示降级 Toast', async () => {
    renderModal()
    fireEvent.click(screen.getByText('复制卡片到剪贴板'))

    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    const instance = clickSpy.mock.instances.at(-1) as HTMLAnchorElement | undefined
    expect(instance?.download).toMatch(/^智能车载系统研发-分享卡-\d{8}_\d{6}\.png$/)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '浏览器不支持复制图片' }))
  })

  it('复制到剪贴板：权限拒绝时降级下载并提示权限 Toast', async () => {
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: class ClipboardItemMock {},
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))),
      },
    })

    renderModal()
    fireEvent.click(screen.getByText('复制卡片到剪贴板'))

    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '剪贴板权限受限' }))
  })

  it('导出异常：弹出友好错误 Toast 且模态保持可用（busy 复位）', async () => {
    // vitest 2.1.9 的 once 队列在 clearAllMocks 后对 reject 不可靠：直接替换实现。
    vi.mocked(toPng).mockImplementation(() => Promise.reject(new Error('render timeout')))
    const { onOpenChange } = renderModal()

    fireEvent.click(screen.getByText('下载分享卡 (PNG)'))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: '图表汇出失败，请稍后重试' }),
      ),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('下载分享卡 (PNG)').closest('button')).not.toBeDisabled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('导出链路全程零网络请求（fetch / XHR 调用次数为 0）', async () => {
    const fetchSpy = vi.fn()
    const xhrSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('XMLHttpRequest', xhrSpy)

    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: class ClipboardItemMock {},
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: vi.fn(() => Promise.resolve()) },
    })

    renderModal()
    fireEvent.click(screen.getByText('下载分享卡 (PNG)'))
    await waitFor(() => expect(toPng).toHaveBeenCalledTimes(1), { timeout: 3000 })
    // toPng 被调用时导出仍在途（busy 期间全组按钮禁用、点击会被防连点吞掉）：
    // 必须等 busy 复位后再点复制，否则机器繁忙时 toBlob 永不调用 → 偶发失败。
    const copyButton = screen.getByText('复制卡片到剪贴板').closest('button')!
    await waitFor(() => expect(copyButton).not.toBeDisabled(), { timeout: 3000 })
    fireEvent.click(copyButton)
    await waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1), { timeout: 3000 })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })
})
