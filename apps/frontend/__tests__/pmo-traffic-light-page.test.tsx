import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PmoTrafficLightPage from '@/app/(dashboard)/pmo/traffic-light/page'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePermissions } from '@/hooks/use-permissions'
import type { Mock } from 'vitest'
import type { StubProps } from './_mock-types'

// Mock hooks
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: vi.fn(),
}))

vi.mock('@/hooks/use-pmo-traffic-light', () => ({
  useTrafficLightList: vi.fn(() => ({
    data: null,
    isLoading: true,
    error: null,
  })),
  useTrafficLightCounts: vi.fn(() => ({
    data: { red: 0, yellow: 0, green: 0, gray: 0, total: 0, calculatedAt: '' },
  })),
  useUpsertTrafficLightReview: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}))

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

// Mock UI components that depend on radix/Portal to avoid jsdom issues
vi.mock('@/components/ui/Select', () => ({
  Select: ({ children }: StubProps) => <div data-testid="select">{children}</div>,
  SelectContent: ({ children }: StubProps) => <div>{children}</div>,
  SelectItem: ({ children }: StubProps) => <div>{children}</div>,
  SelectTrigger: ({ children }: StubProps) => <div>{children}</div>,
  SelectValue: () => <div />,
}))

vi.mock('@/components/ui/Dialog', () => ({
  // 与 Radix Dialog 真实语义一致：未打开时 children 仍保留在树中
  // （仅 Content 内容按 open 门控，由 DialogContent 组件处理）
  Dialog: ({ children }: StubProps) => <div data-testid="dialog">{children}</div>,
  DialogContent: ({ children }: StubProps) => <div>{children}</div>,
  DialogDescription: ({ children }: StubProps) => <div>{children}</div>,
  DialogHeader: ({ children }: StubProps) => <div>{children}</div>,
  DialogTitle: ({ children }: StubProps) => <div>{children}</div>,
  DialogTrigger: ({ children }: StubProps) => <div>{children}</div>,
}))

// Mock Alert to avoid lucide-react icon resolution in jsdom
vi.mock('@/components/ui/Alert', () => ({
  Alert: ({ children, variant }: StubProps) => (
    <div role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: StubProps) => <div>{children}</div>,
  AlertTitle: ({ children }: StubProps) => <div>{children}</div>,
}))

// Mock Badge
vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, variant, className }: StubProps) => (
    <span className={className} data-variant={variant}>
      {children}
    </span>
  ),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PmoTrafficLightPage />
    </QueryClientProvider>,
  )
}

describe('PmoTrafficLightPage — 权限感知', () => {
  it('无 portfolio:view 权限时显示无权限提示', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => false })
    renderPage()
    expect(screen.getByText('您没有 PMO 组合交通灯访问权限。')).toBeTruthy()
  })

  it('有 portfolio:view 权限时显示标题', () => {
    ;(usePermissions as Mock).mockReturnValue({
      canAny: (p: string[]) => p.includes('portfolio:view'),
    })
    renderPage()
    expect(screen.getByText('PMO 组合交通灯')).toBeTruthy()
  })
})
