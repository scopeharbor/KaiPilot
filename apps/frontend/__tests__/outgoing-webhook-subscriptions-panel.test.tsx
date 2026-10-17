import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutgoingWebhookSubscriptionsPanel } from '@/components/integrations/OutgoingWebhookSubscriptionsPanel'
import type { OutgoingWebhookSubscriptionDto } from '@aiproj/types'

// ---- mocks ----
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
    ...rest
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    type?: 'button' | 'submit'
    variant?: string
    size?: string
  }) => (
    <button
      type={type ?? 'button'}
      onClick={onClick}
      disabled={disabled}
      data-variant={rest.variant}
    >
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

const canFn = vi.fn(() => true)
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: canFn, canAny: () => true, canAll: () => true, permissions: [] }),
}))

const listMock = vi.fn()
const createMock = vi.fn()
const rotateMock = vi.fn()
const deactivateMock = vi.fn()

vi.mock('@/lib/api/outgoing-webhooks', () => ({
  OUTGOING_WEBHOOK_MANAGE_PERMISSION: 'outgoing_webhook:manage',
}))

vi.mock('@/hooks/use-outgoing-webhooks', () => ({
  useOutgoingWebhooks: () => listMock(),
  useCreateOutgoingWebhook: () => ({
    mutateAsync: createMock,
    mutate: createMock,
    isPending: false,
  }),
  useRotateOutgoingWebhook: () => ({
    mutateAsync: rotateMock,
    mutate: rotateMock,
    isPending: false,
  }),
  useDeactivateOutgoingWebhook: () => ({
    mutateAsync: deactivateMock,
    mutate: deactivateMock,
    isPending: false,
  }),
}))

function createSubscription(
  overrides: Partial<OutgoingWebhookSubscriptionDto> = {},
): OutgoingWebhookSubscriptionDto {
  return {
    id: 1,
    name: '我的订阅',
    targetUrl: 'https://hooks.example.com/incoming',
    eventTypes: ['task.created'],
    status: 'active',
    secretFingerprint: 'abc12345',
    lastRotatedAt: null,
    deactivatedAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function setSubs(subs: OutgoingWebhookSubscriptionDto[], loading = false) {
  listMock.mockReturnValue({
    data: { data: subs },
    isLoading: loading,
  })
}

describe('OutgoingWebhookSubscriptionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canFn.mockReturnValue(true)
    setSubs([])
  })

  it('renders shared whitelist event options from shared metadata', () => {
    setSubs([])
    render(<OutgoingWebhookSubscriptionsPanel />)
    // 白名单标签来自共享元数据（任务创建/项目更新等）
    expect(screen.getByText('任务创建')).toBeInTheDocument()
    expect(screen.getByText('项目更新')).toBeInTheDocument()
    expect(screen.getByText('风险登记')).toBeInTheDocument()
  })

  it('shows validation error for non-HTTPS URL on create', async () => {
    setSubs([])
    render(<OutgoingWebhookSubscriptionsPanel />)
    const urlInput = screen.getByPlaceholderText('https://hooks.example.com/incoming')
    fireEvent.change(urlInput, { target: { value: 'http://insecure.example/hook' } })
    const nameInput = screen.getByPlaceholderText('例如：团队通知接收器')
    fireEvent.change(nameInput, { target: { value: 'sub' } })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]!)
    fireEvent.click(screen.getByText('创建订阅'))
    expect(await screen.findByText('目标 URL 必须使用 HTTPS')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('create calls API and shows one-time secret, dismissable', async () => {
    setSubs([])
    createMock.mockResolvedValue({
      data: {
        ...createSubscription(),
        secret: {
          secret: 'whsec_oneshot',
          fingerprint: 'abc12345',
          rotatedAt: '2026-07-23T00:00:00.000Z',
        },
      },
    })
    render(<OutgoingWebhookSubscriptionsPanel />)
    fireEvent.change(screen.getByPlaceholderText('例如：团队通知接收器'), {
      target: { value: 'sub' },
    })
    fireEvent.change(screen.getByPlaceholderText('https://hooks.example.com/incoming'), {
      target: { value: 'https://hooks.example.com/incoming' },
    })
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    fireEvent.click(screen.getByText('创建订阅'))

    expect(await screen.findByText('whsec_oneshot')).toBeInTheDocument()
    expect(createMock).toHaveBeenCalled()
    // dismiss 后不再渲染明文
    fireEvent.click(screen.getByText('我已保存'))
    await waitFor(() => expect(screen.queryByText('whsec_oneshot')).not.toBeInTheDocument())
  })

  it('lists subscriptions with status and fingerprint, no secret', () => {
    setSubs([createSubscription()])
    render(<OutgoingWebhookSubscriptionsPanel />)
    expect(screen.getByText('我的订阅')).toBeInTheDocument()
    expect(screen.getByText('abc12345', { exact: false })).toBeInTheDocument()
    // 脱敏：不渲染密钥明文/密文
    expect(screen.queryByText('whsec_')).not.toBeInTheDocument()
  })

  it('hides write controls for users without management permission', () => {
    canFn.mockReturnValue(false)
    setSubs([createSubscription()])
    render(<OutgoingWebhookSubscriptionsPanel />)
    // 无创建表单
    expect(screen.queryByText('创建订阅')).not.toBeInTheDocument()
    // 无轮换/停用按钮
    expect(screen.queryByText('轮换密钥')).not.toBeInTheDocument()
    expect(screen.queryByText('停用')).not.toBeInTheDocument()
    // 只读提示
    expect(screen.getByText(/只读视图/)).toBeInTheDocument()
  })

  it('deactivate button calls deactivate API', async () => {
    setSubs([createSubscription()])
    deactivateMock.mockResolvedValue({ data: createSubscription({ status: 'inactive' }) })
    render(<OutgoingWebhookSubscriptionsPanel />)
    fireEvent.click(screen.getByText('停用'))
    await waitFor(() => expect(deactivateMock).toHaveBeenCalledWith(1))
  })

  it('rotate button calls rotate API and shows one-time secret', async () => {
    setSubs([createSubscription()])
    rotateMock.mockResolvedValue({
      data: {
        ...createSubscription(),
        secret: {
          secret: 'whsec_rot',
          fingerprint: 'newfp',
          rotatedAt: '2026-07-23T00:00:00.000Z',
        },
      },
    })
    render(<OutgoingWebhookSubscriptionsPanel />)
    fireEvent.click(screen.getByText('轮换密钥'))
    expect(await screen.findByText('whsec_rot')).toBeInTheDocument()
    expect(rotateMock).toHaveBeenCalledWith(1)
  })
})
