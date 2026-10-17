import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvaluationConsole } from '@/components/dev/ai-m0/EvaluationConsole'

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  execute: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/lib/api/ai-connections', () => ({
  aiConnectionsApi: { list: mocks.list },
}))

vi.mock('@/lib/api/ai-m0-evaluation', () => ({
  aiM0EvaluationApi: {
    plan: mocks.plan,
    execute: mocks.execute,
  },
}))

function renderConsole() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EvaluationConsole />
    </QueryClientProvider>,
  )
}

describe('AI M0 evaluation console', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.list.mockResolvedValue([])
    mocks.plan.mockResolvedValue({
      steps: [
        {
          id: 'prompt:sw-01:01',
          inputId: 'sw-01',
          requestedStrategy: 'prompt',
          repetition: 1,
          status: 'pending',
          attempts: 0,
        },
      ],
      inputSetHash: 'abc',
      total: 1,
      repetitions: 1,
      temperature: 0,
    })
    mocks.execute.mockResolvedValue({
      stepId: 'prompt:sw-01:01',
      inputId: 'sw-01',
      inputSetHash: 'abc',
      repetition: 1,
      strategy: 'prompt',
      requestedStrategy: 'prompt',
      effectiveStrategy: 'prompt',
      mode: 'dry_run',
      bucket: 'strict',
      firstTokenMs: 1,
      totalMs: 2,
      retries: 0,
      triggeredErrors: [],
      markerCoverage: 1,
      outputTokens: null,
      provider: 'mock',
      model: 'mock-v1',
      connectionId: null,
      usingRealAdapter: false,
      evidenceEligible: false,
      missingMarkerFields: [],
      appliedFixes: [],
      measuredAt: '2026-07-06T00:00:00.000Z',
    })
  })

  it('无 key 时可准备并完成开发演练，且明确不可作为证据', async () => {
    renderConsole()
    fireEvent.click(screen.getByRole('button', { name: '准备评测计划' }))
    expect(await screen.findByRole('button', { name: '确认开始 1 步' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认开始 1 步' }))
    await waitFor(() => expect(screen.getByText(/1\/1 已完成/)).toBeInTheDocument())
    expect(screen.getByText('开发演练 · 不可作为证据')).toBeInTheDocument()
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dry_run' }))
  })

  it('真实模式没有可用连接时在计划请求前阻止并给出配置引导', async () => {
    renderConsole()
    fireEvent.click(screen.getByRole('button', { name: '真实证据' }))
    fireEvent.click(screen.getByRole('button', { name: '准备评测计划' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('已填写 API key 且测试成功')
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(screen.getByText(/填写 API key 后先在上方/)).toBeInTheDocument()
  })
})
