/**
 * v3-ui-next-reports-domain W3 · tasks 3.3 —— 报表中心双轨汇出下拉菜单专项测试。
 *
 * 覆盖（design「双轨汇出引擎整合与边界界定」/ spec「双轨汇出」需求）：
 * - 双轨分组呈现：服务端组（PDF/XLSX/Markdown/CSV）与客户端组（SVG/PNG/JPG）
 *   分组标题、条目禁用边界与 RBAC 权限阶梯（report:export / report:download）；
 * - 服务端导出：V1 预设快照（markdown/csv）与 V2 周期版本（pdf/xlsx）两路
 *   「创建导出 → apiRawFetch 二进制流 → Content-Disposition 权威文件名 → 本地下载」；
 * - RL-01 纯客户端汇出专项断言：spy 全局 `window.fetch` 与 `XMLHttpRequest`，
 *   触发 SVG/PNG/JPG 全流程后网络请求次数恒为 0（引擎为真实实现，仅替换
 *   html-to-image 四个序列化出口）；
 * - 客户端垫白铁律：JPG 强制 whiteBackdrop，垫白令牌注入后于捕获完成时还原
 *   （实时工作面零污染）；PNG 剪贴板复制成功与不支持环境下降级本地下载。
 */
import { toBlob, toJpeg, toPng, toSvg } from 'html-to-image'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import * as React from 'react'
import { ReportExportDropdown } from '@/components/next/reports/ReportExportDropdown'
import { useAuthStore } from '@/stores/auth-store'

// ---------------------------------------------------------------------------
// Module mocks：html-to-image 序列化出口 + Toast + 服务端 API 模块
// ---------------------------------------------------------------------------

vi.mock('html-to-image', () => ({
  toSvg: vi.fn(),
  toPng: vi.fn(),
  toJpeg: vi.fn(),
  toBlob: vi.fn(),
}))

const toastMock = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/components/ui/Toast', () => ({ toast: toastMock.toast }))

const reportsApiMock = vi.hoisted(() => ({
  exportReport: vi.fn(),
  downloadReportFile: vi.fn(),
}))
vi.mock('@/lib/api/reports', () => ({
  exportReport: reportsApiMock.exportReport,
  downloadReportFile: reportsApiMock.downloadReportFile,
}))

const reportsV2ApiMock = vi.hoisted(() => ({
  v2PeriodicCreateExport: vi.fn(),
  v2PeriodicDownloadExport: vi.fn(),
}))
vi.mock('@/lib/api/reports-v2', () => ({
  v2PeriodicCreateExport: reportsV2ApiMock.v2PeriodicCreateExport,
  v2PeriodicDownloadExport: reportsV2ApiMock.v2PeriodicDownloadExport,
}))

// ---------------------------------------------------------------------------
// 全局网络 spy 与本地下载调度桩
// ---------------------------------------------------------------------------

const urlMock = URL as unknown as {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}
const createObjectURLMock = vi.fn<(blob: Blob) => string>(() => 'blob:mock-reports-export')
const revokeObjectURLMock = vi.fn<(url: string) => void>()

let clickSpy: MockInstance<() => void>
let fetchSpy: ReturnType<typeof vi.fn>
let xhrSpy: ReturnType<typeof vi.fn>

const PROJECT_ID = 42

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

/** 二进制流假 Response（apiRawFetch 消费：ok/status/headers/blob）。 */
function binaryResponse(blob: Blob, filename: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-disposition' ? `attachment; filename="${filename}"` : null,
    },
    blob: async () => blob,
  } as unknown as Response
}

async function flushMacrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 最近一次本地下载触发的锚点（downloadBlob 动态 <a download>）。 */
function lastDownloadAnchor(): HTMLAnchorElement {
  const instance = clickSpy.mock.instances.at(-1) as unknown
  if (!(instance instanceof HTMLAnchorElement)) {
    throw new Error('未捕获到下载锚点 click 实例')
  }
  return instance
}

/** 默认渲染：捕获目标（data-report-export-target）+ 汇出下拉。 */
function renderDropdown(
  overrides: { target?: Parameters<typeof ReportExportDropdown>[0]['target'] } = {},
) {
  const target =
    overrides.target === undefined
      ? ({ kind: 'periodic-version' as const, versionId: 7 } as const)
      : overrides.target
  return render(
    <div>
      <div data-report-export-target>
        <h3>本周项目周报（草稿）</h3>
      </div>
      <ReportExportDropdown
        projectId={PROJECT_ID}
        target={target}
        entityName="开项核心引擎"
        viewType="周报审阅视图"
      />
    </div>,
  )
}

async function openMenu(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '汇出报表' }))
}

function item(format: string, group: 'server' | 'client'): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(
    `[data-report-export-item][data-export-group="${group}"][data-export-format="${format}"]`,
  )
  if (!el) throw new Error(`导出条目缺失: ${group}/${format}`)
  return el
}

beforeEach(() => {
  vi.clearAllMocks()
  urlMock.createObjectURL = createObjectURLMock as unknown as typeof urlMock.createObjectURL
  urlMock.revokeObjectURL = revokeObjectURLMock as unknown as typeof urlMock.revokeObjectURL
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  vi.mocked(toSvg).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  vi.mocked(toPng).mockResolvedValue('data:image/png;base64,AAAA')
  vi.mocked(toJpeg).mockResolvedValue('data:image/jpeg;base64,AAAA')
  vi.mocked(toBlob).mockResolvedValue(new Blob(['mock-png'], { type: 'image/png' }))
  fetchSpy = vi.fn()
  xhrSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  vi.stubGlobal('XMLHttpRequest', xhrSpy)
  setAuth(['report:view', 'report:export', 'report:download'])
  reportsApiMock.exportReport.mockResolvedValue({
    data: { reportId: 3, format: 'markdown', downloadUrl: '/reports/3/exports/markdown/download' },
  })
  reportsApiMock.downloadReportFile.mockResolvedValue({
    blob: new Blob(['# 周报'], { type: 'text/markdown' }),
    filename: 'markdown-export.md',
  })
  reportsV2ApiMock.v2PeriodicCreateExport.mockResolvedValue({
    data: { exportId: 9, format: 'pdf', status: 'completed' },
  })
  reportsV2ApiMock.v2PeriodicDownloadExport.mockResolvedValue(
    binaryResponse(new Blob(['pdf-bytes'], { type: 'application/pdf' }), '周报归档.pdf'),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  clickSpy.mockRestore()
})

describe('双轨分组呈现与 RBAC 权限阶梯（spec「汇出下拉菜单分组呈现」）', () => {
  test('展开菜单呈现「文档归档导出（服务端）/即时图表快照（客户端）」双分组', async () => {
    renderDropdown()
    await openMenu()

    const captions = Array.from(
      document.querySelectorAll('[data-report-export-group-caption]'),
    ).map((el) => el.textContent)
    expect(captions).toEqual(['文档归档导出（服务端）', '即时图表快照（客户端）'])

    // 周期版本目标：服务端四格式齐备且可点
    for (const format of ['pdf', 'xlsx', 'markdown', 'csv']) {
      const row = item(format, 'server')
      expect(row).toBeEnabled()
    }
    for (const format of ['svg', 'png', 'jpeg']) {
      expect(item(format, 'client')).toBeEnabled()
    }
  })

  test('缺少 report:export → 触发器整体禁用并提示（RL-15 阶梯）', async () => {
    setAuth(['report:view'])
    renderDropdown()
    const trigger = screen.getByRole('button', { name: '汇出报表' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('title', expect.stringContaining('report:export'))
  })

  test('report:download 缺失 → 服务端组禁用、客户端组可用', async () => {
    setAuth(['report:view', 'report:export'])
    renderDropdown()
    await openMenu()
    for (const format of ['pdf', 'xlsx', 'markdown', 'csv']) {
      expect(item(format, 'server')).toBeDisabled()
    }
    for (const format of ['svg', 'png', 'jpeg']) {
      expect(item(format, 'client')).toBeEnabled()
    }
  })

  test('无导出目标 → 服务端组呈现引导占位且零条目', async () => {
    renderDropdown({ target: null })
    await openMenu()
    expect(document.querySelector('[data-report-export-placeholder]')?.textContent).toContain(
      '请先在视图中选定报表或版本',
    )
    expect(document.querySelectorAll('[data-export-group="server"]')).toHaveLength(1)
    expect(item('svg', 'client')).toBeEnabled()
  })
})

describe('服务端文档归档导出（spec「服务端 PDF 导出与二进制流下载」）', () => {
  test('周期版本 PDF：create export → apiRawFetch 二进制流 → Content-Disposition 文件名落盘', async () => {
    renderDropdown()
    await openMenu()
    fireEvent.click(item('pdf', 'server'))

    await waitFor(() => {
      expect(reportsV2ApiMock.v2PeriodicCreateExport).toHaveBeenCalledWith(PROJECT_ID, 7, {
        format: 'pdf',
        draftOverride: false,
      })
    })
    expect(reportsV2ApiMock.v2PeriodicDownloadExport).toHaveBeenCalledWith(PROJECT_ID, 9)
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      const anchor = lastDownloadAnchor()
      expect(anchor.download).toBe('周报归档.pdf')
    })
    // 防抖复位：busy 结束后触发器可再次使用
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '汇出报表' })).not.toHaveAttribute(
        'aria-busy',
        'true',
      )
    })
  })

  test('周期版本 Excel (XLSX)：同样走创建 → 下载闭环', async () => {
    reportsV2ApiMock.v2PeriodicCreateExport.mockResolvedValue({
      data: { exportId: 11, format: 'xlsx', status: 'completed' },
    })
    reportsV2ApiMock.v2PeriodicDownloadExport.mockResolvedValue(
      binaryResponse(new Blob(['xlsx-bytes']), '周报归档.xlsx'),
    )
    renderDropdown()
    await openMenu()
    fireEvent.click(item('xlsx', 'server'))

    await waitFor(() => {
      expect(reportsV2ApiMock.v2PeriodicCreateExport).toHaveBeenCalledWith(PROJECT_ID, 7, {
        format: 'xlsx',
        draftOverride: false,
      })
    })
    expect(reportsV2ApiMock.v2PeriodicDownloadExport).toHaveBeenCalledWith(PROJECT_ID, 11)
    await waitFor(() => {
      const anchor = lastDownloadAnchor()
      expect(anchor.download).toBe('周报归档.xlsx')
    })
  })

  test('预设快照 Markdown：exportReport → downloadReportFile 触发下载（V1 双格式）', async () => {
    renderDropdown({ target: { kind: 'preset-report', reportId: 3 } })
    await openMenu()
    // 预设快照仅 markdown/csv：PDF/XLSX 行禁用并提示
    expect(item('pdf', 'server')).toBeDisabled()
    expect(item('xlsx', 'server')).toBeDisabled()
    expect(item('pdf', 'server')).toHaveAttribute(
      'title',
      expect.stringContaining('Markdown / CSV'),
    )
    expect(item('markdown', 'server')).toBeEnabled()

    fireEvent.click(item('markdown', 'server'))
    await waitFor(() => {
      expect(reportsApiMock.exportReport).toHaveBeenCalledWith(3, { format: 'markdown' })
    })
    expect(reportsApiMock.downloadReportFile).toHaveBeenCalledWith(3, 'markdown')
    await waitFor(() => {
      const anchor = lastDownloadAnchor()
      expect(anchor.download).toBe('markdown-export.md')
    })
  })

  test('服务端导出异常容错：Toast 错误且触发器复位', async () => {
    reportsV2ApiMock.v2PeriodicCreateExport.mockRejectedValue(new Error('上游 500'))
    renderDropdown()
    await openMenu()
    fireEvent.click(item('pdf', 'server'))

    await waitFor(() => {
      expect(toastMock.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: '服务端导出失败，请稍后重试' }),
      )
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '汇出报表' })).not.toHaveAttribute(
        'aria-busy',
        'true',
      )
    })
    expect(createObjectURLMock).not.toHaveBeenCalled()
  })
})

describe('RL-01 纯客户端汇出零网络断言与垫白铁律', () => {
  test('SVG / PNG(复制) / JPG(白底) 全流程网络请求次数恒为 0', async () => {
    renderDropdown()
    await openMenu()
    fireEvent.click(item('svg', 'client'))
    await waitFor(() => expect(vi.mocked(toSvg)).toHaveBeenCalled())
    await flushMacrotasks()

    await openMenu()
    fireEvent.click(item('png', 'client'))
    await waitFor(() => expect(vi.mocked(toBlob)).toHaveBeenCalled())
    await flushMacrotasks()

    await openMenu()
    fireEvent.click(item('jpeg', 'client'))
    await waitFor(() => expect(vi.mocked(toJpeg)).toHaveBeenCalled())
    await flushMacrotasks()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })

  test('SVG 本地下载：引擎出口 + blob: Object URL 调度，无外链', async () => {
    renderDropdown()
    await openMenu()
    fireEvent.click(item('svg', 'client'))

    await waitFor(() => {
      const anchor = lastDownloadAnchor()
      expect(anchor.download).toContain('.svg')
      expect(anchor.download).toContain('周报审阅视图')
    })
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    const blob = createObjectURLMock.mock.calls[0]![0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/svg+xml')
  })

  test('JPG 强制垫白：白底令牌注入于捕获期存在、完成后还原（零污染）', async () => {
    renderDropdown()
    await openMenu()
    const target = document.querySelector<HTMLElement>('[data-report-export-target]')
    expect(target).not.toBeNull()

    // 垫白注入过程探测：引擎在克隆期间同步 setProperty → 捕获完成后还原
    fireEvent.click(item('jpeg', 'client'))
    await waitFor(() => expect(vi.mocked(toJpeg)).toHaveBeenCalled())

    const options = vi.mocked(toJpeg).mock.calls[0]?.[1]
    expect(options).toMatchObject({
      skipFonts: true,
      cacheBust: false,
      backgroundColor: '#ffffff',
      pixelRatio: 2,
    })
    // 注入令牌于捕获完成后同步还原，实时工作面零污染
    expect(target?.hasAttribute('data-export-theme')).toBe(false)
    expect(target?.style.getPropertyValue('--nx-text-primary')).toBe('')
    const anchor = lastDownloadAnchor()
    expect(anchor.download).toContain('.jpg')
  })

  test('PNG 剪贴板复制成功（ClipboardItem 可用环境）', async () => {
    const clipboardWriteMock = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: clipboardWriteMock },
    })
    vi.stubGlobal(
      'ClipboardItem',
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob>) {}
      },
    )
    renderDropdown()
    await openMenu()
    fireEvent.click(item('png', 'client'))

    await waitFor(() => {
      expect(vi.mocked(toBlob)).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(toastMock.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: '分享卡已复制到剪贴板' }),
      )
    })
    // 复制成功路径不触发本地下载
    expect(createObjectURLMock).not.toHaveBeenCalled()
  })

  test('PNG 剪贴板不支持时平滑降级本地下载（RL-01 降级通道）', async () => {
    delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem
    delete (navigator as { clipboard?: unknown }).clipboard
    renderDropdown()
    await openMenu()
    fireEvent.click(item('png', 'client'))

    await waitFor(() => {
      const anchor = lastDownloadAnchor()
      expect(anchor.download).toContain('.png')
      expect(anchor.download).toContain('周报审阅视图')
    })
    await waitFor(() => {
      expect(toastMock.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }))
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })

  test('捕获目标缺失 → 友好 Toast 且引擎零调用', async () => {
    render(
      <div>
        <ReportExportDropdown
          projectId={PROJECT_ID}
          target={{ kind: 'periodic-version', versionId: 7 }}
        />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: '汇出报表' }))
    fireEvent.click(item('svg', 'client'))

    await waitFor(() => {
      expect(toastMock.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: '未找到可汇出的报表区域，请稍后重试' }),
      )
    })
    expect(vi.mocked(toSvg)).not.toHaveBeenCalled()
  })
})
