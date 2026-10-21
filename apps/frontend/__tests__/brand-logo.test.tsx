import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  BRAND_LOADER_DARK_SRC,
  BRAND_LOADER_LIGHT_SRC,
  BRAND_LOGO_DARK_SRC,
  BRAND_LOGO_LIGHT_SRC,
  BrandLoader,
  BrandLogo,
} from '@/components/ui/BrandLogo'

const themeState = vi.hoisted(() => ({ resolvedTheme: 'light' as 'light' | 'dark' | undefined }))

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: themeState.resolvedTheme }),
}))

describe('BrandLogo and BrandLoader', () => {
  beforeEach(() => {
    themeState.resolvedTheme = 'light'
  })

  test('BrandLogo uses the light mark by default', () => {
    const { container } = render(<BrandLogo />)
    const image = container.querySelector('img')

    expect(image?.getAttribute('src')).toBe(BRAND_LOGO_LIGHT_SRC)
    expect(screen.getByText('开项 KaiPilot')).toBeInTheDocument()
  })

  test('BrandLogo switches to the dark mark when resolved theme is dark', () => {
    themeState.resolvedTheme = 'dark'
    const { container } = render(<BrandLogo showName={false} />)
    const image = container.querySelector('img')

    expect(image?.getAttribute('src')).toBe(BRAND_LOGO_DARK_SRC)
    expect(screen.queryByText('开项 KaiPilot')).not.toBeInTheDocument()
  })

  test('BrandLoader exposes status semantics and light loader asset', () => {
    const { container } = render(<BrandLoader size={64} label="AI 正在生成项目草案…" />)
    const status = screen.getByRole('status')
    const image = container.querySelector('img')

    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('AI 正在生成项目草案…')).toBeInTheDocument()
    expect(image?.getAttribute('src')).toBe(BRAND_LOADER_LIGHT_SRC)
    expect(image?.getAttribute('aria-hidden')).toBe('true')
  })

  test('BrandLoader switches to the dark loader and clamps size', () => {
    themeState.resolvedTheme = 'dark'
    const { container } = render(<BrandLoader size={120} />)
    const image = container.querySelector('img')

    expect(image?.getAttribute('src')).toBe(BRAND_LOADER_DARK_SRC)
    expect(image?.getAttribute('width')).toBe('96')
    expect(image?.getAttribute('height')).toBe('96')
    expect(screen.getByText('加载中')).toBeInTheDocument()
  })
})
