/**
 * v3-plugin-approval-change-flow —— 变更差异审查 UI 测试（task 4.4）。
 *
 * 覆盖：差异三段展示（权限/版本/兼容性）、审批与最终确认分离、无权限动作隐藏、
 * stale/loading/result feedback、可访问性标注、简体中文审核文案。
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { PluginChangeRequestReview } from '../components/plugin-change-request/PluginChangeRequestReview'
import type {
  PluginChangeRequestDto,
  PluginChangeDecisionDto,
} from '../lib/api/plugin-change-requests'
import type { PluginChangeKind, PluginChangeRequestState } from '@aiproj/types'

function makeRequest(overrides?: Partial<PluginChangeRequestDto>): PluginChangeRequestDto {
  return {
    id: 'chg-test-0001',
    organizationId: '101',
    projectId: null,
    kind: 'permission-upgrade',
    state: 'awaiting-confirmation',
    pluginId: 'org.example.dev-toolkit',
    requestedBy: '7',
    targetRevision: 'installation:5:2',
    diff: {
      kind: 'permission-upgrade',
      pluginId: 'org.example.dev-toolkit',
      installStatusBefore: 'enabled',
      installStatusAfter: 'enabled',
      versionDelta: {
        currentVersion: '1.2.0',
        targetVersion: '1.3.0',
        currentReleaseId: 101,
        targetReleaseId: 102,
      },
      permissionDelta: {
        added: ['ocr:file:read'],
        removed: [],
        unchanged: ['compiler:skill:view', 'compiler:run:view'],
      },
      compatibilityDigestBefore: 'sha256:compat-001',
      compatibilityDigestAfter: 'sha256:compat-002',
    },
    diffDigest: 'digest001',
    permissionDigest: 'permdigest1',
    compatibilityDigest: 'sha256:compat-002',
    approvalRequired: true,
    approvedBy: '9',
    rowVersion: 3,
    expiresAt: '2026-08-25T10:00:00.000Z',
    createdAt: '2026-08-24T09:00:00.000Z',
    updatedAt: '2026-08-24T09:30:00.000Z',
    ...overrides,
  }
}

const DECISIONS: PluginChangeDecisionDto[] = [
  {
    id: 'pdce-a-requested',
    event: 'requested',
    actorRef: '7',
    fromState: 'draft',
    toState: 'draft',
    reasonCode: null,
    auditLogId: null,
    createdAt: '2026-08-24T09:00:00.000Z',
  },
  {
    id: 'pdce-b-approved',
    event: 'approved',
    actorRef: '9',
    fromState: 'pending-approval',
    toState: 'approved',
    reasonCode: null,
    auditLogId: 42,
    createdAt: '2026-08-24T09:20:00.000Z',
  },
]

describe('PluginChangeRequestReview 差异审查面板', () => {
  it('展示权限/版本/兼容性与安装状态差异及提升提示', () => {
    render(<PluginChangeRequestReview request={makeRequest()} canManage canApprove />)

    expect(screen.getByText('新增权限')).toBeInTheDocument()
    expect(screen.getByText('ocr:file:read')).toBeInTheDocument()
    expect(screen.getByText('移除权限')).toBeInTheDocument()
    expect(screen.getByText('不变权限')).toBeInTheDocument()
    expect(screen.getByText('compiler:skill:view')).toBeInTheDocument()

    const version = screen.getByTestId('version-delta') ?? screen.queryByTestId('version-delta')
    // 版本差异文本（currentVersion 为空时显示「未安装」）
    expect(screen.getByText('1.3.0')).toBeInTheDocument()
    expect(version).not.toBeNull()

    expect(screen.getByTestId('compat-delta').textContent).toContain('sha256:compat-002')
    expect(screen.getByTestId('install-status-delta').textContent).toContain('enabled')

    // 权限提升提示 + region 可访问标注
    expect(screen.getByTestId('elevation-note').textContent).toContain('独立审批')
    expect(screen.getByRole('region', { name: '变更差异审查' })).toBeInTheDocument()
  })

  it('审批与最终确认分离：待审批只显示批准/拒绝；已批准后只显示最终确认', () => {
    const pending = makeRequest({ state: 'pending-approval' as PluginChangeRequestState })
    const { rerender } = render(
      <PluginChangeRequestReview request={pending} canManage canApprove />,
    )
    expect(screen.getByTestId('action-approve')).toBeInTheDocument()
    expect(screen.getByTestId('action-reject')).toBeInTheDocument()
    expect(screen.queryByTestId('action-confirm')).toBeNull()

    const approvedAwaiting = makeRequest({
      state: 'awaiting-confirmation' as PluginChangeRequestState,
    })
    rerender(<PluginChangeRequestReview request={approvedAwaiting} canManage canApprove />)
    expect(screen.queryByTestId('action-approve')).toBeNull()
    expect(screen.getByTestId('action-confirm').textContent).toContain('最终确认')
  })

  it('无权限动作隐藏：无审批权隐藏按钮并给出说明；无管理权隐藏确认/撤回', () => {
    const pending = makeRequest({ state: 'pending-approval' as PluginChangeRequestState })
    const { rerender } = render(
      <PluginChangeRequestReview request={pending} canManage={false} canApprove={false} />,
    )
    expect(screen.queryByTestId('action-approve')).toBeNull()
    expect(screen.queryByTestId('action-confirm')).toBeNull()
    expect(screen.queryByTestId('action-withdraw')).toBeNull()
    expect(screen.getByTestId('no-approve-note').textContent).toContain('没有审批权限')

    const awaiting = makeRequest({ state: 'awaiting-confirmation' as PluginChangeRequestState })
    rerender(<PluginChangeRequestReview request={awaiting} canManage={false} canApprove />)
    expect(screen.queryByTestId('action-confirm')).toBeNull()
    expect(screen.queryByTestId('action-withdraw')).toBeNull()
  })

  it('stale 反馈：显示重新预览警示（role=alert）', () => {
    render(
      <PluginChangeRequestReview
        request={makeRequest()}
        canManage
        actionState={{
          acting: false,
          lastResult: null,
          message: null,
          stale: true,
        }}
      />,
    )
    const banner = screen.getByTestId('stale-banner')
    expect(banner.getAttribute('role')).toBe('alert')
    expect(banner.textContent).toContain('重新预览')
  })

  it('成功反馈：应用成功 status 区块；错误消息透出', () => {
    const { rerender } = render(
      <PluginChangeRequestReview
        request={makeRequest()}
        canManage
        actionState={{ acting: false, lastResult: 'applied', message: null, stale: false }}
      />,
    )
    expect(screen.getByTestId('applied-banner').textContent).toContain('应用成功')

    rerender(
      <PluginChangeRequestReview
        request={makeRequest()}
        canManage
        actionState={{
          acting: false,
          lastResult: null,
          message: '提交失败：审计写入异常',
          stale: false,
        }}
      />,
    )
    expect(screen.getByTestId('action-message').textContent).toContain('审计写入异常')
  })

  it('loading 与 error 状态', () => {
    const { rerender } = render(<PluginChangeRequestReview request={makeRequest()} loading />)
    expect(screen.getByTestId('review-skeleton')).toBeInTheDocument()

    rerender(<PluginChangeRequestReview request={makeRequest()} error="加载变更请求失败" />)
    expect(screen.getByTestId('review-error').textContent).toContain('加载变更请求失败')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('决策流水按事件中文渲染并包含审计回执信息', () => {
    render(<PluginChangeRequestReview request={makeRequest()} decisions={DECISIONS} canManage />)
    const log = screen.getByRole('region', { name: '决策流水' })
    expect(log.textContent).toContain('发起请求')
    expect(log.textContent).toContain('审批通过')
  })

  it('动作回调触发与 acting 禁用态', () => {
    const onConfirm = vi.fn()
    const onApprove = vi.fn()
    const pending = makeRequest({
      state: 'awaiting-confirmation' as PluginChangeRequestState,
      approvalRequired: true,
      kind: 'permission-upgrade' as PluginChangeKind,
    })
    const { rerender } = render(
      <PluginChangeRequestReview
        request={pending}
        canManage
        canApprove
        onConfirm={onConfirm}
        onApprove={onApprove}
      />,
    )
    fireEvent.click(screen.getByTestId('action-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    rerender(
      <PluginChangeRequestReview
        request={pending}
        canManage
        canApprove
        onConfirm={onConfirm}
        onApprove={onApprove}
        actionState={{ acting: true, lastResult: null, message: null, stale: false }}
      />,
    )
    expect((screen.getByTestId('action-confirm') as HTMLButtonElement).disabled).toBe(true)
  })

  it('终态不再渲染任何动作按钮', () => {
    render(
      <PluginChangeRequestReview
        request={makeRequest({ state: 'applied' as PluginChangeRequestState })}
        canManage
        canApprove
      />,
    )
    const actionBar = screen.getByTestId('action-bar')
    expect(actionBar.querySelector('button')).toBeNull()
    expect(screen.getByTestId('review-state').textContent).toBe('已应用')
  })
})
