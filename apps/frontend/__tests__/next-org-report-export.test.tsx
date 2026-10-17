/**
 * v3-ui-next-batch4-reports-change-queue W2 · tasks 2.6
 * 组织级报表客户端零网络汇出与多格式导出集成测试。
 *
 * 验证（spec「纯客户端零网络多格式图表与报表汇出契约」）：
 * - SVG（矢量）、PNG（2x 超采样）、JPG（白底兼容）三格式完整汇出；
 * - 垫白打印模式（WHITE_BACKDROP_TOKENS / whiteBackdrop: true）内联令牌覆盖；
 * - 严苛断言汇出全流程 0 HTTP 请求发包（RL-01）；
 * - 断网/离线环境（navigator.onLine = false）下 100% 稳定运行；
 * - 异常容错与防抖禁用回显。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toJpeg, toPng, toSvg } from 'html-to-image'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OrgReportExportMenu } from '@/components/next/export/OrgReportExportMenu'
import { WHITE_BACKDROP_TOKENS } from '@/lib/next/chart-export'

vi.mock('html-to-image', () => ({
  toSvg: vi.fn(),
  toPng: vi.fn(),
  toJpeg: vi.fn(),
  toBlob: vi.fn(),
}))

const mockToast = vi.fn()
vi.mock('@/components/ui/Toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

const urlMock = URL as unknown as {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}
const createObjectURLMock = vi.fn<(blob: Blob) => string>(() => 'blob:mock-report-url')
const revokeObjectURLMock = vi.fn<(url: string) => void>()

let fetchSpy: ReturnType<typeof vi.fn>

describe('组织级报表多格式客户端汇出 (OrgReportExportMenu)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    urlMock.createObjectURL = createObjectURLMock
    urlMock.revokeObjectURL = revokeObjectURLMock

    // 监控 fetch，严苛断言零网络发包
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    vi.mocked(toSvg).mockResolvedValue('<svg><rect width="800" height="600"/></svg>')
    vi.mocked(toPng).mockResolvedValue(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    )
    vi.mocked(toJpeg).mockResolvedValue(
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  function setupContainer(): { targetNode: HTMLElement } {
    const targetNode = document.createElement('div')
    targetNode.setAttribute('data-org-report-export-target', '')
    targetNode.setAttribute('data-pmo-reports-lens', '')
    targetNode.style.backgroundColor = 'var(--nx-workspace-bg)'
    targetNode.style.color = 'var(--nx-text-primary)'
    targetNode.innerHTML = `
      <header><h1>PMO 组合态势报表大盘</h1></header>
      <section data-health-panel>交付健康分布</section>
      <section data-variance-panel>工期偏差分析</section>
    `
    document.body.appendChild(targetNode)
    return { targetNode }
  }

  test('点击触发器可正常展开多格式下拉菜单，并展示三类导出格式与垫白打印选项', () => {
    setupContainer()
    render(<OrgReportExportMenu entityName="北极星研发部" viewType="PMO组合态势大盘" />)

    const trigger = screen.getByRole('button', { name: /汇出报表/ })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    expect(screen.getByText('多格式客户端零网络汇出')).toBeInTheDocument()
    expect(screen.getByText('垫白打印模式 (高对比纯白)')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /PNG - 2x超清/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /导出矢量图 \(SVG\)/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /JPG - 白底兼容/ })).toBeInTheDocument()
  })

  test('触发 PNG 汇出调用 2x 超采样引擎，全流程 0 HTTP 网络发包 (RL-01)', async () => {
    setupContainer()
    render(<OrgReportExportMenu entityName="北极星研发部" viewType="PMO组合态势大盘" />)

    fireEvent.click(screen.getByRole('button', { name: /汇出报表/ }))
    const pngButton = screen.getByRole('menuitem', { name: /PNG - 2x超清/ })
    fireEvent.click(pngButton)

    await waitFor(() => {
      expect(toPng).toHaveBeenCalledTimes(1)
    })

    const callArgs = vi.mocked(toPng).mock.calls[0]!
    expect(callArgs[1]?.pixelRatio).toBe(2)
    expect(callArgs[1]?.skipFonts).toBe(true)
    expect(callArgs[1]?.cacheBust).toBe(false)

    // 严苛验证 0 HTTP 请求发包
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  test('触发 SVG 汇出调用矢量引擎，触发本地 ObjectURL 下载且零网络', async () => {
    setupContainer()
    render(<OrgReportExportMenu entityName="北极星研发部" viewType="PMO组合态势大盘" />)

    fireEvent.click(screen.getByRole('button', { name: /汇出报表/ }))
    const svgButton = screen.getByRole('menuitem', { name: /导出矢量图 \(SVG\)/ })
    fireEvent.click(svgButton)

    await waitFor(() => {
      expect(toSvg).toHaveBeenCalledTimes(1)
    })

    expect(createObjectURLMock).toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  test('JPG 默认垫白打印模式，并支持勾选「垫白打印模式」应用 WHITE_BACKDROP_TOKENS 令牌覆盖', async () => {
    const { targetNode } = setupContainer()
    render(<OrgReportExportMenu entityName="北极星研发部" viewType="PMO组合态势大盘" />)

    fireEvent.click(screen.getByRole('button', { name: /汇出报表/ }))

    // JPG 导出：默认必须覆盖纯白底
    let capturedThemeDuringJpeg: string | null = null
    let capturedBgDuringJpeg: string | null = null
    vi.mocked(toJpeg).mockImplementationOnce(async (node) => {
      const el = node as HTMLElement
      capturedThemeDuringJpeg = el.getAttribute('data-export-theme')
      capturedBgDuringJpeg = el.style.getPropertyValue('--nx-workspace-bg')
      return 'data:image/jpeg;base64,mock'
    })

    const jpgButton = screen.getByRole('menuitem', { name: /JPG - 白底兼容/ })
    fireEvent.click(jpgButton)

    await waitFor(() => {
      expect(toJpeg).toHaveBeenCalledTimes(1)
    })

    // 捕获期间临时应用垫白主题
    expect(capturedThemeDuringJpeg).toBe('white')
    expect(capturedBgDuringJpeg).toBe(WHITE_BACKDROP_TOKENS['--nx-workspace-bg'])

    // 捕获完成后还原
    expect(targetNode.getAttribute('data-export-theme')).toBeNull()

    // 等待上一次汇出的 busy 态完全清除后再重新打开菜单，避免触发按钮仍处于禁用态
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /汇出报表/ })).not.toBeDisabled()
    })

    // 再次打开，勾选垫白打印复选框并导出 PNG
    fireEvent.click(screen.getByRole('button', { name: /汇出报表/ }))
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    let capturedThemeDuringPng: string | null = null
    vi.mocked(toPng).mockImplementationOnce(async (node) => {
      const el = node as HTMLElement
      capturedThemeDuringPng = el.getAttribute('data-export-theme')
      return 'data:image/png;base64,mock'
    })

    const pngButton = screen.getByRole('menuitem', { name: /PNG - 2x超清/ })
    fireEvent.click(pngButton)

    await waitFor(() => {
      expect(toPng).toHaveBeenCalledTimes(1)
    })
    expect(capturedThemeDuringPng).toBe('white')
  })

  test('断网离线环境 (navigator.onLine = false) 下本地沙箱汇出正常执行', async () => {
    setupContainer()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

    render(<OrgReportExportMenu entityName="断网环境测试" viewType="离线大盘" />)
    fireEvent.click(screen.getByRole('button', { name: /汇出报表/ }))

    const svgButton = screen.getByRole('menuitem', { name: /导出矢量图 \(SVG\)/ })
    fireEvent.click(svgButton)

    await waitFor(() => {
      expect(toSvg).toHaveBeenCalledTimes(1)
    })
    expect(createObjectURLMock).toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  test('目标 DOM 节点不存在或引擎异常时友好 Toast 容错且主按钮解除禁用', async () => {
    // 不挂载目标节点
    document.body.innerHTML = ''
    render(<OrgReportExportMenu />)

    fireEvent.click(screen.getByRole('button', { name: /汇出报表/ }))
    const pngButton = screen.getByRole('menuitem', { name: /PNG - 2x超清/ })
    fireEvent.click(pngButton)

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          title: expect.stringContaining('报表汇出失败'),
        }),
      )
    })

    const trigger = screen.getByRole('button', { name: /汇出报表/ })
    expect(trigger).not.toBeDisabled()
    expect(trigger).toHaveAttribute('aria-busy', 'false')
  })
})
