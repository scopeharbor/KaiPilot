/**
 * v3-ui-next-chart-gallery W5 · tasks 5.1 —— 图表统一顶栏汇出菜单全量挂接与
 * 客户端无损汇出集成测试。
 *
 * 策略（与 W4 风险镜头一致）：api 层真实模块 + 全局 fetch 伪后端；汇出引擎
 * （lib/next/chart-export）真实执行，仅 mock html-to-image 三个出口与浏览器
 * 下载副作用（URL.createObjectURL / <a download> click），从而同时验证：
 * - ChartExportMenu 注入 ChartLensToolbar exportSlot（[data-chart-export-mount]）；
 * - 捕获目标 = [data-chart-viewport-slot]（镜头统一视口容器契约）；
 * - SVG / PNG-2x / JPG-白底三格式指令分别命中引擎出口（PNG pixelRatio=2，
 *   JPG backgroundColor=#ffffff）；
 * - 文件名严格符合 `[项目名]-[图表名]-[YYYYMMDD]_[HHmmss].[ext]`（viewType 取
 *   注册表 exportViewLabel，如「鱼骨图因果分析」）；
 * - RL-01 零网络：初始数据 GET 之外（含整个汇出流程）零 POST/PATCH/DELETE，
 *   汇出过程不新增任何请求；
 * - 异常容错：引擎失败 Toast「图表汇出失败，请稍后重试」且触发器复位；
 *   捕获目标缺失时不调引擎并 Toast。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import ProjectChartLensPage from '@/app/(next)/next/projects/[id]/charts/[chartId]/page'
import { ChartExportMenu } from '@/components/next/charts/ChartExportMenu'
import { toJpeg, toPng, toSvg } from 'html-to-image'
import {
  API_PREFIX,
  installFetchRouter,
  jsonResponse,
  makeProject,
  resetFetchRouter,
  writeMethods,
} from './helpers/chart-gallery-network'

// ---------------------------------------------------------------------------
// Module mocks（引擎出口：html-to-image；Toast：捕获错误提示）
// ---------------------------------------------------------------------------

vi.mock('html-to-image', () => ({
  toSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>'),
  toPng: vi.fn(async () => 'data:image/png;base64,'),
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,'),
  toBlob: vi.fn(async () => new Blob(['x'], { type: 'image/png' })),
}))

const toastMock = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/components/ui/Toast', () => ({ toast: toastMock.toast }))

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------

const paramsMock = vi.hoisted(() => ({ value: { id: '42', chartId: 'fishbone' } }))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/charts/fishbone',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话 & 渲染辅助
// ---------------------------------------------------------------------------

function setAuth(permissions: string[], organizationId: number | null = 1) {
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
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

const PNG_ITEM = '导出高清图 (PNG - 3x超清)'
const SVG_ITEM = '导出矢量图 (SVG)'
const JPG_ITEM = '导出兼容图 (JPG - 白底)'
const FILE_NAME_RE =
  /^[\w\u4e00-\u9fa5（）()]+-[\w\u4e00-\u9fa5（）()]+-\d{8}_\d{6}\.(svg|png|jpg)$/

let downloads: string[] = []
const originalClick = HTMLAnchorElement.prototype.click
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL
function renderFishbonePage() {
  setAuth(['project:view', 'diagram:view', 'diagram:manage'])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectChartLensPage />
    </QueryClientProvider>,
  )
  return { client, ...view }
}

/** fishbone 数据后端：项目 + 空 fishbone 图列表（默认 6M 骨架）。 */
function fishboneBackend(path: string, method: string): Response | null {
  if (path === '/projects/42' && method === 'GET') {
    return jsonResponse(200, { data: makeProject() })
  }
  if (path.startsWith('/projects/42/diagrams') && method === 'GET') {
    return jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 100, totalPages: 0 } })
  }
  return null
}

beforeEach(() => {
  downloads = []
  paramsMock.value = { id: '42', chartId: 'fishbone' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  toastMock.toast.mockReset()
  vi.mocked(toSvg).mockClear()
  vi.mocked(toPng).mockClear()
  vi.mocked(toJpeg).mockClear()
  vi.mocked(toSvg).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')
  vi.mocked(toPng).mockResolvedValue('data:image/png;base64,')
  vi.mocked(toJpeg).mockResolvedValue('data:image/jpeg;base64,')
  // 捕获 <a download> 的文件名；不调用原始 click（jsdom 会尝试导航 blob URL 产生噪音）
  HTMLAnchorElement.prototype.click = function clickCapture(this: HTMLAnchorElement) {
    downloads.push(this.download)
  }
  URL.createObjectURL = vi.fn(
    () => 'blob:chart-export-mock',
  ) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
})

afterEach(() => {
  HTMLAnchorElement.prototype.click = originalClick
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  resetFetchRouter()
})

describe('ChartExportMenu 挂接与三格式无损汇出（tasks 5.1）', () => {
  test('镜头页：汇出菜单注入 toolbar exportSlot，菜单含三格式指令', async () => {
    const router = installFetchRouter(fishboneBackend)
    renderFishbonePage()

    // 真实鱼骨镜头加载成功（默认 6M 骨架），数据请求仅为 GET
    await screen.findByText('鱼骨图 / 因果分析')
    await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())
    expect(router.records.some((record) => record.url.includes('/diagrams'))).toBe(true)
    expect(writeMethods(router.records)).toEqual([])

    expect(
      document.querySelector('[data-chart-export-mount] [data-chart-export-menu]'),
    ).not.toBeNull()
    expect(screen.getByRole('button', { name: '汇出图表' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '汇出图表' }))
    expect(screen.getByRole('menu', { name: '汇出图表选项' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: SVG_ITEM })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: PNG_ITEM })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: JPG_ITEM })).toBeInTheDocument()
  })

  test('SVG 导出：捕获 [data-chart-viewport-slot]，文件名 [项目名]-[图表名]-[时间戳].svg', async () => {
    const router = installFetchRouter(fishboneBackend)
    renderFishbonePage()
    await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '汇出图表' }))
    fireEvent.click(screen.getByRole('menuitem', { name: SVG_ITEM }))

    await waitFor(() => expect(toSvg).toHaveBeenCalledTimes(1))
    const [target] = vi.mocked(toSvg).mock.calls[0] as unknown as [HTMLElement]
    expect(target.matches('[data-chart-viewport-slot]')).toBe(true)
    expect(downloads).toHaveLength(1)
    expect(downloads[0]).toMatch(FILE_NAME_RE)
    expect(downloads[0]).toMatch(/^开项核心引擎-鱼骨图因果分析-\d{8}_\d{6}\.svg$/)
    // 引擎零网络选项（skipFonts/cacheBust 语义由引擎单测覆盖，此处校验无外发副作用）
    expect(writeMethods(router.records)).toEqual([])
  })

  test('PNG 导出：pixelRatio 3 超采样 + 规范文件名', async () => {
    const router = installFetchRouter(fishboneBackend)
    renderFishbonePage()
    await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())

    const before = router.records.length
    fireEvent.click(screen.getByRole('button', { name: '汇出图表' }))
    fireEvent.click(screen.getByRole('menuitem', { name: PNG_ITEM }))

    await waitFor(() => expect(toPng).toHaveBeenCalledTimes(1))
    const [target, options] = vi.mocked(toPng).mock.calls[0] as unknown as [
      HTMLElement,
      { pixelRatio: number },
    ]
    expect(target.matches('[data-chart-viewport-slot]')).toBe(true)
    expect(options.pixelRatio).toBe(3)
    expect(downloads[0]).toMatch(/^开项核心引擎-鱼骨图因果分析-\d{8}_\d{6}\.png$/)
    // 汇出全流程零新增网络请求（RL-01）
    expect(router.records.length).toBe(before)
    expect(writeMethods(router.records)).toEqual([])
  })

  test('JPG 导出：强制 #ffffff 白底垫底 + 规范文件名', async () => {
    const router = installFetchRouter(fishboneBackend)
    renderFishbonePage()
    await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '汇出图表' }))
    fireEvent.click(screen.getByRole('menuitem', { name: JPG_ITEM }))

    await waitFor(() => expect(toJpeg).toHaveBeenCalledTimes(1))
    const [target, options] = vi.mocked(toJpeg).mock.calls[0] as unknown as [
      HTMLElement,
      { backgroundColor: string },
    ]
    expect(target.matches('[data-chart-viewport-slot]')).toBe(true)
    expect(options.backgroundColor).toBe('#ffffff')
    expect(downloads[0]).toMatch(/^开项核心引擎-鱼骨图因果分析-\d{8}_\d{6}\.jpg$/)
    expect(writeMethods(router.records)).toEqual([])
  })

  test('初始数据加载仅为 GET；整页生命周期（含导出）写请求严格为 0（RL-01/RL-11）', async () => {
    const router = installFetchRouter(fishboneBackend)
    renderFishbonePage()
    await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())
    // 交互：打开/关闭菜单两次 + 三次导出
    fireEvent.click(screen.getByRole('button', { name: '汇出图表' }))
    fireEvent.click(screen.getByRole('menuitem', { name: SVG_ITEM }))
    await waitFor(() => expect(toSvg).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '汇出图表' }))
    fireEvent.click(screen.getByRole('menuitem', { name: PNG_ITEM }))
    await waitFor(() => expect(toPng).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '汇出图表' }))
    fireEvent.click(screen.getByRole('menuitem', { name: JPG_ITEM }))
    await waitFor(() => expect(toJpeg).toHaveBeenCalledTimes(1))

    expect(writeMethods(router.records)).toEqual([])
    // 全部请求均为数据 GET（projects + diagrams 各 1）
    const urls = router.records.map((record) => record.url.replace(API_PREFIX, ''))
    expect(urls.filter((url) => url.startsWith('/projects/42'))).toHaveLength(2)
    expect(router.records.every((record) => record.method === 'GET')).toBe(true)
  })

  test('引擎异常：Toast 提示汇出失败且触发器复位（容错不崩溃）', async () => {
    const router = installFetchRouter(fishboneBackend)
    renderFishbonePage()
    await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())

    vi.mocked(toSvg).mockRejectedValueOnce(new Error('canvas 显存不足'))
    fireEvent.click(screen.getByRole('button', { name: '汇出图表' }))
    fireEvent.click(screen.getByRole('menuitem', { name: SVG_ITEM }))

    await waitFor(() => {
      expect(toastMock.toast).toHaveBeenCalledWith({
        variant: 'error',
        title: '图表汇出失败，请稍后重试',
      })
    })
    const trigger = screen.getByRole('button', { name: '汇出图表' })
    expect(trigger).toHaveAttribute('aria-busy', 'false')
    expect(trigger).toBeEnabled()
    expect(writeMethods(router.records)).toEqual([])
  })

  test('捕获目标缺失：不调用引擎出口并 Toast 错误（与视口契约一致）', async () => {
    const router = installFetchRouter(() => null)
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <ChartExportMenu entityName="开项核心引擎" viewType="鱼骨图因果分析" />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '汇出图表' }))
    fireEvent.click(screen.getByRole('menuitem', { name: SVG_ITEM }))

    await waitFor(() => {
      expect(toastMock.toast).toHaveBeenCalledWith({
        variant: 'error',
        title: '图表汇出失败，请稍后重试',
      })
    })
    expect(toSvg).not.toHaveBeenCalled()
    expect(router.records).toHaveLength(0)
  })
})
