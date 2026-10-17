/**
 * v3-personal-edition-open-source-export §1.3 —— 根 404 与企业版说明页。
 *
 * - 新版与旧版的企业路由（如单点登录设置）都显示「此功能属于智项企业版」说明；
 * - 平台运营控制台同样显示说明；
 * - 其他未匹配路由显示普通 404；
 * - 说明页是纯展示：渲染期间 fetch 调用次数为 0。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const pathnameRef = { current: '/' }

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameRef.current,
}))

import NotFound from '@/app/not-found'
import { isEditionExcludedRoute } from '@/lib/workspace-edition'

const NOTICE = '此功能属于智项企业版，个人版未提供'

describe('根 not-found：企业版说明与普通 404', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error('不应发起请求')))
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['/settings/security/sso', '/next/settings/security/sso'])(
    '%s 显示企业版说明，且不发起数据请求',
    (pathname) => {
      pathnameRef.current = pathname
      render(<NotFound />)
      expect(screen.getByText(NOTICE)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: '返回首页' })).toBeInTheDocument()
      expect(fetchSpy).toHaveBeenCalledTimes(0)
    },
  )

  it('新版路径的返回入口指向 /next', () => {
    pathnameRef.current = '/next/settings/security/kms'
    render(<NotFound />)
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/next')
  })

  it('平台运营控制台显示企业版说明', () => {
    pathnameRef.current = '/next/admin/ai-models'
    render(<NotFound />)
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
  })

  it('其他路径显示普通 404', () => {
    pathnameRef.current = '/foo'
    render(<NotFound />)
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
    expect(screen.getByText('页面不存在')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })
})

describe('isEditionExcludedRoute', () => {
  it('识别企业路由与平台控制台，新版路径先去掉 /next 前缀', () => {
    expect(isEditionExcludedRoute('/settings/security/dlp')).toBe(true)
    expect(isEditionExcludedRoute('/next/admin/release-trust/gates')).toBe(true)
    expect(isEditionExcludedRoute('/next/admin/organizations')).toBe(true)
  })

  it('不误判保留的实例管理与普通页面', () => {
    expect(isEditionExcludedRoute('/next/admin/users')).toBe(false)
    expect(isEditionExcludedRoute('/next/admin/audit-logs')).toBe(false)
    expect(isEditionExcludedRoute('/next')).toBe(false)
    expect(isEditionExcludedRoute('/next-login')).toBe(false)
    expect(isEditionExcludedRoute('/settings/security/two-factor')).toBe(false)
  })
})
