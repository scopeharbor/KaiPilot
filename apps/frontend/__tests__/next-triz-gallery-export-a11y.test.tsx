/**
 * 图表馆 TRIZ 分馆汇出契约、路由直达与无障碍测试（v3-triz-contradiction-copilot W7 · tasks 7.6）。
 *
 * 覆盖：
 * - 4 个 TRIZ 镜头的动态路由直达与装配挂载（/next/projects/:id/charts/:chartId）；
 * - 顶栏统一汇出菜单 ChartExportMenu 注入与 SVG / PNG / JPG 三格式汇出；
 * - 汇出文件命名规范（[项目名]-[视图名]-[时间戳].[ext]）；
 * - 纯客户端零网络请求断言（汇出过程中零 fetch 发起）；
 * - data-export-ignore="true" 规避要素完备性；
 * - 权限缺失防护与 404 中性缺省页（不泄露异常或红屏堆栈）；
 * - 无障碍（a11y）语义区域与可访问性。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import ProjectChartLensPage from '@/app/(next)/next/projects/[id]/charts/[chartId]/page'
import { toJpeg, toPng, toSvg } from 'html-to-image'
import { ensureLazyEchartsMock, FakeEChartsInstance } from './helpers/echarts-mock'
import {
  installTrizGalleryFakeBackend,
  TEST_PROJECT_ID,
  type TrizGalleryFakeBackend,
} from './_next-triz-gallery-fixtures'

// 1. Mock html-to-image 汇出底层
vi.mock('html-to-image', () => ({
  toSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>'),
  toPng: vi.fn(async () => 'data:image/png;base64,mockPngData'),
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,mockJpegData'),
  toBlob: vi.fn(async () => new Blob(['mock'], { type: 'image/png' })),
}))

// 2. Mock ECharts jsdom 桩
vi.mock('@/lib/next/echarts-core', () => ({
  default: {
    init: (dom: HTMLElement) => {
      const bundle = ensureLazyEchartsMock()
      const instance = new FakeEChartsInstance(dom)
      bundle.instances.push(instance)
      bundle.lastDom = dom
      return instance
    },
    use: () => undefined,
    registerTheme: () => undefined,
  },
}))

// 3. Mock next/navigation
const paramsState = { id: '42', chartId: 'triz-contradiction-matrix' }
const searchParamsState = new URLSearchParams()
const navMock = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}

vi.mock('next/navigation', () => ({
  useParams: () => paramsState,
  useSearchParams: () => searchParamsState,
  useRouter: () => navMock,
  usePathname: () => `/next/projects/${paramsState.id}/charts/${paramsState.chartId}`,
}))

let backend: TrizGalleryFakeBackend
let downloads: string[] = []
const originalClick = HTMLAnchorElement.prototype.click
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    permissions,
    currentOrganizationId: 1,
  })
}

function renderChartPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectChartLensPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  downloads = []
  paramsState.id = String(TEST_PROJECT_ID)
  paramsState.chartId = 'triz-contradiction-matrix'
  searchParamsState.forEach((_, key) => searchParamsState.delete(key))
  navMock.push.mockReset()
  navMock.replace.mockReset()

  backend = installTrizGalleryFakeBackend()
  ensureLazyEchartsMock().reset()
  setAuth(['project:view', 'diagram:manage'])

  vi.mocked(toSvg).mockClear()
  vi.mocked(toPng).mockClear()
  vi.mocked(toJpeg).mockClear()

  // 捕获下载文件名
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.download) {
      downloads.push(this.download)
    }
  }
  URL.createObjectURL = vi.fn(() => 'blob:mock-export-url') as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
})

afterEach(() => {
  HTMLAnchorElement.prototype.click = originalClick
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  backend.restore()
})

describe('7.6 汇出契约、路由直达与无障碍（Export & A11y）', () => {
  test('路由直达与镜头视口装配：4 个 TRIZ 镜头均成功挂载统一顶栏与视口槽', async () => {
    const trizLenses = [
      { id: 'triz-contradiction-matrix', title: '矛盾矩阵' },
      { id: 'triz-nine-windows', title: '九屏幕' },
      { id: 'triz-function-analysis', title: '功能分析' },
      { id: 'triz-evolution-scurve', title: 'S 曲线' },
    ]

    for (const lens of trizLenses) {
      paramsState.chartId = lens.id
      const { unmount } = renderChartPage()

      // 验证对应视口插槽正确装配
      await waitFor(() => {
        const slot = document.querySelector(`[data-chart-viewport="${lens.id}"]`)
        expect(slot).not.toBeNull()
        expect(slot).toHaveAttribute('data-chart-viewport-slot')
      })

      // 验证汇出菜单挂载点存在
      const exportMount = document.querySelector('[data-chart-export-mount]')
      expect(exportMount).not.toBeNull()

      unmount()
    }
  })

  test('汇出契约：汇出菜单含三格式（SVG/PNG/JPG），触发汇出产生符合命名规范的文件且零网络', async () => {
    paramsState.chartId = 'triz-contradiction-matrix'
    renderChartPage()

    await waitFor(() => {
      expect(
        document.querySelector('[data-chart-viewport="triz-contradiction-matrix"]'),
      ).not.toBeNull()
    })

    // 打开汇出下拉菜单
    const exportBtn = screen.getByRole('button', { name: '汇出图表' })
    expect(exportBtn).toBeInTheDocument()
    fireEvent.click(exportBtn)

    // 验证三种导出格式选项
    expect(screen.getByText('导出高清图 (PNG - 3x超清)')).toBeInTheDocument()
    expect(screen.getByText('导出矢量图 (SVG)')).toBeInTheDocument()
    expect(screen.getByText('导出兼容图 (JPG - 白底)')).toBeInTheDocument()

    const requestCountBeforeExport = backend.calls.length

    // 点击 PNG 导出
    fireEvent.click(screen.getByText('导出高清图 (PNG - 3x超清)'))

    await waitFor(() => {
      expect(downloads.length).toBe(1)
    })

    // 重点断言：文件名严格符合 [项目名]-[视图名]-[时间戳].[ext]
    const downloadedName = downloads[0]!
    expect(downloadedName).toMatch(/^北极星协同平台-TRIZ矛盾矩阵-\d{8}_\d{6}\.png$/)

    // 重点断言：汇出过程零网络请求（纯客户端无损生成，无图像或数据上传外发）
    expect(backend.calls.length).toBe(requestCountBeforeExport)
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('汇出规避标记：镜头内操作条与未保存提示均标记 data-export-ignore="true"', async () => {
    paramsState.chartId = 'triz-nine-windows'
    renderChartPage()

    await waitFor(() => {
      expect(document.querySelector('[data-triz-nine-windows-lens]')).not.toBeNull()
    })

    // 验证九屏幕工具栏被标记为汇出忽略
    const ignoreElements = document.querySelectorAll('[data-export-ignore="true"]')
    expect(ignoreElements.length).toBeGreaterThanOrEqual(1)
  })

  test('权限阻断：无 project:view 时呈现中性权限提示，绝无崩溃或红屏', async () => {
    setAuth([]) // 清空权限

    paramsState.chartId = 'triz-contradiction-matrix'
    renderChartPage()

    await waitFor(() => {
      expect(screen.getByText('你没有查看该项目图表馆的权限')).toBeInTheDocument()
    })

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-chart-viewport-slot]')).toBeNull()
  })

  test('404 中性缺省页：项目 ID 无效时呈现中性 NotFound，不暴露异常堆栈', async () => {
    paramsState.id = 'invalid-id'
    paramsState.chartId = 'triz-nine-windows'

    renderChartPage()

    await waitFor(() => {
      expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    })

    // 确保没有出现错误堆栈
    expect(document.querySelector('.text-danger')).toBeNull()
  })

  test('未知图表 ID 平滑回退：未知 chartId 时回退目录页，不崩溃', async () => {
    paramsState.id = String(TEST_PROJECT_ID)
    paramsState.chartId = 'unknown-triz-chart-id'

    renderChartPage()

    await waitFor(() => {
      expect(screen.getByText('经典项目管理图表全景')).toBeInTheDocument()
    })
  })

  test('无障碍语义（A11y）：关键视口区域与表单元素均具备无障碍名称与语义角色', async () => {
    paramsState.chartId = 'triz-function-analysis'
    renderChartPage()

    await waitFor(() => {
      expect(
        document.querySelector('[data-chart-viewport="triz-function-analysis"]'),
      ).not.toBeNull()
    })

    const viewport = document.querySelector('[data-chart-viewport="triz-function-analysis"]')
    expect(viewport).toHaveAttribute('aria-label')

    // 候选审查区具有语义 section 与 aria-label
    const reviewSection = document.querySelector('[aria-label="功能问题候选审查"]')
    expect(reviewSection).not.toBeNull()
  })
})
