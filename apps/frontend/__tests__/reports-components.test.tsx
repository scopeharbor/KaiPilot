import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ReportTemplateSelector } from '@/components/views/reports/ReportTemplateSelector'
import { ReportGenerateForm } from '@/components/views/reports/ReportGenerateForm'
import { ReportHistoryList } from '@/components/views/reports/ReportHistoryList'
import { ReportDetailPreview } from '@/components/views/reports/ReportDetailPreview'
import { ReportWarningsPanel } from '@/components/views/reports/ReportWarningsPanel'
import type { Report } from '@aiproj/types'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

const { exportMutateAsync, downloadMutateAsync } = vi.hoisted(() => ({
  exportMutateAsync: vi.fn(),
  downloadMutateAsync: vi.fn(),
}))

vi.mock('@/hooks/use-reports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-reports')>()
  return {
    ...actual,
    useExportReport: () => ({
      mutateAsync: exportMutateAsync,
      isPending: false,
      isSuccess: false,
    }),
    useDownloadReport: () => ({
      mutateAsync: downloadMutateAsync,
      isPending: false,
    }),
  }
})

/**
 * preset-project-reports —— 前端组件测试（tasks 6.6）。
 *
 * 覆盖：
 *   - 模板选择器四模板切换与 aria-checked 状态；
 *   - 生成表单在时间范围颠倒时前端拦截；
 *   - 生成表单提交 payload 携带 template + formatConfig；
 *   - 历史列表空状态；
 *   - 历史列表渲染 fileFormat 徽章；
 *   - warnings 三档均落地。
 */

describe('ReportTemplateSelector', () => {
  test('渲染四个白名单模板 radio 且默认 aria-checked 只在选中项', () => {
    const onChange = vi.fn()
    render(<ReportTemplateSelector value="progress" onChange={onChange} />)

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)
    const labels = radios.map((r) => r.textContent)
    expect(labels?.join('|')).toMatch(/进度/)
    expect(labels?.join('|')).toMatch(/延期/)
    expect(labels?.join('|')).toMatch(/工作量/)
    expect(labels?.join('|')).toMatch(/里程碑/)

    // 选中态：只有 progress 项 aria-checked=true
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true')
    for (const r of radios.slice(1)) {
      expect(r.getAttribute('aria-checked')).toBe('false')
    }
  })

  test('点击切换会回调 onChange', () => {
    const onChange = vi.fn()
    render(<ReportTemplateSelector value="progress" onChange={onChange} />)

    fireEvent.click(screen.getAllByRole('radio')[2]!) // 工作量
    expect(onChange).toHaveBeenCalledWith('workload')
  })
})

describe('ReportGenerateForm', () => {
  test('提交时携带 template 与 formatConfig（默认包含明细/warnings）', () => {
    const onSubmit = vi.fn()
    render(<ReportGenerateForm template="delay" onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: /生成报表/ }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0]?.[0]
    expect(payload?.template).toBe('delay')
    expect(payload?.formatConfig).toMatchObject({
      includeDetails: true,
      includeWarnings: true,
      locale: 'zh-CN',
    })
  })

  test('起始日期晚于结束日期时前端拦截 → 不触发 onSubmit', () => {
    const onSubmit = vi.fn()
    render(<ReportGenerateForm template="progress" onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-07-01' } })

    fireEvent.click(screen.getByRole('button', { name: /生成报表/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('起始日期不能晚于结束日期')
  })

  test('submitting=true 时按钮文案切换且禁用', () => {
    render(<ReportGenerateForm template="progress" onSubmit={vi.fn()} submitting />)
    const btn = screen.getByRole('button', { name: /生成中/ })
    expect(btn).toBeDisabled()
  })
})

describe('ReportHistoryList', () => {
  test('空数据渲染 EmptyState', () => {
    render(<ReportHistoryList reports={[]} onSelect={vi.fn()} />)
    expect(screen.getByText('暂无报表历史')).toBeInTheDocument()
  })

  test('渲染报表行、fileFormat 徽章、且点击回调', () => {
    const onSelect = vi.fn()
    const report: Report = {
      id: 42,
      organizationId: 1,
      projectId: 7,
      template: 'progress',
      title: '2026-07 进度快照',
      config: {},
      formatConfig: null,
      dataSnapshot: {
        template: 'progress',
        summary: {
          projectId: 7,
          projectName: 'Foo',
          overallProgressPercent: 50,
          totalTasks: 4,
          completedTasks: 2,
          inProgressTasks: 1,
          notStartedTasks: 1,
          blockedTasks: 0,
        },
        statusDistribution: [],
        wbsSummaries: [],
        criticalTasks: [],
        blockers: [],
        snapshotMetadata: {
          templateVersion: '1.0',
          generatedAt: '2026-07-08T00:00:00Z',
          generatedBy: 9,
          sourceRange: {},
          sourceDataHash: 'abc',
          warnings: [],
        },
      },
      fileFormat: 'markdown',
      generatedAt: '2026-07-08T00:00:00Z',
      generatedBy: 9,
      createdAt: '2026-07-08T00:00:00Z',
      updatedAt: '2026-07-08T00:00:00Z',
      deletedAt: null,
    }

    render(<ReportHistoryList reports={[report]} onSelect={onSelect} />)
    expect(screen.getByText('2026-07 进度快照')).toBeInTheDocument()
    // Badge 用 `uppercase` CSS 类做视觉大写，DOM 里仍是原始 'markdown'
    expect(screen.getByText(/^markdown$/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith(report)
  })
})

describe('ReportDetailPreview', () => {
  test('PM export/download flow calls export first, then creates browser download', async () => {
    exportMutateAsync.mockResolvedValue({
      data: {
        reportId: 42,
        format: 'markdown',
        downloadUrl: '/api/v1/reports/42/exports/markdown/download',
        filename: 'report-42.md',
        size: 128,
      },
    })
    downloadMutateAsync.mockResolvedValue({
      blob: new Blob(['# report'], { type: 'text/markdown' }),
      filename: 'report-42.md',
    })
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    const createObjectURL = vi.fn(() => 'blob:report-42')
    const revokeObjectURL = vi.fn()
    const clickAnchor = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    act(() => {
      useAuthStore.getState().setSession({
        user: {
          id: 9,
          fullName: 'PM',
          email: 'pm@example.com',
          isSuperAdmin: false,
          organizations: [{ id: 1, name: 'Org', slug: 'org', role: 'owner' }],
        },
        accessToken: accessTokenWith(['report:export', 'report:download', 'report:create']),
        refreshToken: 'refresh',
      })
    })

    render(<ReportDetailPreview report={makeProgressReport()} onRegenerate={vi.fn()} />)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0]!)
    expect(exportMutateAsync).toHaveBeenCalledWith({
      format: 'markdown',
      formatConfig: undefined,
    })

    fireEvent.click(buttons[1]!)
    expect(downloadMutateAsync).toHaveBeenCalledWith({ reportId: 42, format: 'markdown' })
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled())
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report-42')

    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    clickAnchor.mockRestore()
    act(() => useAuthStore.getState().clear())
  })
})

describe('ReportWarningsPanel', () => {
  test('三档 warnings 均以对应语义色渲染', () => {
    render(
      <ReportWarningsPanel
        warnings={[
          { level: 'info', message: '提示：无里程碑' },
          { level: 'warning', message: '资源模块未启用' },
          { level: 'critical', message: '依赖存在环路' },
        ]}
      />,
    )
    expect(screen.getByText('提示：无里程碑')).toBeInTheDocument()
    expect(screen.getByText('资源模块未启用')).toBeInTheDocument()
    expect(screen.getByText('依赖存在环路')).toBeInTheDocument()
    expect(screen.getByText('信息')).toBeInTheDocument()
    expect(screen.getByText('提示')).toBeInTheDocument()
    expect(screen.getByText('严重')).toBeInTheDocument()
  })

  test('warnings 为空时不渲染任何节点', () => {
    const { container } = render(<ReportWarningsPanel warnings={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

function makeProgressReport(): Report {
  return {
    id: 42,
    organizationId: 1,
    projectId: 7,
    template: 'progress',
    title: '2026-07 Progress Report',
    config: {},
    formatConfig: null,
    dataSnapshot: {
      template: 'progress',
      summary: {
        projectId: 7,
        projectName: 'Foo',
        overallProgressPercent: 50,
        totalTasks: 4,
        completedTasks: 2,
        inProgressTasks: 1,
        notStartedTasks: 1,
        blockedTasks: 0,
      },
      statusDistribution: [],
      wbsSummaries: [],
      criticalTasks: [],
      blockers: [],
      snapshotMetadata: {
        templateVersion: '1.0',
        generatedAt: '2026-07-08T00:00:00Z',
        generatedBy: 9,
        sourceRange: {},
        sourceDataHash: 'abc',
        warnings: [],
      },
    },
    fileFormat: 'markdown',
    generatedAt: '2026-07-08T00:00:00Z',
    generatedBy: 9,
    createdAt: '2026-07-08T00:00:00Z',
    updatedAt: '2026-07-08T00:00:00Z',
    deletedAt: null,
  }
}
