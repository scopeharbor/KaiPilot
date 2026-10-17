import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Home from '../app/page'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}))

beforeEach(() => {
  replace.mockReset()
  useAuthStore.setState({ isAuthenticated: false, hasHydrated: true })
  useNextTrackStore.setState({ track: 'legacy' })
})

test('未水合时展示深空过渡态且不触发任何重定向', () => {
  useAuthStore.setState({ isAuthenticated: false, hasHydrated: false })
  render(<Home />)
  expect(screen.getByRole('status')).toHaveTextContent('正在进入')
  expect(replace).not.toHaveBeenCalled()
})

test('未登录访问根路由时重定向到登录页并显示过渡态', () => {
  useAuthStore.setState({ isAuthenticated: false, hasHydrated: true })
  useNextTrackStore.setState({ track: 'legacy' })
  render(<Home />)
  expect(screen.getByRole('status')).toHaveTextContent('正在进入')
  expect(replace).toHaveBeenCalledWith('/login')
})

test('已登录访问根路由时重定向到应用首页', () => {
  useAuthStore.setState({ isAuthenticated: true, hasHydrated: true })
  useNextTrackStore.setState({ track: 'legacy' })
  render(<Home />)
  expect(replace).toHaveBeenCalledWith('/dashboard')
})

test('新轨偏好未登录时重定向到新轨登录页', () => {
  useAuthStore.setState({ isAuthenticated: false, hasHydrated: true })
  useNextTrackStore.setState({ track: 'next' })
  render(<Home />)
  expect(replace).toHaveBeenCalledWith('/next-login')
})

test('新轨偏好已登录时重定向到新轨控制台', () => {
  useAuthStore.setState({ isAuthenticated: true, hasHydrated: true })
  useNextTrackStore.setState({ track: 'next' })
  render(<Home />)
  expect(replace).toHaveBeenCalledWith('/next')
})
