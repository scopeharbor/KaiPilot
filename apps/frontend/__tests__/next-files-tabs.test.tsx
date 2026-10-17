/**
 * 新轨文件域三视图页签测试（/next/projects/:id/files）。
 *
 * 覆盖（用户审计项 #6）：
 * - 默认「文件」视图挂载新轨 ProjectFilesWorkspace；
 * - 切到「OCR 识别」挂载 OcrDocumentsWorkspace（刻意跨轨复用，功能补齐）；
 * - 切到「文档智能」挂载 DocumentIntelligenceWorkbench；
 * - URL 深链 ?view=intelligence 直达文档智能页签（与旧轨契约一致）；
 * - 页签切换语义（aria-selected）正确。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import ProjectFilesNextPage from '@/app/(next)/next/projects/[id]/files/page'

// ── 重型旧轨工作台以 stub 替代（本测试只验页签接线，不验其内部行为）──
vi.mock('@/components/ocr/OcrDocumentsWorkspace', () => ({
  OcrDocumentsWorkspace: () => <div data-stub-ocr-workspace />,
}))
vi.mock('@/components/ocr/OcrDocumentDrawer', () => ({
  OcrDocumentDrawer: () => null,
}))
vi.mock('@/components/document-intelligence/DocumentIntelligenceWorkbench', () => ({
  DocumentIntelligenceWorkbench: () => <div data-stub-intelligence-workbench />,
}))
vi.mock('@/components/next/files/ProjectFilesWorkspace', () => ({
  ProjectFilesWorkspace: () => <div data-stub-files-workspace />,
}))
vi.mock('@/hooks/use-ocr-document-workspace', () => ({
  useOcrDocumentWorkspace: () => ({
    rows: [],
    isLoading: false,
    hasAnyOcrActivity: false,
    reviewableCount: 0,
    confirmedCount: 0,
    processingCount: 0,
    failedCount: 0,
    blockedCount: 0,
    invalidateAll: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-ocr-document', () => ({
  useOcrDocumentJobCreate: () => ({ mutate: vi.fn() }),
  useOcrDocumentJobRetry: () => ({ mutate: vi.fn() }),
}))

const mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}))

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  } as never)
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProjectFilesNextPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockSearchParams.delete('view')
  setAuth(['project:view', 'file:view'])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('新轨文件域三视图页签', () => {
  test('默认文件视图挂载新轨工作台，三页签就位', async () => {
    renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-stub-files-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-files-tab="files"]')?.getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(document.querySelector('[data-files-tab="ocr"]')).not.toBeNull()
    expect(document.querySelector('[data-files-tab="intelligence"]')).not.toBeNull()
  })

  test('切到 OCR 页签挂载 OCR 工作台；切到文档智能页签挂载智能工作台', async () => {
    renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-stub-files-workspace]')).not.toBeNull(),
    )

    fireEvent.click(document.querySelector('[data-files-tab="ocr"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-stub-ocr-workspace]')).not.toBeNull())
    expect(document.querySelector('[data-stub-files-workspace]')).toBeNull()

    fireEvent.click(document.querySelector('[data-files-tab="intelligence"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-stub-intelligence-workbench]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-stub-ocr-workspace]')).toBeNull()
  })

  test('URL 深链 ?view=intelligence 直达文档智能页签', async () => {
    mockSearchParams.set('view', 'intelligence')
    renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-stub-intelligence-workbench]')).not.toBeNull(),
    )
    expect(
      document.querySelector('[data-files-tab="intelligence"]')?.getAttribute('aria-selected'),
    ).toBe('true')
  })
})
