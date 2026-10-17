import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DirectoryActionDialog } from '@/components/plugin-registry/DirectoryActionDialog'
import { PluginDirectoryWorkbench } from '@/components/plugin-registry/PluginDirectoryWorkbench'

/**
 * v3-organization-private-plugin-directory —— 目录管理动作 Dialog 测试（task 4.4）。
 *
 * 覆盖：加载/成功/失败/stale、目录 release 与安装实例的显式区分、
 * 阻断项禁止提交、审批≠生效的分步表达、键盘可达、主题/密度令牌、
 * 简体中文非市场文案、以及无权限时动作入口完全不渲染。
 */

const hookMocks = vi.hoisted(() => ({
  useDirectoryReleases: vi.fn(),
  useDirectoryReleaseDetail: vi.fn(),
  useAffectedInstallations: vi.fn(),
  useDirectoryRollbackPreview: vi.fn(),
  useCreateDirectoryChange: vi.fn(),
  useConfirmDirectoryChange: vi.fn(),
}))

vi.mock('@/hooks/use-plugin-directory', () => hookMocks)

const flowMocks = vi.hoisted(() => ({
  approvePluginChangeRequest: vi.fn(),
  issueConfirmHandle: vi.fn(),
  pluginChangeRequestKeys: { all: ['plugin-change-requests'] },
}))

vi.mock('@/lib/api/plugin-change-requests', () => flowMocks)

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({}),
  selectEffectiveOrganizationId: () => 7,
}))

const RELEASE = {
  releaseId: '11',
  pluginIdentity: 'com.example.alpha',
  version: '2.0.0',
  status: 'approved' as const,
  createdAt: '2026-08-24T00:00:00Z',
  compatibilityAllowed: true,
  activeInstallationCount: 1,
  uninstalledInstallationCount: 0,
}

const INSTALLED_INSTANCE = {
  id: '7',
  pluginId: 'com.example.alpha',
  version: '2.0.0',
  status: 'enabled',
  installedAt: null,
  uninstalledAt: null,
}

function rollbackDiff(overrides: Record<string, unknown> = {}) {
  return {
    currentReleaseId: '12',
    targetReleaseId: '11',
    currentVersion: '2.0.0',
    targetVersion: '1.0.0',
    manifestDigestBefore: 'sha256:manifest-new',
    manifestDigestAfter: 'sha256:manifest-old',
    packageDigestBefore: 'sha256:pkg-new',
    packageDigestAfter: 'sha256:pkg-old',
    compatibilityDigestBefore: 'sha256:compat-new',
    compatibilityDigestAfter: 'sha256:compat-old',
    permissionDelta: { added: [], removed: [], unchanged: ['project:view'] },
    blockingFindings: [],
    affectedActiveCount: 1,
    ...overrides,
  }
}

function mutationMock(overrides: Record<string, unknown> = {}) {
  return { mutateAsync: vi.fn(), isPending: false, ...overrides }
}

function renderDialog(props: Partial<React.ComponentProps<typeof DirectoryActionDialog>> = {}) {
  return render(
    <DirectoryActionDialog
      open
      onOpenChange={vi.fn()}
      action="disable"
      releaseId="11"
      pluginIdentity="com.example.alpha"
      version="2.0.0"
      {...props}
    />,
  )
}

describe('DirectoryActionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookMocks.useAffectedInstallations.mockReturnValue({
      data: { data: [INSTALLED_INSTANCE], meta: { total: 1, page: 1, perPage: 20, totalPages: 1 } },
      isLoading: false,
      error: null,
    })
    hookMocks.useDirectoryRollbackPreview.mockReturnValue({
      data: rollbackDiff(),
      isLoading: false,
      error: null,
    })
    hookMocks.useCreateDirectoryChange.mockReturnValue(
      mutationMock({
        mutateAsync: vi.fn().mockResolvedValue({
          data: {
            requestUid: 'chg-1',
            state: 'pending-approval',
            approvalRequired: true,
            rollbackDiff: null,
          },
        }),
      }),
    )
    hookMocks.useConfirmDirectoryChange.mockReturnValue(
      mutationMock({ mutateAsync: vi.fn().mockResolvedValue({ data: {} }) }),
    )
    flowMocks.approvePluginChangeRequest.mockResolvedValue({ data: {} })
    flowMocks.issueConfirmHandle.mockResolvedValue({
      data: { handle: 'handle-abc', expiresAt: '2026-08-25T00:00:00Z' },
    })
  })

  // ── 目录 release ≠ 安装实例 ───────────────────────────────────────────
  it('把目录条目与已安装实例分成两块，且明示实例保持不变', () => {
    renderDialog({ action: 'disable' })

    const target = screen.getByLabelText('目录条目（本次动作的对象）')
    expect(within(target).getByText('com.example.alpha')).toBeInTheDocument()
    expect(within(target).getByText('v2.0.0')).toBeInTheDocument()

    const instances = screen.getByLabelText('组织内已安装实例（本次动作不会改动）')
    // 每行实例都标注「保持不变」，分区说明里也复述一次
    expect(within(instances).getAllByText('保持不变').length).toBeGreaterThan(0)
    expect(
      screen.getByText(/停止分发只影响目录的可发现性，已安装实例保持原状，不会被停用或卸载。/),
    ).toBeInTheDocument()
  })

  // ── 加载态 ────────────────────────────────────────────────────────────
  it('回滚预览加载中显示骨架且不渲染差异行', () => {
    hookMocks.useDirectoryRollbackPreview.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })
    renderDialog({ action: 'rollback' })

    expect(screen.queryByLabelText('回滚差异')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /提交回滚申请/ })).toBeDisabled()
  })

  // ── 成功路径：提交 → 审批 → 确认 ─────────────────────────────────────
  it('提交后停在「尚未生效」，审批与最终确认各需一次显式点击', async () => {
    const create = vi.fn().mockResolvedValue({
      data: {
        requestUid: 'chg-9',
        state: 'pending-approval',
        approvalRequired: true,
        rollbackDiff: null,
      },
    })
    const confirm = vi.fn().mockResolvedValue({ data: {} })
    hookMocks.useCreateDirectoryChange.mockReturnValue(mutationMock({ mutateAsync: create }))
    hookMocks.useConfirmDirectoryChange.mockReturnValue(mutationMock({ mutateAsync: confirm }))

    renderDialog({ action: 'disable' })

    fireEvent.click(screen.getByRole('button', { name: '提交停止分发申请' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ releaseId: '11', action: 'disable' }))
    expect(await screen.findByText(/尚未生效/)).toBeInTheDocument()
    // 提交这一步绝不自动串联确认
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '由另一位管理员审批' }))
    await waitFor(() => expect(flowMocks.issueConfirmHandle).toHaveBeenCalledWith(7, 'chg-9'))
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: '最终确认并生效' }))
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({ requestUid: 'chg-9', handle: 'handle-abc' }),
    )
    expect(
      await screen.findByText(/已生效。目录条目已更新；已安装实例未发生任何改动。/),
    ).toBeInTheDocument()
  })

  // ── 失败路径 ──────────────────────────────────────────────────────────
  it('自审拒绝以中文说明呈现，且不推进到确认步骤', async () => {
    flowMocks.approvePluginChangeRequest.mockRejectedValue({
      code: 'plugin-change-self-approval-denied',
      message: 'self approval denied',
    })
    renderDialog({ action: 'disable' })

    fireEvent.click(screen.getByRole('button', { name: '提交停止分发申请' }))
    fireEvent.click(await screen.findByRole('button', { name: '由另一位管理员审批' }))

    expect(
      await screen.findByText('不能审批自己发起的申请，请由另一位管理员审批。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '最终确认并生效' })).not.toBeInTheDocument()
  })

  it('提交失败时保留在编辑态并显示错误，不进入已提交提示', async () => {
    hookMocks.useCreateDirectoryChange.mockReturnValue(
      mutationMock({
        mutateAsync: vi.fn().mockRejectedValue({ message: '目录条目已被他人修改。' }),
      }),
    )
    renderDialog({ action: 'disable' })

    fireEvent.click(screen.getByRole('button', { name: '提交停止分发申请' }))

    expect(await screen.findByText('目录条目已被他人修改。')).toBeInTheDocument()
    expect(screen.queryByText(/尚未生效/)).not.toBeInTheDocument()
  })

  // ── stale ─────────────────────────────────────────────────────────────
  it('确认阶段遇到 stale 时给出重新发起指引', async () => {
    hookMocks.useConfirmDirectoryChange.mockReturnValue(
      mutationMock({
        mutateAsync: vi.fn().mockRejectedValue({ code: 'plugin-change-stale' }),
      }),
    )
    renderDialog({ action: 'disable' })

    fireEvent.click(screen.getByRole('button', { name: '提交停止分发申请' }))
    fireEvent.click(await screen.findByRole('button', { name: '由另一位管理员审批' }))
    fireEvent.click(await screen.findByRole('button', { name: '最终确认并生效' }))

    expect(
      await screen.findByText('目录条目在此期间发生变化，请关闭后重新发起。'),
    ).toBeInTheDocument()
  })

  // ── 回滚差异与阻断项 ──────────────────────────────────────────────────
  it('回滚展示 manifest/package/兼容性/权限的 from→to 差异', () => {
    renderDialog({ action: 'rollback' })

    const diff = screen.getByLabelText('回滚差异')
    expect(within(diff).getByText('推荐版本')).toBeInTheDocument()
    expect(within(diff).getByText('清单摘要')).toBeInTheDocument()
    expect(within(diff).getByText('制品摘要')).toBeInTheDocument()
    expect(within(diff).getByText('兼容性摘要')).toBeInTheDocument()
    expect(within(diff).getByText('无净变化')).toBeInTheDocument()
  })

  it('存在阻断项时提交按钮禁用并逐条列出原因', () => {
    hookMocks.useDirectoryRollbackPreview.mockReturnValue({
      data: rollbackDiff({
        blockingFindings: ['rollback-target-incompatible', 'rollback-permission-elevation'],
        permissionDelta: { added: ['risk:view'], removed: [], unchanged: ['project:view'] },
      }),
      isLoading: false,
      error: null,
    })
    renderDialog({ action: 'rollback' })

    expect(screen.getByRole('button', { name: /提交回滚申请/ })).toBeDisabled()
    expect(screen.getByText(/目标版本与当前宿主不兼容/)).toBeInTheDocument()
    expect(screen.getByText(/提权须走权限升级流程/)).toBeInTheDocument()
    expect(screen.getByText('新增 risk:view')).toBeInTheDocument()
  })

  it('回滚预览失败时禁止提交并给出非泄露提示', () => {
    hookMocks.useDirectoryRollbackPreview.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: { code: 'registry-rollback-target-invalid' },
    })
    renderDialog({ action: 'rollback' })

    expect(
      screen.getByText('无法为该目标版本生成回滚预览，请返回目录重新选择。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /提交回滚申请/ })).toBeDisabled()
  })

  // ── 键盘可达 ──────────────────────────────────────────────────────────
  it('对话框内所有动作都是原生 button，可被键盘聚焦与 Enter 触发', async () => {
    const create = vi.fn().mockResolvedValue({
      data: {
        requestUid: 'chg-k',
        state: 'pending-approval',
        approvalRequired: true,
        rollbackDiff: null,
      },
    })
    hookMocks.useCreateDirectoryChange.mockReturnValue(mutationMock({ mutateAsync: create }))
    renderDialog({ action: 'disable' })

    const submit = screen.getByRole('button', { name: '提交停止分发申请' })
    submit.focus()
    expect(submit).toHaveFocus()
    fireEvent.keyDown(submit, { key: 'Enter' })
    fireEvent.click(submit)
    await waitFor(() => expect(create).toHaveBeenCalled())
  })

  it('Esc 关闭对话框时回调 onOpenChange(false)', () => {
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // ── 主题 / 密度 ───────────────────────────────────────────────────────
  it('分区容器使用语义色与半径令牌，不写死颜色值', () => {
    renderDialog({ action: 'disable' })
    const target = screen.getByLabelText('目录条目（本次动作的对象）')
    expect(target.className).toContain('border-border')
    expect(target.className).toContain('var(--radius-sm)')
    expect(target.className).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  // ── 简体中文非市场文案 ────────────────────────────────────────────────
  it('四个动作的文案均为简体中文且不含公开市场/计费措辞', () => {
    const forbidden = [
      '上架',
      '下架',
      '市场',
      '商店',
      '评分',
      '评论',
      '计费',
      '订阅',
      '分成',
      '付费',
    ]
    for (const action of ['approve', 'disable', 'restore', 'rollback'] as const) {
      const { unmount } = renderDialog({ action })
      const text = document.body.textContent ?? ''
      for (const word of forbidden) {
        expect(text).not.toContain(word)
      }
      expect(text).toMatch(/[一-龥]/)
      unmount()
    }
  })
})

describe('PluginDirectoryWorkbench 管理动作入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookMocks.useDirectoryReleases.mockReturnValue({
      data: { data: [RELEASE], meta: { total: 1, page: 1, perPage: 20, totalPages: 1 } },
      isLoading: false,
      error: null,
      isStale: false,
      isFetching: false,
      dataUpdatedAt: 1,
      refetch: vi.fn(),
    })
    hookMocks.useDirectoryReleaseDetail.mockReturnValue({
      data: {
        ...RELEASE,
        manifestDigestPresent: true,
        compatibility: { allowed: true, digest: 'sha256:abcdef0123456789', reasonCodes: [] },
        review: { latestCycleNumber: 1, latestDecision: 'approved', latestResolvedAt: null },
        impact: { activeCount: 1, uninstalledCount: 0 },
      },
      isLoading: false,
      error: null,
    })
    hookMocks.useAffectedInstallations.mockReturnValue({
      data: { data: [INSTALLED_INSTANCE], meta: { total: 1, page: 1, perPage: 20, totalPages: 1 } },
      isLoading: false,
      error: null,
    })
    hookMocks.useDirectoryRollbackPreview.mockReturnValue({
      data: rollbackDiff(),
      isLoading: false,
      error: null,
    })
    hookMocks.useCreateDirectoryChange.mockReturnValue(mutationMock())
    hookMocks.useConfirmDirectoryChange.mockReturnValue(mutationMock())
  })

  function openDetail() {
    fireEvent.click(screen.getByRole('button', { expanded: false }))
  }

  it('无权限时不渲染任何动作按钮，也不显示 disabled 能力暗示', () => {
    render(<PluginDirectoryWorkbench canManageReview />)
    openDetail()

    expect(screen.queryByLabelText('目录管理动作')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '停止分发' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '回滚到此版本' })).not.toBeInTheDocument()
  })

  it('按状态与权限渲染合法动作：approved 且持 manage/rollback 时显示停止分发与回滚', () => {
    render(<PluginDirectoryWorkbench canManageReview canManage canRollback />)
    openDetail()

    const bar = screen.getByLabelText('目录管理动作')
    expect(within(bar).getByRole('button', { name: '停止分发' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: '回滚到此版本' })).toBeInTheDocument()
    // approved 状态下「批准」「恢复送审」不是合法动作
    expect(within(bar).queryByRole('button', { name: '批准' })).not.toBeInTheDocument()
    expect(within(bar).queryByRole('button', { name: '恢复送审' })).not.toBeInTheDocument()
    expect(within(bar).getByText(/均需审批与最终确认后才生效/)).toBeInTheDocument()
  })

  it('待审核版本对持审批权者只显示「批准」', () => {
    hookMocks.useDirectoryReleaseDetail.mockReturnValue({
      data: {
        ...RELEASE,
        status: 'pending_review',
        manifestDigestPresent: true,
        compatibility: { allowed: true, digest: 'sha256:abc', reasonCodes: [] },
        review: null,
        impact: { activeCount: 0, uninstalledCount: 0 },
      },
      isLoading: false,
      error: null,
    })
    render(<PluginDirectoryWorkbench canManageReview canApprove canManage canRollback />)
    openDetail()

    const bar = screen.getByLabelText('目录管理动作')
    expect(within(bar).getByRole('button', { name: '批准' })).toBeInTheDocument()
    expect(within(bar).queryByRole('button', { name: '停止分发' })).not.toBeInTheDocument()
    expect(within(bar).queryByRole('button', { name: '回滚到此版本' })).not.toBeInTheDocument()
  })

  it('点击动作按钮打开对应对话框，且不发生任何写请求', () => {
    render(<PluginDirectoryWorkbench canManageReview canManage />)
    openDetail()
    fireEvent.click(screen.getByRole('button', { name: '停止分发' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('停止分发此版本')).toBeInTheDocument()
    expect(hookMocks.useCreateDirectoryChange().mutateAsync).not.toHaveBeenCalled()
  })
})
