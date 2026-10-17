/**
 * 矛盾矩阵件测试（v3-triz-contradiction-copilot W7 · tasks 7.2）。
 *
 * 覆盖：
 * - 命中推荐原则与落地释义展示；
 * - 空单元中性提示（空组合不显示为错误）；
 * - 从 URL query 带入参数对（?improving=N&worsening=M）并解析展示；
 * - 编辑与交互过程零写请求（网络监控断言）；
 * - 显式保存快照仅发一次分馆产物 POST 请求（需 diagram:manage；无权限时隐藏保存并中性提示）。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { TrizContradictionMatrixChartLens } from '@/components/next/charts/lenses/triz/TrizContradictionMatrixChartLens'
import {
  installTrizGalleryFakeBackend,
  makeSampleMatrixResult,
  TEST_PROJECT_ID,
  type TrizGalleryFakeBackend,
} from './_next-triz-gallery-fixtures'

let backend: TrizGalleryFakeBackend
let searchParamsMock = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock,
}))

function setPermissions(permissions: string[]) {
  useAuthStore.setState({
    permissions,
    currentOrganizationId: 1,
  })
}

beforeEach(() => {
  backend = installTrizGalleryFakeBackend()
  searchParamsMock = new URLSearchParams()
  setPermissions(['project:view', 'diagram:manage'])
})

afterEach(() => {
  backend.restore()
})

describe('7.2 矛盾矩阵件（TrizContradictionMatrixChartLens）', () => {
  test('命中推荐原则：选择参数对后渲染推荐发明原理卡片与落地释义', async () => {
    render(<TrizContradictionMatrixChartLens projectId={TEST_PROJECT_ID} />)

    // 等待请求完成
    await waitFor(() => {
      expect(backend.count('/matrix-principles')).toBeGreaterThanOrEqual(1)
    })

    // 默认参数对（#9 交付速度 × #25 工期延误）命中
    await screen.findByText('矛盾参数对交叉分析')
    expect(screen.getByText(/命中 3 条发明原理/)).toBeInTheDocument()

    // 验证发明原理卡片
    const card10 = document.querySelector('[data-principle-card][data-principle-number="10"]')
    expect(card10).not.toBeNull()
    expect(card10?.textContent).toContain('预先作用')
    expect(card10?.textContent).toContain('预先搭建脚手架，在阻塞发生前完成依赖准备。')

    // 整个浏览选择过程零写操作
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('空单元中性提示：未收录推荐原则的参数对呈现中性提示，不显示为错误', async () => {
    backend.setMatrixResult(makeSampleMatrixResult(1, 1, false))
    render(<TrizContradictionMatrixChartLens projectId={TEST_PROJECT_ID} />)

    const impSelect = screen.getByLabelText(/想要改善的参数/)
    const worSelect = screen.getByLabelText(/发生恶化的参数/)

    // 切换至 1 x 1 参数组合（设置了 empty result）
    fireEvent.change(impSelect, { target: { value: '1' } })
    fireEvent.change(worSelect, { target: { value: '1' } })

    await waitFor(() => {
      const emptyCell = document.querySelector('[data-matrix-empty-cell]')
      expect(emptyCell).not.toBeNull()
      expect(screen.getByText('该组合暂无收录的推荐原则')).toBeInTheDocument()
    })

    // 确保没有出现错误提示
    expect(document.querySelector('.text-danger')).toBeNull()
    // 零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('从对话流带入参数对：URL query 参数（?improving=10&worsening=28）自动接住并生效', async () => {
    searchParamsMock = new URLSearchParams('improving=10&worsening=28')

    render(<TrizContradictionMatrixChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      const impSelect = screen.getByLabelText(/想要改善的参数/) as HTMLSelectElement
      const worSelect = screen.getByLabelText(/发生恶化的参数/) as HTMLSelectElement
      expect(impSelect.value).toBe('10')
      expect(worSelect.value).toBe('28')
    })

    // 零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('保存为分馆产物快照：具 diagram:manage 权限时保存仅发一次 POST 请求', async () => {
    render(<TrizContradictionMatrixChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText(/命中 3 条发明原理/)).toBeInTheDocument()
    })

    const saveButton = screen.getByRole('button', { name: '保存快照' })
    expect(saveButton).toBeInTheDocument()

    // 点击保存快照
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('已保存为分馆产物快照')).toBeInTheDocument()
    })

    // 严格断言：只发出了一次 POST 写请求到 triz-gallery-artifacts
    const writeCalls = backend.writeCalls()
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]!.url).toContain('/triz-gallery-artifacts')
    expect(writeCalls[0]!.method).toBe('POST')
    expect(writeCalls[0]!.body?.artifactType).toBe('contradiction_matrix')
  })

  test('权限阻断与中性提示：缺少 diagram:manage 时保存入口物理隐藏并给中性提示', async () => {
    // 只有查看权限，无图表管理权限
    setPermissions(['project:view'])

    render(<TrizContradictionMatrixChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText(/命中 3 条发明原理/)).toBeInTheDocument()
    })

    // 保存按钮被物理隐藏
    expect(screen.queryByRole('button', { name: '保存快照' })).toBeNull()

    // 出现中性只读提示
    expect(screen.getByText('当前账号仅具只读权限，保存入口已隐藏')).toBeInTheDocument()

    // 全程零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })
})
