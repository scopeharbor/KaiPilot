import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskExternalLinksPanel } from '@/components/views/tasks/TaskExternalLinksPanel'
import type { ExternalLinkDto, CodeRepositoryCiSummary } from '@aiproj/types'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const deleteMock = vi.fn()
const refreshMock = vi.fn()
let canUpdate = true

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(
    (selector?: (state: { hasPermission: (permission: string) => boolean }) => unknown) => {
      const state = {
        hasPermission: (permission: string) => canUpdate && permission === 'task:update',
      }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock('@/hooks/use-task-external-links', () => ({
  useTaskExternalLinks: (...args: unknown[]) => listMock(...args),
  useCreateTaskExternalLink: (...args: unknown[]) => createMock(...args),
  useUpdateTaskExternalLink: (...args: unknown[]) => updateMock(...args),
  useDeleteTaskExternalLink: (...args: unknown[]) => deleteMock(...args),
  useRefreshTaskExternalLink: (...args: unknown[]) => refreshMock(...args),
}))

function createLink(overrides: Partial<ExternalLinkDto> = {}): ExternalLinkDto {
  return {
    id: 42,
    provider: 'github',
    linkType: 'pull_request',
    repositoryOwner: 'owner',
    repositoryName: 'repo',
    externalNumber: 7,
    externalId: '7',
    externalTitle: 'Original pull request',
    externalStatus: 'open',
    externalUrl: 'https://github.com/owner/repo/pull/7',
    statusSource: 'manual',
    lastObservedAt: '2026-07-22T01:02:03.000Z',
    note: null,
    ciSummary: null,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    createdBy: 1,
    updatedBy: 1,
    ...overrides,
  }
}

function setup(overrides: Partial<ExternalLinkDto> = {}) {
  const refreshMutation = {
    mutateAsync: vi.fn().mockResolvedValue({
      data: { id: 42, result: 'success', message: 'GitHub 链接状态已刷新' },
    }),
    isPending: false,
  }
  const deleteMutation = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
  const updateMutation = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
  const createMutation = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
  listMock.mockReturnValue({
    data: [createLink(overrides)],
    isLoading: false,
    isError: false,
  })
  refreshMock.mockReturnValue(refreshMutation)
  deleteMock.mockReturnValue(deleteMutation)
  updateMock.mockReturnValue(updateMutation)
  createMock.mockReturnValue(createMutation)
  const view = render(<TaskExternalLinksPanel projectId={1} taskId={100} />)
  return { ...view, refreshMutation, deleteMutation, updateMutation, createMutation }
}

describe('TaskExternalLinksPanel refresh states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canUpdate = true
  })

  it('shows refresh controls only for users with task:update', () => {
    const { unmount } = setup()

    expect(screen.getByRole('button', { name: '刷新 github #7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '手动更新 #7' })).toBeInTheDocument()

    unmount()
    canUpdate = false
    vi.clearAllMocks()
    setup()

    expect(screen.queryByRole('button', { name: '刷新 github #7' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '手动更新 #7' })).not.toBeInTheDocument()
  })

  it('displays successful readonly sync and last observed time', async () => {
    const { refreshMutation } = setup({ statusSource: 'github_readonly', externalStatus: 'merged' })

    fireEvent.click(screen.getByRole('button', { name: '刷新 github #7' }))

    await waitFor(() => expect(refreshMutation.mutateAsync).toHaveBeenCalledWith(42))
    expect(await screen.findByText('GitHub 链接状态已刷新')).toBeInTheDocument()
    expect(screen.getByText(/GitHub 只读/)).toBeInTheDocument()
    expect(screen.getByText(/上次观测/)).toBeInTheDocument()
    expect(screen.getByText('Merged')).toBeInTheDocument()
  })

  it('keeps the existing snapshot visible when refresh fails', async () => {
    const { refreshMutation } = setup()
    refreshMutation.mutateAsync.mockResolvedValueOnce({
      data: {
        id: 42,
        result: 'reauthorization_required',
        message: 'GitHub 授权已过期，请重新授权',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '刷新 github #7' }))

    expect(await screen.findByText('GitHub 授权已过期，请重新授权')).toBeInTheDocument()
    expect(screen.getByText(/前往集成设置重新连接/)).toBeInTheDocument()
    expect(screen.getByText('Original pull request')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('shows bounded retry guidance for rate limits and does not call other write mutations', async () => {
    const { refreshMutation, createMutation, updateMutation, deleteMutation } = setup()
    refreshMutation.mutateAsync.mockResolvedValueOnce({
      data: {
        id: 42,
        result: 'rate_limited',
        message: '请求过于频繁，请稍后重试',
        retryAfter: 60,
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '刷新 github #7' }))

    expect(await screen.findByText(/建议 60 秒后重试/)).toBeInTheDocument()
    expect(refreshMutation.mutateAsync).toHaveBeenCalledTimes(1)
    expect(createMutation.mutateAsync).not.toHaveBeenCalled()
    expect(updateMutation.mutateAsync).not.toHaveBeenCalled()
    expect(deleteMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('keeps GitLab provider-specific degraded copy available', async () => {
    const { refreshMutation } = setup({
      provider: 'gitlab',
      linkType: 'merge_request',
      externalUrl: 'https://gitlab.com/group/project/-/merge_requests/7',
      statusSource: 'pre_connection_only',
    })
    refreshMutation.mutateAsync.mockResolvedValueOnce({
      data: {
        id: 42,
        result: 'pre_connection_only',
        message: 'GitLab 当前保持预连接降级',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '刷新 gitlab #7' }))

    expect(await screen.findByText('GitLab 当前保持预连接降级')).toBeInTheDocument()
    expect(screen.getByText(/预连接模式/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// v2-5-code-repository-ci-status-display —— 6.4 / 6.5 CI 展示与 no-task-write 测试
// ---------------------------------------------------------------------------

describe('TaskExternalLinksPanel CI 展示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canUpdate = true
  })

  function setupWithCi(
    ciSummary: CodeRepositoryCiSummary | null,
    overrides: Partial<ExternalLinkDto> = {},
  ) {
    const refreshMutation = {
      mutateAsync: vi.fn().mockResolvedValue({
        data: { id: 42, result: 'success', message: '链接状态已刷新' },
      }),
      isPending: false,
    }
    const deleteMutation = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
    const updateMutation = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
    const createMutation = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
    listMock.mockReturnValue({
      data: [createLink({ ciSummary: ciSummary, ...overrides })],
      isLoading: false,
      isError: false,
    })
    refreshMock.mockReturnValue(refreshMutation)
    deleteMock.mockReturnValue(deleteMutation)
    updateMock.mockReturnValue(updateMutation)
    createMock.mockReturnValue(createMutation)
    const view = render(<TaskExternalLinksPanel projectId={1} taskId={100} />)
    return { ...view, refreshMutation, deleteMutation, updateMutation, createMutation }
  }

  it('task:view 只读展示 CI 标识（无刷新动作）', () => {
    canUpdate = false
    const ciSummary: CodeRepositoryCiSummary = {
      state: 'passed',
      conclusion: 'success',
      label: 'CI',
      source: 'github_checks',
      targetUrl: 'https://github.com/owner/repo/runs/1',
      observedAt: '2026-07-23T10:00:00.000Z',
      updatedAt: '2026-07-23T10:00:00.000Z',
      reasonCode: 'ok',
      isStale: false,
    }
    setupWithCi(ciSummary)
    // 只读用户能看到 CI 状态标识
    expect(screen.getByTestId('ci-status-row')).toBeInTheDocument()
    expect(screen.getByText('通过')).toBeInTheDocument()
    // 但看不到刷新按钮
    expect(screen.queryByRole('button', { name: /刷新/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /手动更新/ })).not.toBeInTheDocument()
  })

  it('task:update 用户看到 CI 标识和刷新动作', async () => {
    const ciSummary: CodeRepositoryCiSummary = {
      state: 'passed',
      conclusion: 'success',
      label: 'CI',
      source: 'github_checks',
      targetUrl: 'https://github.com/owner/repo/runs/1',
      observedAt: '2026-07-23T10:00:00.000Z',
      updatedAt: '2026-07-23T10:00:00.000Z',
      reasonCode: 'ok',
      isStale: false,
    }
    setupWithCi(ciSummary)
    // CI 标识可见
    expect(screen.getByTestId('ci-status-row')).toBeInTheDocument()
    expect(screen.getByText('通过')).toBeInTheDocument()
    // 刷新按钮可见
    expect(screen.getByRole('button', { name: '刷新 github #7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '手动更新 #7' })).toBeInTheDocument()
  })

  it('展示 passed / failed / running / pending / cancelled 等状态', () => {
    const states: Array<{ state: CodeRepositoryCiSummary['state']; label: string }> = [
      { state: 'passed', label: '通过' },
      { state: 'failed', label: '失败' },
      { state: 'running', label: '运行中' },
      { state: 'pending', label: '等待中' },
      { state: 'cancelled', label: '已取消' },
    ]
    for (const { state, label } of states) {
      const ciSummary: CodeRepositoryCiSummary = {
        state,
        conclusion: state === 'passed' ? 'success' : state === 'failed' ? 'failure' : 'pending',
        label: 'CI',
        source: 'github_checks',
        targetUrl: null,
        observedAt: '2026-07-23T10:00:00.000Z',
        updatedAt: '2026-07-23T10:00:00.000Z',
        reasonCode: 'ok',
        isStale: false,
      }
      const { unmount } = setupWithCi(ciSummary)
      expect(screen.getByTestId('ci-status-row')).toBeInTheDocument()
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('手工状态更新仍可用（CI 摘要不影响手动更新）', async () => {
    const ciSummary: CodeRepositoryCiSummary = {
      state: 'passed',
      conclusion: 'success',
      label: 'CI',
      source: 'github_checks',
      targetUrl: 'https://github.com/owner/repo/runs/1',
      observedAt: '2026-07-23T10:00:00.000Z',
      updatedAt: '2026-07-23T10:00:00.000Z',
      reasonCode: 'ok',
      isStale: false,
    }
    const { updateMutation } = setupWithCi(ciSummary)

    // 点击手动更新按钮
    fireEvent.click(screen.getByRole('button', { name: '手动更新 #7' }))
    expect(screen.getByText('编辑外部链接')).toBeInTheDocument()
    // 关闭弹窗
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    // 手动更新功能不受 CI 摘要影响
    expect(updateMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('刷新失败不抹掉既有 CI 摘要', async () => {
    const ciSummary: CodeRepositoryCiSummary = {
      state: 'passed',
      conclusion: 'success',
      label: 'CI',
      source: 'github_checks',
      targetUrl: 'https://github.com/owner/repo/runs/1',
      observedAt: '2026-07-23T10:00:00.000Z',
      updatedAt: '2026-07-23T10:00:00.000Z',
      reasonCode: 'ok',
      isStale: false,
    }
    const { refreshMutation } = setupWithCi(ciSummary)
    // 刷新失败
    refreshMutation.mutateAsync.mockResolvedValueOnce({
      data: { id: 42, result: 'forbidden', message: '无权访问该仓库' },
    })

    fireEvent.click(screen.getByRole('button', { name: '刷新 github #7' }))

    // 失败消息显示
    expect(await screen.findByText('无权访问该仓库')).toBeInTheDocument()
    // CI 标识仍然可见（旧摘要被保留）
    expect(screen.getByTestId('ci-status-row')).toBeInTheDocument()
    expect(screen.getByText('通过')).toBeInTheDocument()
    // 来源标签可见（文字可能被 · 拆分，用函数匹配器）
    expect(screen.getByText((content) => content.includes('GitHub Checks'))).toBeInTheDocument()
  })

  it('无摘要空态（无 ciSummary 时无 CI 行）', () => {
    setupWithCi(null)
    // 链接卡片正常渲染
    expect(screen.getByText('Original pull request')).toBeInTheDocument()
    // 但没有 CI 状态行
    expect(screen.queryByTestId('ci-status-row')).not.toBeInTheDocument()
    // 没有 CI 标签
    expect(screen.queryByText('CI')).not.toBeInTheDocument()
  })

  it('展示 stale 过期提示', () => {
    const ciSummary: CodeRepositoryCiSummary = {
      state: 'passed',
      conclusion: 'success',
      label: 'CI',
      source: 'webhook',
      targetUrl: null,
      observedAt: '2026-07-22T10:00:00.000Z',
      updatedAt: '2026-07-22T10:00:00.000Z',
      reasonCode: 'ok',
      isStale: true,
    }
    setupWithCi(ciSummary)
    // stale 标识渲染（文本"可能已过期"可能被 · 拆分重复出现，用 testid 确认）
    const staleElements = screen.getAllByTestId('ci-stale')
    expect(staleElements.length).toBeGreaterThanOrEqual(1)
    expect(staleElements[0]).toHaveTextContent(/可能已过期/)
  })

  it('展示 needs_reauthorization 状态', () => {
    const ciSummary: CodeRepositoryCiSummary = {
      state: 'needs_reauthorization',
      conclusion: 'neutral',
      label: 'CI',
      source: 'github_checks',
      targetUrl: null,
      observedAt: '2026-07-22T10:00:00.000Z',
      updatedAt: '2026-07-22T10:00:00.000Z',
      reasonCode: 'needs_reauthorization',
      isStale: false,
    }
    setupWithCi(ciSummary)
    expect(screen.getByTestId('ci-status-row')).toBeInTheDocument()
    // CI 状态行显示 reason code 提示（文字可能被 · 拆分）
    expect(
      screen.getByText((content) => content.includes('需重新授权后再刷新')),
    ).toBeInTheDocument()
  })

  it('展示 unavailable（限流）状态', () => {
    const ciSummary: CodeRepositoryCiSummary = {
      state: 'unavailable',
      conclusion: 'neutral',
      label: 'CI',
      source: 'github_checks',
      targetUrl: null,
      observedAt: '2026-07-22T10:00:00.000Z',
      updatedAt: '2026-07-22T10:00:00.000Z',
      reasonCode: 'rate_limited',
      isStale: false,
    }
    setupWithCi(ciSummary)
    expect(screen.getByTestId('ci-status-row')).toBeInTheDocument()
    expect(screen.getByText((content) => content.includes('限流中，稍后重试'))).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // 6.5 前端 no-task-write 断言
  // -------------------------------------------------------------------------

  it('CI 状态变化不触发任务写 mutation（no-task-write）', async () => {
    const ciSummary: CodeRepositoryCiSummary = {
      state: 'passed',
      conclusion: 'success',
      label: 'CI',
      source: 'github_checks',
      targetUrl: null,
      observedAt: '2026-07-23T10:00:00.000Z',
      updatedAt: '2026-07-23T10:00:00.000Z',
      reasonCode: 'ok',
      isStale: false,
    }
    const { refreshMutation, updateMutation, createMutation, deleteMutation } =
      setupWithCi(ciSummary)

    // 刷新（含 CI 变化）只触发 refresh mutation，不触发任何任务/项目写 mutation
    fireEvent.click(screen.getByRole('button', { name: '刷新 github #7' }))
    await waitFor(() => expect(refreshMutation.mutateAsync).toHaveBeenCalledTimes(1))

    // 断言：不触发外链 create/update/delete
    expect(createMutation.mutateAsync).not.toHaveBeenCalled()
    expect(updateMutation.mutateAsync).not.toHaveBeenCalled()
    expect(deleteMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('CI passed/failed/running 各状态刷新均不触发任务 mutation', async () => {
    for (const tokenState of ['passed', 'failed', 'running'] as const) {
      const ciSummary: CodeRepositoryCiSummary = {
        state: tokenState,
        conclusion: tokenState === 'passed' ? 'success' : 'failure',
        label: 'CI',
        source: 'github_checks',
        targetUrl: null,
        observedAt: '2026-07-23T10:00:00.000Z',
        updatedAt: '2026-07-23T10:00:00.000Z',
        reasonCode: 'ok',
        isStale: false,
      }
      const refreshMutation = {
        mutateAsync: vi.fn().mockResolvedValue({
          data: { id: 42, result: 'success', message: '链接状态已刷新', ciSummary },
        }),
        isPending: false,
      }
      const createMutation = { mutateAsync: vi.fn(), isPending: false }
      const updateMutation = { mutateAsync: vi.fn(), isPending: false }
      const deleteMutation = { mutateAsync: vi.fn(), isPending: false }

      listMock.mockReturnValue({
        data: [createLink({ ciSummary })],
        isLoading: false,
        isError: false,
      })
      refreshMock.mockReturnValue(refreshMutation)
      createMock.mockReturnValue(createMutation)
      updateMock.mockReturnValue(updateMutation)
      deleteMock.mockReturnValue(deleteMutation)

      const { unmount } = render(<TaskExternalLinksPanel projectId={1} taskId={100} />)
      fireEvent.click(screen.getByRole('button', { name: '刷新 github #7' }))

      await waitFor(() => expect(refreshMutation.mutateAsync).toHaveBeenCalledTimes(1))
      expect(createMutation.mutateAsync).not.toHaveBeenCalled()
      expect(updateMutation.mutateAsync).not.toHaveBeenCalled()
      expect(deleteMutation.mutateAsync).not.toHaveBeenCalled()

      unmount()
      vi.clearAllMocks()
    }
  })
})
