import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ProjectReportsV2Page from '@/app/(dashboard)/projects/[id]/reports-v2/page'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '1' }),
  useRouter: () => ({ push: vi.fn() }),
}))

// Mock API module
vi.mock('@/hooks/use-reports-v2', () => ({
  useV2Templates: () => ({
    data: {
      data: [
        {
          templateId: 'progress',
          name: '进度报告',
          description: '项目进展情况',
          supportedFormats: ['markdown', 'pdf'],
          requiredDataSources: ['task_summary'],
          optionalDataSources: [],
          defaultDateRange: 'all',
          permission: 'report:view',
        },
        {
          templateId: 'project-weekly',
          name: '项目周报',
          description: '本周任务完成情况',
          supportedFormats: ['markdown', 'pdf'],
          requiredDataSources: ['task_summary'],
          optionalDataSources: ['risk_summary'],
          defaultDateRange: 'week',
          permission: 'report:view',
        },
      ],
    },
    isLoading: false,
  }),
  useV2Preview: () => ({
    data: null,
    isFetching: false,
  }),
  useV2ListVersions: () => ({
    data: { data: [] },
    isLoading: false,
  }),
  useV2CreateVersion: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useV2ListExports: () => ({
    data: null,
    isLoading: false,
  }),
  useV2CreateExport: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useV2AiReview: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectReportsV2Page />
    </QueryClientProvider>,
  )
}

describe('ReportV2 Workspace Page', () => {
  test('渲染模板目录', async () => {
    renderPage()
    expect(screen.getByText('报表工作台（V2）')).toBeTruthy()
    expect(screen.getByText('模板目录')).toBeTruthy()
    expect(screen.getByText('进度报告')).toBeTruthy()
    expect(screen.getByText('项目周报')).toBeTruthy()
  })

  test('渲染生成参数区', async () => {
    renderPage()
    expect(screen.getByText('生成参数')).toBeTruthy()
    expect(screen.getByText('启用 AI 草稿')).toBeTruthy()
    expect(screen.getAllByText('预览').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('生成')).toBeTruthy()
  })

  test('渲染版本历史区', async () => {
    renderPage()
    expect(screen.getByText('版本历史')).toBeTruthy()
    expect(screen.getByText('暂无版本记录')).toBeTruthy()
  })

  test('AI 草稿复选框可交互', async () => {
    renderPage()
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
  })

  test('渲染预览区（空状态）', async () => {
    renderPage()
    expect(screen.getByText('选择模板')).toBeTruthy()
  })
})
