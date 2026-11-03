/**
 * v3-frontend-load-performance —— 登录页预取登录后的目标页。
 */

import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LoginForm } from '@/components/auth/LoginForm'
import { authApi } from '@/lib/api/auth'

const prefetch = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), prefetch }),
  usePathname: () => '/login',
}))

describe('登录页预取', () => {
  beforeEach(() => {
    prefetch.mockReset()
    vi.restoreAllMocks()
    vi.spyOn(authApi, 'googleConfig').mockResolvedValue({
      configured: false,
      missingEnvKeys: [],
      authorizationUrl: null,
    })
  })

  test('填表时预取登录后的目标页', async () => {
    render(<LoginForm nextPath="/projects/7/list" />)
    await waitFor(() => expect(prefetch).toHaveBeenCalledWith('/projects/7/list'))
  })
})
