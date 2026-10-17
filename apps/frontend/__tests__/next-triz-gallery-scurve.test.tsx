/**
 * 进化 S 曲线件测试（v3-triz-contradiction-copilot W7 · tasks 7.5）。
 *
 * 覆盖：
 * - ECharts 确定性桩：Sigmoid S 曲线计算、4 个阶段背景分区 markArea 与当前阶段 markLine；
 * - 动态当前阶段定位与客观中性描述文本；
 * - 铁律断言：STRICT ZERO "预警/告警" in DOM or copy（整棵 DOM 树严禁出现预警/告警字眼）；
 * - 只读零写断言：切换阶段卡片、交互浏览期间网络写请求数为 0；
 * - 具 diagram:manage 权限时可保存当前阶段快照到 triz-gallery-artifacts；
 * - 缺少权限时保存按钮物理隐藏并显示中性提示。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { TrizEvolutionScurveChartLens } from '@/components/next/charts/lenses/triz/TrizEvolutionScurveChartLens'
import { ensureLazyEchartsMock, FakeEChartsInstance } from './helpers/echarts-mock'
import {
  installTrizGalleryFakeBackend,
  TEST_PROJECT_ID,
  type TrizGalleryFakeBackend,
} from './_next-triz-gallery-fixtures'

// ECharts jsdom 桩
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

let backend: TrizGalleryFakeBackend

function setPermissions(permissions: string[]) {
  useAuthStore.setState({
    permissions,
    currentOrganizationId: 1,
  })
}

beforeEach(() => {
  backend = installTrizGalleryFakeBackend()
  ensureLazyEchartsMock().reset()
  setPermissions(['project:view', 'diagram:manage'])
})

afterEach(() => {
  backend.restore()
})

describe('7.5 进化 S 曲线件（TrizEvolutionScurveChartLens）', () => {
  test('S 曲线与 4 阶段分区标注：ECharts 收到正确的 Sigmoid 点列与 markArea 分区', async () => {
    const { container } = render(<TrizEvolutionScurveChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('TRIZ 技术系统进化 S 曲线分析')).toBeInTheDocument()
    })

    // 等待 ECharts 实例初始化
    const bundle = ensureLazyEchartsMock()
    expect(bundle.instances.length).toBeGreaterThanOrEqual(1)
    const instance = bundle.instances[0] as FakeEChartsInstance

    expect(instance.options.length).toBeGreaterThanOrEqual(1)
    const lastOption = instance.options[instance.options.length - 1] as Record<string, unknown>

    interface ScurveSeriesOption {
      name: string
      data: [number, number][]
      markArea: { data: [{ name: string }, unknown][] }
      markLine: { data: [{ name: string }] }
    }

    // 验证 S 曲线系列存在
    expect(lastOption.series).toBeDefined()
    const series = (lastOption.series as ScurveSeriesOption[])[0]!
    expect(series.name).toBe('S曲线轨迹')
    expect(series.data.length).toBe(41) // 0..40 共 41 个采样点

    // 验证 4 个阶段 markArea 分区
    const markArea = series.markArea
    expect(markArea.data).toHaveLength(4)
    expect(markArea.data[0]![0]!.name).toContain('婴儿期')
    expect(markArea.data[1]![0]!.name).toContain('成长期')
    expect(markArea.data[2]![0]!.name).toContain('成熟期')
    expect(markArea.data[3]![0]!.name).toContain('衰退与蜕变期')

    // 验证当前阶段 markLine 标线
    expect(series.markLine).toBeDefined()
    expect(series.markLine.data[0]!.name).toBe('当前阶段定位')

    // 铁律校验：严格断言 DOM 中零「预警」与「告警」
    const fullText = container.textContent || ''
    expect(fullText).not.toMatch(/(预警|告警)/)
    expect(container.innerHTML).not.toMatch(/(预警|告警)/)

    // 全程零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('阶段卡片交互与描述性判定：支持切换查看阶段指引，全过程网络零写请求', async () => {
    const { container } = render(<TrizEvolutionScurveChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('TRIZ 技术系统进化 S 曲线分析')).toBeInTheDocument()
    })

    // 点击切换到「阶段 1: 婴儿期」
    const stage1Btn = screen.getByRole('button', { name: /阶段 1: 婴儿期/ })
    fireEvent.click(stage1Btn)

    // 当前阶段描述更新
    expect(screen.getByText('当前阶段：婴儿期 (初始引入与探索)')).toBeInTheDocument()
    expect(screen.getAllByText(/系统雏形初具，研发投入大而产出较慢/).length).toBeGreaterThanOrEqual(
      1,
    )

    // 点击切换到「阶段 4: 衰退与蜕变期」
    const stage4Btn = screen.getByRole('button', { name: /阶段 4: 衰退与蜕变期/ })
    fireEvent.click(stage4Btn)

    expect(screen.getByText('当前阶段：衰退与蜕变期 (极限瓶颈与换轨跃迁)')).toBeInTheDocument()
    expect(screen.getAllByText(/原有技术系统达到极限寿命瓶颈/).length).toBeGreaterThanOrEqual(1)

    // 铁律再次校验：任何阶段文本均无「预警」或「告警」
    expect(container.textContent).not.toMatch(/(预警|告警)/)

    // 纯只读推演，网络零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('保存快照（POST）：具 diagram:manage 权限时可持久化当前阶段快照', async () => {
    render(<TrizEvolutionScurveChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('TRIZ 技术系统进化 S 曲线分析')).toBeInTheDocument()
    })

    const saveBtn = screen.getByRole('button', { name: '保存快照' })
    await waitFor(() => {
      expect(saveBtn).not.toBeDisabled()
    })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(screen.getByText('已保存 S 曲线阶段快照')).toBeInTheDocument()
    })

    // 严格断言：只发出了一次 POST 写请求到 triz-gallery-artifacts
    const writeCalls = backend.writeCalls()
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]!.method).toBe('POST')
    expect(writeCalls[0]!.url).toContain('/triz-gallery-artifacts')

    interface ScurveArtifactBody {
      artifactType: string
      content: { currentPhase: number; currentPhaseName: string }
    }
    const body = writeCalls[0]!.body as unknown as ScurveArtifactBody
    expect(body.artifactType).toBe('s_curve')
    expect(body.content.currentPhase).toBeDefined()
    expect(body.content.currentPhaseName).toBeDefined()
  })

  test('权限阻断：缺少 diagram:manage 时保存按钮物理隐藏并显示中性提示', async () => {
    setPermissions(['project:view'])

    render(<TrizEvolutionScurveChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('TRIZ 技术系统进化 S 曲线分析')).toBeInTheDocument()
    })

    // 保存按钮被物理隐藏
    expect(screen.queryByRole('button', { name: '保存快照' })).toBeNull()

    // 出现中性只读提示
    expect(screen.getByText('当前账号仅具只读权限，保存入口已隐藏')).toBeInTheDocument()

    // 全程零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })
})
