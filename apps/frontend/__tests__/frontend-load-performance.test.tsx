/**
 * v3-frontend-load-performance —— 首屏下载量门禁。
 *
 * 覆盖：
 * - 浏览器端构建不打包 crypto 垫片（服务端不受影响）
 * - 共享类型包声明无副作用，可按需裁剪
 * - 浏览器代码不引用 Node 的 Buffer（否则被注入 buffer 垫片）
 * - KaTeX 样式只随 Markdown / 公式组件加载，不进全局样式
 * - Copilot 侧栏面板首次打开前不挂载，打开后保持挂载
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useCopilotStore } from '@/stores/copilot-store'

vi.mock('@/components/copilot/CopilotSidebarPanel', () => ({
  CopilotSidebarPanel: () => <aside aria-label="AI Copilot 测试面板" />,
}))

import { LazyCopilotSidebarPanel } from '@/components/copilot/LazyCopilotSidebarPanel'

const FRONTEND_ROOT = path.resolve(__dirname, '..')
const read = (relative: string) => readFileSync(path.join(FRONTEND_ROOT, relative), 'utf8')

interface FakeWebpackConfig {
  resolve: { alias?: Record<string, unknown>; fallback?: Record<string, unknown> }
  plugins: unknown[]
  module: { rules: unknown[] }
}

function fakeConfig(): FakeWebpackConfig {
  return { resolve: {}, plugins: [], module: { rules: [] } }
}

describe('构建配置', () => {
  test('浏览器端 crypto 置空，服务端保留', async () => {
    const { default: nextConfig } = (await import('../next.config.mjs')) as {
      default: {
        webpack: (config: FakeWebpackConfig, ctx: { isServer: boolean }) => FakeWebpackConfig
      }
    }
    const client = nextConfig.webpack(fakeConfig(), { isServer: false })
    expect(client.resolve.alias?.crypto).toBe(false)
    expect(client.resolve.fallback?.crypto).toBe(false)

    const server = nextConfig.webpack(fakeConfig(), { isServer: true })
    expect(server.resolve.alias?.crypto).toBeUndefined()
  })

  test('@aiproj/types 声明无副作用', () => {
    const pkg = JSON.parse(read('../../packages/types/package.json')) as { sideEffects?: unknown }
    expect(pkg.sideEffects).toBe(false)
  })

  test('浏览器代码不引用 Buffer', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const source = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
          if (/\bBuffer\.\w+/.test(source)) offenders.push(path.relative(FRONTEND_ROOT, full))
        }
      }
    }
    for (const dir of ['app', 'components', 'hooks', 'lib', 'providers', 'stores']) {
      walk(path.join(FRONTEND_ROOT, dir))
    }
    expect(offenders).toEqual([])
  })

  test('KaTeX 样式只由 Markdown 与公式组件引入', () => {
    const katex = /import\s+['"]katex\/dist\/katex\.min\.css['"]/
    expect(read('app/globals.css')).not.toMatch(/@import\s+['"]katex/)
    expect(read('components/files/markdown/MarkdownDocumentViewer.tsx')).toMatch(katex)
    expect(read('components/files/markdown/MathFormula.tsx')).toMatch(katex)
  })

  test('旧版外框经按需加载包装挂载 Copilot 面板', () => {
    const shell = read('components/layout/AppShell.tsx')
    expect(shell).toContain('<LazyCopilotSidebarPanel />')
    expect(shell).not.toMatch(/from '@\/components\/copilot\/CopilotSidebarPanel'/)
  })
})

describe('LazyCopilotSidebarPanel', () => {
  afterEach(() => {
    act(() => {
      useCopilotStore.getState().setOpen(false)
    })
  })

  test('首次打开前不挂载，打开后加载并保持挂载', async () => {
    act(() => {
      useCopilotStore.getState().setOpen(false)
    })
    render(<LazyCopilotSidebarPanel />)
    expect(screen.queryByLabelText('AI Copilot 测试面板')).toBeNull()

    act(() => {
      useCopilotStore.getState().setOpen(true)
    })
    expect(await screen.findByLabelText('AI Copilot 测试面板')).toBeInTheDocument()

    act(() => {
      useCopilotStore.getState().setOpen(false)
    })
    expect(screen.getByLabelText('AI Copilot 测试面板')).toBeInTheDocument()
  })
})
