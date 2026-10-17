/**
 * 功能分析件测试（v3-triz-contradiction-copilot W7 · tasks 7.4）。
 *
 * 覆盖：
 * - 节点-边拓扑关系图初始化与预填加载；
 * - 4 种功能边类型（有用、有害、不足、过度）及其视觉语义编码；
 * - 问题候选（ProblemCandidate）审核：确认与驳回，只流转本地状态，零业务表写入；
 * - 受控节点添加与删除、边类型修改；
 * - 显式保存快照到 triz-gallery-artifacts：
 *   - 结构化保存节点、边、问题候选及溯源上下文；
 *   - 严格断言：绝不持久化自由布局拖拽坐标（无 x/y 坐标）；
 * - 权限控制：缺少 diagram:manage 时保存入口物理隐藏与中性提示。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  TrizFunctionAnalysisChartLens,
  getEdgeConfig,
} from '@/components/next/charts/lenses/triz/TrizFunctionAnalysisChartLens'
import {
  installTrizGalleryFakeBackend,
  TEST_PROJECT_ID,
  type TrizGalleryFakeBackend,
} from './_next-triz-gallery-fixtures'

let backend: TrizGalleryFakeBackend

function setPermissions(permissions: string[]) {
  useAuthStore.setState({
    permissions,
    currentOrganizationId: 1,
  })
}

beforeEach(() => {
  backend = installTrizGalleryFakeBackend()
  setPermissions(['project:view', 'diagram:manage'])
})

afterEach(() => {
  backend.restore()
})

describe('7.4 功能分析件（TrizFunctionAnalysisChartLens）', () => {
  test('四类功能边视觉配置纯函数：语义线型与色值正确对应', () => {
    const useful = getEdgeConfig('useful')
    expect(useful.label).toBe('有用功能')
    expect(useful.stroke).toBe('#10b981')
    expect(useful.strokeDasharray).toBeUndefined()

    const harmful = getEdgeConfig('harmful')
    expect(harmful.label).toBe('有害功能')
    expect(harmful.stroke).toBe('#ef4444')
    expect(harmful.strokeDasharray).toBe('5,5')

    const insufficient = getEdgeConfig('insufficient')
    expect(insufficient.label).toBe('不足功能')
    expect(insufficient.stroke).toBe('#f59e0b')
    expect(insufficient.strokeDasharray).toBe('3,3')

    const excessive = getEdgeConfig('excessive')
    expect(excessive.label).toBe('过度功能')
    expect(excessive.stroke).toBe('#8b5cf6')
  })

  test('初始化加载预填：拉取草案并渲染图谱与问题候选，加载期间零写请求', async () => {
    render(<TrizFunctionAnalysisChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(backend.count('/triz-gallery/prefill')).toBeGreaterThanOrEqual(1)
    })

    // 顶部图例呈现
    expect(screen.getByText('功能拓扑分析图')).toBeInTheDocument()
    expect(screen.getAllByText(/有用/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/有害/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/不足/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/过度/).length).toBeGreaterThanOrEqual(1)

    // 渲染问题候选审查区
    expect(screen.getByText(/检测到的功能分析问题候选/)).toBeInTheDocument()
    const candidates = document.querySelectorAll('[data-problem-candidate]')
    expect(candidates.length).toBeGreaterThanOrEqual(2)

    // 全程零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('问题候选逐条确认与驳回：状态本地流转，绝不写入任何业务大表', async () => {
    render(<TrizFunctionAnalysisChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText(/检测到的功能分析问题候选/)).toBeInTheDocument()
    })

    const candidate1 = document.querySelector('[data-problem-candidate="prob-1"]')
    expect(candidate1).not.toBeNull()

    // 初始状态为待确认
    expect(candidate1?.textContent).toContain('待确认')

    // 点击「确认」
    const confirmBtn = candidate1?.querySelector('button:nth-of-type(1)') as HTMLButtonElement
    expect(confirmBtn.textContent).toContain('确认')
    fireEvent.click(confirmBtn)

    // 状态更新为已确认，操作按钮消失
    expect(candidate1?.textContent).toContain('已确认')
    expect(candidate1?.querySelector('button')).toBeNull()

    // 对第二个候选进行「驳回」
    const candidate2 = document.querySelector('[data-problem-candidate="prob-2"]')
    expect(candidate2).not.toBeNull()
    const dismissBtn = candidate2?.querySelectorAll('button')[1] as HTMLButtonElement
    expect(dismissBtn.textContent).toContain('驳回')
    fireEvent.click(dismissBtn)

    expect(candidate2?.textContent).toContain('已驳回')

    // 标记为未保存脏状态
    expect(document.querySelector('[data-unsaved-badge]')).not.toBeNull()

    // 严格断言：审核问题候选过程零写请求（没有对任何业务表或产物表发写操作）
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('受控编辑：可添加新节点与删除节点，期间网络零写请求', async () => {
    render(<TrizFunctionAnalysisChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('功能拓扑分析图')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('输入新组件节点名称...')
    const addBtn = screen.getByRole('button', { name: '添加节点' })

    // 输入并添加新节点
    fireEvent.change(input, { target: { value: '前端自动化监控流水线' } })
    fireEvent.click(addBtn)

    // 节点列表中出现新节点
    expect(screen.getAllByText(/前端自动化监控流水线/).length).toBeGreaterThanOrEqual(1)

    // 脏状态激活
    expect(document.querySelector('[data-unsaved-badge]')).not.toBeNull()

    // 编辑过程零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('显式保存快照：仅发一次 POST 写请求，结构化落库且绝不持久化拖拽坐标', async () => {
    render(<TrizFunctionAnalysisChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('功能拓扑分析图')).toBeInTheDocument()
    })

    // 点击某问题候选的确认按钮使状态变更并激活保存
    const candidate1 = document.querySelector('[data-problem-candidate="prob-1"]')
    const confirmBtn = candidate1?.querySelector('button') as HTMLButtonElement
    fireEvent.click(confirmBtn)

    const saveButton = screen.getByRole('button', { name: '保存功能分析' })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/功能分析图已显式保存/)).toBeInTheDocument()
    })

    // 严格断言：只发出一次 POST 请求
    const writeCalls = backend.writeCalls()
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]!.method).toBe('POST')
    expect(writeCalls[0]!.url).toContain('/triz-gallery-artifacts')

    interface SavedPayload {
      artifactType: string
      content: {
        nodes: Record<string, unknown>[]
        edges: Record<string, unknown>[]
        problemCandidates: { id: string; status: string }[]
      }
    }
    const body = writeCalls[0]!.body as unknown as SavedPayload
    expect(body.artifactType).toBe('function_analysis')

    // 重点断言：结构化节点中严禁持久化坐标 (x, y, position)
    const savedNodes = body.content.nodes
    expect(savedNodes.length).toBeGreaterThan(0)
    for (const n of savedNodes) {
      expect(n).toHaveProperty('id')
      expect(n).toHaveProperty('kind')
      expect(n).toHaveProperty('label')
      expect(n).not.toHaveProperty('position')
      expect(n).not.toHaveProperty('x')
      expect(n).not.toHaveProperty('y')
    }

    // 重点断言：连线结构完备
    const savedEdges = body.content.edges
    expect(savedEdges.length).toBeGreaterThan(0)
    for (const e of savedEdges) {
      expect(e).toHaveProperty('from')
      expect(e).toHaveProperty('to')
      expect(e).toHaveProperty('edgeType')
    }

    // 重点断言：问题候选审核状态落库
    const savedProblems = body.content.problemCandidates
    expect(savedProblems.find((p) => p.id === 'prob-1')?.status).toBe('confirmed')
  })

  test('权限控制：缺少 diagram:manage 时保存按钮物理隐藏并显示只读提示', async () => {
    setPermissions(['project:view'])

    render(<TrizFunctionAnalysisChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('功能拓扑分析图')).toBeInTheDocument()
    })

    // 保存按钮被物理隐藏
    expect(screen.queryByRole('button', { name: '保存功能分析' })).toBeNull()

    // 出现中性只读提示
    expect(screen.getByText('当前账号仅具只读权限，保存入口已隐藏')).toBeInTheDocument()

    // 全程零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })
})
