/**
 * v3-personal-edition-open-source-export 任务 4.7 —— AGPL 源代码入口（design D16）。
 *
 * - `NEXT_PUBLIC_AIPROJ_SOURCE_URL` 为空（私有版默认）时不渲染，界面不变；
 * - 有值时渲染「源代码」链接，新窗口打开并带 `rel="noopener"`；
 * - 只接受 http(s) 地址，其它值按未配置处理。
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resolveSourceCodeUrl, SourceCodeLink } from '@/components/edition/SourceCodeLink'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('SourceCodeLink（AGPL 第 13 条源码入口）', () => {
  test('变量为空时不渲染', () => {
    vi.stubEnv('NEXT_PUBLIC_AIPROJ_SOURCE_URL', '')
    const { container } = render(<SourceCodeLink />)
    expect(container).toBeEmptyDOMElement()
  })

  test('变量未设置时不渲染', () => {
    vi.stubEnv('NEXT_PUBLIC_AIPROJ_SOURCE_URL', undefined)
    const { container } = render(<SourceCodeLink />)
    expect(container).toBeEmptyDOMElement()
  })

  test('有值时渲染源代码链接，新窗口打开并带 noopener', () => {
    vi.stubEnv('NEXT_PUBLIC_AIPROJ_SOURCE_URL', 'https://example.com/openxiang')
    render(<SourceCodeLink />)
    const link = screen.getByRole('link', { name: '源代码' })
    expect(link).toHaveAttribute('href', 'https://example.com/openxiang')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  test('resolveSourceCodeUrl：去掉首尾空白，非 http(s) 地址按未配置处理', () => {
    expect(resolveSourceCodeUrl('  https://example.com/src  ')).toBe('https://example.com/src')
    expect(resolveSourceCodeUrl('javascript:alert(1)')).toBeNull()
    expect(resolveSourceCodeUrl('   ')).toBeNull()
    expect(resolveSourceCodeUrl('')).toBeNull()
  })
})
