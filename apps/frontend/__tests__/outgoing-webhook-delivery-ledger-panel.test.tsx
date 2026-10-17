import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutgoingWebhookDeliveryLedgerPanel } from '@/components/integrations/OutgoingWebhookDeliveryLedgerPanel'
import type { OutgoingWebhookDeliveryEventDto } from '@aiproj/types'

// ---- UI 原语 mock ----
vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span data-badge={variant}>{children}</span>
  ),
}))
vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    type?: 'button' | 'submit'
    variant?: string
    size?: string
  }) => (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))
vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-empty>
      <p>{title}</p>
      {description ? <p>{description}</p> : null}
    </div>
  ),
}))

// ---- 权限 mock ----
const canFn = vi.fn(() => true)
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: canFn, canAny: () => true, canAll: () => true, permissions: [] }),
}))

// ---- 写操作 hooks mock ----
const retryMock = vi.fn()
const pauseMock = vi.fn()
const unpauseMock = vi.fn()
const retryState = { isPending: false, isError: false }
const pauseState = { isPending: false, isError: false }
const unpauseState = { isPending: false, isError: false }

vi.mock('@/lib/api/outgoing-webhook-deliveries', () => ({
  OUTGOING_WEBHOOK_MANAGE_PERMISSION: 'outgoing_webhook:manage',
}))

vi.mock('@/hooks/use-outgoing-webhook-deliveries', () => ({
  useOutgoingWebhookDeliveries: () => listMock(),
  useManualRetryOutgoingWebhookDelivery: () => ({
    mutate: retryMock,
    mutateAsync: retryMock,
    ...retryState,
  }),
  usePauseOutgoingWebhookDelivery: () => ({
    mutate: pauseMock,
    mutateAsync: pauseMock,
    ...pauseState,
  }),
  useUnpauseOutgoingWebhookDelivery: () => ({
    mutate: unpauseMock,
    mutateAsync: unpauseMock,
    ...unpauseState,
  }),
}))

const listMock = vi.fn()

function createDelivery(
  overrides: Partial<OutgoingWebhookDeliveryEventDto> = {},
): OutgoingWebhookDeliveryEventDto {
  return {
    id: 1,
    subscriptionId: 7,
    subscriptionName: '团队通知',
    eventType: 'task.created',
    status: 'failed',
    idempotencyKey: 'wh-evt-1-7-task.created-deadbeef',
    attemptCount: 3,
    maxAttempts: 5,
    lastAttemptStatus: 'failed',
    lastAttemptAt: '2026-07-23T00:00:00.000Z',
    nextAttemptAt: null,
    failureCategory: 'server_error',
    terminalFailureReason: '重试耗尽',
    paused: false,
    sourceEntityType: 'task',
    sourceEntityId: 42,
    projectId: 1,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:01:00.000Z',
    ...overrides,
  }
}

function setDeliveries(deliveries: OutgoingWebhookDeliveryEventDto[], loading = false) {
  listMock.mockReturnValue({
    data: {
      data: deliveries,
      meta: { total: deliveries.length, page: 1, perPage: 20, totalPages: 1 },
    },
    isLoading: loading,
  })
}

describe('OutgoingWebhookDeliveryLedgerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canFn.mockReturnValue(true)
    retryState.isPending = false
    retryState.isError = false
    pauseState.isPending = false
    pauseState.isError = false
    unpauseState.isPending = false
    unpauseState.isError = false
    setDeliveries([])
  })

  it('shows empty state when there are no deliveries', () => {
    setDeliveries([])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    expect(screen.getByText('暂无投递记录')).toBeInTheDocument()
  })

  it('lists deliveries with status badge, subscription name, event label and idempotency key', () => {
    setDeliveries([createDelivery()])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    expect(screen.getByText('团队通知')).toBeInTheDocument()
    expect(screen.getByText('失败')).toBeInTheDocument()
    // 事件标签来自共享元数据（task.created -> 任务创建）
    expect(screen.getByText('任务创建')).toBeInTheDocument()
    expect(screen.getByText('wh-evt-1-7-task.created-deadbeef')).toBeInTheDocument()
    expect(screen.getByText(/尝试次数：3\/5/)).toBeInTheDocument()
  })

  it('renders failure category and terminal reason for failed events', () => {
    setDeliveries([createDelivery()])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    expect(screen.getByText(/失败分类：server_error/)).toBeInTheDocument()
    expect(screen.getByText(/重试耗尽/)).toBeInTheDocument()
  })

  it('shows next retry time for pending events with nextAttemptAt', () => {
    setDeliveries([
      createDelivery({
        status: 'pending',
        nextAttemptAt: '2026-07-23T00:10:00.000Z',
        failureCategory: null,
        terminalFailureReason: null,
      }),
    ])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    expect(screen.getByText(/下次重试/)).toBeInTheDocument()
    // 待发送态不显示重试按钮
    expect(screen.queryByText('手动重试')).not.toBeInTheDocument()
  })

  it('shows resume (恢复) button and hides pause for paused events', () => {
    setDeliveries([
      createDelivery({
        status: 'paused',
        paused: true,
        failureCategory: null,
        terminalFailureReason: null,
      }),
    ])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    expect(screen.getByText('恢复')).toBeInTheDocument()
    expect(screen.queryByText('暂停')).not.toBeInTheDocument()
    // paused 不可重试
    expect(screen.queryByText('手动重试')).not.toBeInTheDocument()
  })

  it('does not render secret/payload/signature anywhere', () => {
    setDeliveries([createDelivery()])
    const { container } = render(<OutgoingWebhookDeliveryLedgerPanel />)
    expect(screen.queryByText('whsec_')).not.toBeInTheDocument()
    expect(screen.queryByText('signature')).not.toBeInTheDocument()
    // DOM 中不含 payload/signature/secret 文本
    expect(container.textContent).not.toContain('payloadCiphertext')
    expect(container.textContent).not.toContain('secretCiphertext')
  })

  it('shows manual retry + pause controls for a failed, non-paused event with permission', () => {
    setDeliveries([createDelivery()])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    expect(screen.getByText('手动重试')).toBeInTheDocument()
    expect(screen.getByText('暂停')).toBeInTheDocument()
  })

  it('clicking manual retry calls the retry API', async () => {
    setDeliveries([createDelivery()])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    fireEvent.click(screen.getByText('手动重试'))
    await waitFor(() => expect(retryMock).toHaveBeenCalledWith({ id: 1 }))
  })

  it('clicking pause / resume calls the corresponding API', async () => {
    setDeliveries([createDelivery()])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    fireEvent.click(screen.getByText('暂停'))
    await waitFor(() => expect(pauseMock).toHaveBeenCalledWith(1))

    setDeliveries([
      createDelivery({
        status: 'paused',
        paused: true,
        failureCategory: null,
        terminalFailureReason: null,
      }),
    ])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    fireEvent.click(screen.getByText('恢复'))
    await waitFor(() => expect(unpauseMock).toHaveBeenCalledWith(1))
  })

  it('shows error message when a write mutation fails (API denial)', () => {
    retryState.isError = true
    setDeliveries([createDelivery()])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    expect(screen.getByText('操作失败，请稍后重试。')).toBeInTheDocument()
  })

  it('hides all write controls and shows read-only notice for users without permission', () => {
    canFn.mockReturnValue(false)
    setDeliveries([createDelivery()])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    expect(screen.queryByText('手动重试')).not.toBeInTheDocument()
    expect(screen.queryByText('暂停')).not.toBeInTheDocument()
    expect(screen.queryByText('恢复')).not.toBeInTheDocument()
    expect(screen.getByText(/只读视图/)).toBeInTheDocument()
  })

  it('does not show retry for success or in_progress events even with permission', () => {
    setDeliveries([
      createDelivery({
        id: 2,
        status: 'success',
        failureCategory: null,
        terminalFailureReason: null,
      }),
      createDelivery({
        id: 3,
        status: 'in_progress',
        failureCategory: null,
        terminalFailureReason: null,
      }),
    ])
    render(<OutgoingWebhookDeliveryLedgerPanel />)
    expect(screen.queryByText('手动重试')).not.toBeInTheDocument()
  })
})
