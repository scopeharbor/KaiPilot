import { act } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { allNavItems } from '@/lib/navigation'
import { accessTokenWith } from './_jwt-helper'

// —— next/navigation mock —— //
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: '1' }),
  usePathname: () => '/search',
  useSearchParams: () => new URLSearchParams(),
}))

// —— next-themes mock —— //
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))

// —— usePermission hook mock —— //
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ canAny: () => true }),
}))

// —— useSearchSuggestions mock —— //
vi.mock('@/hooks/use-search', () => ({
  useSearchSuggestions: () => ({
    data: { data: [] },
    isLoading: false,
  }),
}))

beforeEach(() => {
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
  act(() => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'user@example.com',
        fullName: '测试用户',
        organizations: [{ id: 1, name: '测试工作区', slug: 'test', role: 'owner' }],
      },
      accessToken: accessTokenWith(['project:view'], { organizationId: 1, roleVersion: 1 }),
    })
  })
})

describe('CommandPalette - advanced search', () => {
  test('导航配置中有 高级搜索 项', () => {
    const searchItem = allNavItems.find((item) => item.label === '高级搜索')
    expect(searchItem).toBeDefined()
    expect(searchItem!.href).toBe('/search')
  })

  test('高级搜索入口只导航到搜索页面', () => {
    const searchItem = allNavItems.find((item) => item.label === '高级搜索')
    expect(searchItem).toBeDefined()
    expect(searchItem!.href).toBe('/search')
  })
})
