import { describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import manifest from '@/app/manifest'

/**
 * manifest.ts 静态字段验证（v2-5-pwa-installable-shell）。
 *
 * 验证：必填字段存在、display 为可安装模式、图标尺寸声明、图标文件存在。
 */
describe('PWA manifest', () => {
  const m = manifest()

  test('包含产品名称', () => {
    expect(m.name).toBe('开项 Kaiplan')
    expect(m.short_name).toBe('开项')
  })

  test('包含产品描述', () => {
    // 网站简介为繁体功能说明（d33e14cc）
    expect(m.description).toContain('專案管理')
  })

  test('display 为 standalone', () => {
    expect(m.display).toBe('standalone')
  })

  test('prefer_related_applications 为 false 或不存在', () => {
    expect(m.prefer_related_applications).toBe(false)
  })

  test('包含 start_url', () => {
    expect(m.start_url).toBe('/dashboard')
  })

  test('包含 scope', () => {
    expect(m.scope).toBe('/')
  })

  test('包含背景色和主题色', () => {
    expect(m.background_color).toBe('#FFFFFF')
    expect(m.theme_color).toBe('#4338CA')
  })

  test('语言为 zh-CN', () => {
    expect(m.lang).toBe('zh-CN')
  })

  test('图标数组不为空', () => {
    expect(m.icons).toBeDefined()
    expect(m.icons!.length).toBeGreaterThanOrEqual(2)
  })

  test('包含 192x192 和 512x512 尺寸', () => {
    const sizes = m.icons!.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  test('图标类型为 image/png', () => {
    for (const icon of m.icons!) {
      expect(icon.type).toBe('image/png')
    }
  })

  test('所有图标 src 指向 public/ 下的路径', () => {
    for (const icon of m.icons!) {
      expect(icon.src).toMatch(/^\/branding\//)
    }
  })

  test('声明了 maskable purpose', () => {
    const maskableIcons = m.icons!.filter((i) => i.purpose === 'maskable')
    expect(maskableIcons.length).toBeGreaterThanOrEqual(1)
  })
})

/**
 * 图标文件存在性验证（静态文件系统检查）。
 *
 * 注意：这些测试需要在 Node.js 环境下运行（vitest jsdom 下 process.cwd() 指向项目根）。
 */
describe('manifest icon files', () => {
  const iconPaths = ['/branding/app-icon-192.png', '/branding/app-icon-512.png']

  for (const iconPath of iconPaths) {
    test(`图标文件存在: ${iconPath}`, () => {
      const fullPath = join(process.cwd(), 'public', iconPath)
      expect(existsSync(fullPath)).toBe(true)
    })
  }
})
