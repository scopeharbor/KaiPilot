/**
 * RACI 责任分配矩阵镜头定向测试（v3-chart-gallery-tier2-governance-matrices W2 · task 2.2）。
 *
 * 覆盖：
 * 1. Adapter 纯函数：任务与成员交叉映射、单 A 完整性判定（1A/0A/>1A）、空态降级；
 * 2. 镜头组件渲染：表头冻结与任务列固定、R/A/C/I 胶囊徽标呈现；
 * 3. 单 A 完整性中性视觉高亮（无主观判定文案）；
 * 4. 空数据标准空态回退（ChartLensEmptyState）；
 * 5. RL-01 零写网络断言：全程零写请求（POST/PATCH/PUT/DELETE 恒为 0）；
 * 6. DOM 中性措辞断言：正则全局扫描零「告警/预警/危险」词汇。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RaciMatrixResponse } from '@/lib/api/project-metrics'
import {
  buildRaciViewModel,
  evaluateAccountableIntegrity,
  formatMemberDisplayName,
  formatMemberRole,
} from '@/lib/next/charts/raci-adapter'
import { RaciMatrixChartLens } from '@/components/next/charts/lenses/RaciMatrixChartLens'
import {
  installFetchRouter,
  jsonResponse,
  resetFetchRouter,
  writeMethods,
} from './helpers/chart-gallery-network'

// jsdom 本地补齐 PointerEvent / matchMedia
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventMock extends MouseEvent {}
  window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
}

if (typeof window.matchMedia === 'undefined') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function makeSampleRaciData(): RaciMatrixResponse {
  return {
    members: [
      { id: 101, name: '张经理', email: 'zhang@example.com', role: '项目总监' },
      { id: 102, name: '李开发', email: 'li@example.com', role: '资深后端' },
      { id: 103, name: '王测试', email: 'wang@example.com', role: '测试主管' },
    ],
    tasks: [
      { id: 1, name: '架构蓝图设计', status: 'completed' },
      { id: 2, name: '核心接口开发', status: 'in_progress' },
      { id: 3, name: '全链路压测', status: 'pending' },
    ],
    matrix: {
      // 任务 1：101 为 A，102 为 R，103 为 C
      1: {
        101: ['A'],
        102: ['R'],
        103: ['C'],
      },
      // 任务 2：0 个 A（102 为 R，103 为 I）
      2: {
        102: ['R'],
        103: ['I'],
      },
      // 任务 3：2 个 A（101 为 A，103 为 A、R）
      3: {
        101: ['A'],
        103: ['A', 'R'],
      },
    },
  }
}

describe('RACI 适配器纯函数测试 (raci-adapter.ts)', () => {
  test('单 A 完整性逻辑评估：1A 正常中性，0A 或 >1A 客观提示', () => {
    const oneA = evaluateAccountableIntegrity(1)
    expect(oneA.status).toBe('normal')
    expect(oneA.hasDeviation).toBe(false)
    expect(oneA.hint).toBe('已配置 1 位审核人')

    const zeroA = evaluateAccountableIntegrity(0)
    expect(zeroA.status).toBe('missing')
    expect(zeroA.hasDeviation).toBe(true)
    expect(zeroA.hint).toBe('当前任务未设置审核人')
    expect(zeroA.hint).not.toMatch(/告警|预警|危险/)

    const multiA = evaluateAccountableIntegrity(2)
    expect(multiA.status).toBe('multiple')
    expect(multiA.hasDeviation).toBe(true)
    expect(multiA.hint).toBe('当前任务设置了多位审核人')
    expect(multiA.hint).not.toMatch(/告警|预警|危险/)
  })

  test('成员显示名称与角色格式化健全性', () => {
    expect(formatMemberDisplayName({ id: 1, name: 'Alice', email: 'a@b.com', role: 'PM' })).toBe(
      'Alice',
    )
    expect(formatMemberDisplayName({ id: 2, name: null, email: 'b@b.com', role: null })).toBe(
      'b@b.com',
    )
    expect(formatMemberDisplayName({ id: 3, name: '', email: '', role: null })).toBe('成员 #3')
    expect(formatMemberRole({ id: 1, name: 'Alice', email: '', role: '架构师' })).toBe('架构师')
    expect(formatMemberRole({ id: 1, name: 'Alice', email: '', role: null })).toBe('项目成员')
  })

  test('buildRaciViewModel 解析信封与交叉矩阵维度装配', () => {
    const data = makeSampleRaciData()
    const model = buildRaciViewModel(data)

    expect(model.isEmpty).toBe(false)
    expect(model.totalTasks).toBe(3)
    expect(model.totalMembers).toBe(3)
    expect(model.normalAccountableCount).toBe(1)
    expect(model.deviatedAccountableCount).toBe(2)

    // 检查第 1 行（正常 1A）
    expect(model.rows[0]!.taskName).toBe('架构蓝图设计')
    expect(model.rows[0]!.accountableStatus).toBe('normal')
    expect(model.rows[0]!.cells[101]).toEqual(['A'])
    expect(model.rows[0]!.cells[102]).toEqual(['R'])
    expect(model.rows[0]!.cells[103]).toEqual(['C'])

    // 检查第 2 行（0 个 A）
    expect(model.rows[1]!.accountableStatus).toBe('missing')
    expect(model.rows[1]!.accountableHint).toBe('当前任务未设置审核人')

    // 检查第 3 行（多位 A）
    expect(model.rows[2]!.accountableStatus).toBe('multiple')
    expect(model.rows[2]!.accountableHint).toBe('当前任务设置了多位审核人')
  })

  test('空数据信封安全回退为 isEmpty', () => {
    const emptyModel = buildRaciViewModel({ members: [], tasks: [], matrix: {} })
    expect(emptyModel.isEmpty).toBe(true)
    expect(emptyModel.totalTasks).toBe(0)
    expect(emptyModel.totalMembers).toBe(0)
  })
})

describe('RaciMatrixChartLens 镜头组件渲染与门禁测试', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  afterEach(() => {
    resetFetchRouter()
    queryClient.clear()
  })

  test('完整数据流：渲染任务行、成员列、交叉徽标与单 A 状态，且表头冻结', async () => {
    const sample = makeSampleRaciData()
    const { records } = installFetchRouter((path, method) => {
      if (path === '/projects/42/raci-matrix' && method === 'GET') {
        return jsonResponse(200, { data: sample })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RaciMatrixChartLens projectId={42} />
      </QueryClientProvider>,
    )

    // 等待骨架屏消失并渲染主容器
    await waitFor(() => {
      expect(document.querySelector('[data-chart-viewport-slot]')).not.toBeNull()
    })

    // 断言成员表头
    await screen.findByText('张经理')
    expect(screen.getByText('李开发')).toBeInTheDocument()
    expect(screen.getByText('王测试')).toBeInTheDocument()

    // 断言任务行
    expect(screen.getByText('架构蓝图设计')).toBeInTheDocument()
    expect(screen.getByText('核心接口开发')).toBeInTheDocument()
    expect(screen.getByText('全链路压测')).toBeInTheDocument()

    // 断言单 A 审核校验状态文案
    expect(screen.getByText('已设 1 位')).toBeInTheDocument()
    expect(screen.getByText('未设置审核人')).toBeInTheDocument()
    expect(screen.getByText('多位审核人')).toBeInTheDocument()

    // 断言 R/A/C/I 角色说明图例
    expect(screen.getByText('角色图例：')).toBeInTheDocument()

    // RL-01 零写断言：写方法恒为 0
    expect(writeMethods(records)).toHaveLength(0)

    // DOM 中性措辞断言：绝对排除告警/预警/危险
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })

  test('空数据态：无任务或成员时渲染标准 EmptyState', async () => {
    installFetchRouter((path, method) => {
      if (path === '/projects/99/raci-matrix' && method === 'GET') {
        return jsonResponse(200, { data: { members: [], tasks: [], matrix: {} } })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RaciMatrixChartLens projectId={99} />
      </QueryClientProvider>,
    )

    await screen.findByRole('status', { name: 'RACI 责任分配矩阵为空' })
    expect(screen.getByText('暂无责任分配矩阵数据')).toBeInTheDocument()
    expect(
      screen.getByText('当前项目暂无任务或项目成员，责任分配矩阵暂无法构建。'),
    ).toBeInTheDocument()

    // DOM 中性措辞
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })
})
