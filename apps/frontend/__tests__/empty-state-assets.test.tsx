import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FolderOpen } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string }) => (
    <img src={src} alt={alt} {...props} />
  ),
}))

describe('EmptyState design assets', () => {
  test('renders the formal illustration preset as decorative media', () => {
    const { container } = render(
      <EmptyState
        illustration="report"
        title="暂无报告"
        description="生成第一份项目报告后，可在这里预览和导出。"
      />,
    )

    expect(screen.getByText('暂无报告')).toBeInTheDocument()
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/assets/empty-states/report.svg')
    expect(image?.getAttribute('alt')).toBe('')
    expect(image?.getAttribute('aria-hidden')).toBe('true')
  })

  test('keeps the Lucide icon fallback for existing callers', () => {
    const { container } = render(
      <EmptyState icon={FolderOpen} title="暂无项目" description="先创建一个项目。" />,
    )

    expect(screen.getByText('暂无项目')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })

  test('uses local font files and local metadata icon paths', () => {
    const fontsSource = readFileSync('lib/fonts.ts', 'utf8')
    const layoutSource = readFileSync('app/layout.tsx', 'utf8')

    expect(fontsSource).toContain("from 'next/font/local'")
    expect(fontsSource).not.toContain('next/font/google')
    expect(fontsSource).toContain('../public/fonts/misans/misans-regular.woff2')
    expect(fontsSource).toContain('../public/fonts/manrope/manrope-latin-400.woff2')
    expect(layoutSource).toContain("icon: '/branding/aiproj-logo-mark-light.svg'")
    expect(layoutSource).toContain("apple: '/branding/app-icon-192.png'")
  })
})
