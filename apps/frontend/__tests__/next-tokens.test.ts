import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const NEXT_TOKENS_PATH = join(process.cwd(), 'app/(next)/next-tokens.css')
const GLOBALS_PATH = join(process.cwd(), 'app/globals.css')
const LEGACY_BRIDGE_PATH = join(process.cwd(), 'app/(next)/next-legacy-bridge.css')

/** D18 风格定案（空间层 C + 工作面 A + 角色层 B 占位）要求的 --nx-* 令牌全集。 */
const REQUIRED_NX_TOKENS = [
  // Layer 1 空间层 C
  '--nx-space-bg',
  '--nx-space-surface',
  '--nx-space-cyan',
  '--nx-space-ai',
  // Layer 2 工作面 A
  '--nx-workspace-bg',
  '--nx-workspace-surface',
  '--nx-workspace-blue',
  '--nx-border-hairline',
  '--nx-border-focus',
  // Layer 3 角色层 B（纸光编辑感，高管战略复盘 Role View 使用，本 change 仅落占位）
  '--nx-role-bg',
  '--nx-role-surface',
  '--nx-role-text',
  '--nx-role-accent',
  // 语义与通用工作面基座
  '--nx-bg-0',
  '--nx-bg-1',
  '--nx-accent',
  '--nx-ai',
  '--nx-text-primary',
  '--nx-text-secondary',
  '--nx-text-muted',
  // 状态色
  '--nx-status-success',
  '--nx-status-warning',
  '--nx-status-danger',
  // 图表分类色板 1-8
  '--nx-chart-1',
  '--nx-chart-2',
  '--nx-chart-3',
  '--nx-chart-4',
  '--nx-chart-5',
  '--nx-chart-6',
  '--nx-chart-7',
  '--nx-chart-8',
]

/** 提取 CSS 文本中的变量声明名（`--name:` 形式；var() 引用不会误匹配）。 */
function extractVariables(css: string): string[] {
  const matches = css.matchAll(/--[a-zA-Z0-9-]+\s*:/g)
  return Array.from(matches, (m) => m[0].trim().replace(/:\s*$/, ''))
}

/** 提取变量声明值（`--name: value;`），用于对比度计算。 */
function parseDeclarations(css: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g
  let match: RegExpExecArray | null
  while ((match = re.exec(css))) {
    map.set(match[1]!, match[2]!.trim())
  }
  return map
}

/** 解析 hex 为 [r, g, b]。 */
function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace('#', '')
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

/** WCAG 2.x 相对亮度。 */
function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((c) => c / 255)
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return (
    0.2126 * linear(channels[0]!) + 0.7152 * linear(channels[1]!) + 0.0722 * linear(channels[2]!)
  )
}

/** WCAG 对比度（A 与 B 均须为 hex）。 */
function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

describe('新轨设计令牌（v3-ui-next-track-foundation D-e / spec「新轨设计令牌底座」）', () => {
  const css = readFileSync(NEXT_TOKENS_PATH, 'utf8')

  test('令牌定义在 [data-next-track] 选择器作用域内（不污染全局）', () => {
    expect(css).toMatch(/\[data-next-track\]\s*\{/)
    // 作用域限定：声明块外没有任何 --nx- 变量声明
    const outsideScope = css.split(/\[data-next-track\]\s*\{/)[0]!
    expect(extractVariables(outsideScope)).toHaveLength(0)
  })

  test('D18 规定的 --nx-* 令牌集合完备', () => {
    const defined = new Set(extractVariables(css))
    for (const token of REQUIRED_NX_TOKENS) {
      expect(defined.has(token), `缺少令牌 ${token}`).toBe(true)
    }
  })

  test('全部令牌都在 --nx-* 命名空间内（无旧轨 --primary-* / --gray-* 命名混入）', () => {
    const defined = extractVariables(css)
    expect(defined.length).toBeGreaterThan(0)
    for (const token of defined) {
      expect(token.startsWith('--nx-'), `越界命名：${token}`).toBe(true)
    }
  })

  test('与旧轨 :root 变量命名无重叠冲突（spec「令牌隔离」）', () => {
    const globals = readFileSync(GLOBALS_PATH, 'utf8')
    // 取全部 :root 声明块（浅色基座 + 深色等），逐一比对命名空间。
    const rootBlocks = globals.match(/^\s*:root\s*\{[\s\S]*?\}/gm) ?? []
    expect(rootBlocks.length).toBeGreaterThan(0)
    const legacyVars = new Set<string>()
    for (const block of rootBlocks) {
      for (const token of extractVariables(block)) legacyVars.add(token)
    }

    const nextVars = extractVariables(css)
    for (const token of nextVars) {
      expect(legacyVars.has(token), `与旧轨 :root 冲突：${token}`).toBe(false)
    }
  })

  test('暗色基座下全部文字令牌对 --nx-bg-0 / --nx-bg-1 均满足 WCAG AA 正文对比度 ≥4.5:1', () => {
    const values = parseDeclarations(css)
    const resolveVar = (name: string): string => {
      const raw = values.get(name)
      if (!raw) throw new Error(`缺少令牌值：${name}`)
      const ref = raw.match(/^var\((--[a-zA-Z0-9-]+)\)$/)
      return ref ? resolveVar(ref[1]!) : raw
    }
    const backgrounds = [resolveVar('--nx-bg-0'), resolveVar('--nx-bg-1')]
    for (const token of ['--nx-text-primary', '--nx-text-secondary', '--nx-text-muted']) {
      const fg = resolveVar(token)
      for (const bg of backgrounds) {
        const ratio = contrastRatio(fg, bg)
        expect(
          ratio,
          `${token}(${fg}) 对 ${bg} 对比度 ${ratio.toFixed(2)}:1 须 ≥4.5:1`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('内嵌旧版组件的主题桥接（next-legacy-bridge.css）', () => {
  const bridge = readFileSync(LEGACY_BRIDGE_PATH, 'utf8')

  test('只作用于主动标记 data-next-legacy-ui 的新轨作用域（不碰旧轨 :root）', () => {
    const selectors = Array.from(bridge.matchAll(/([^{}]+)\{/g), (m) =>
      m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
    )
    expect(selectors).toEqual(['[data-next-track][data-next-legacy-ui]'])
  })

  test('旧版变量只映射到新版令牌（或同一桥接里已映射的变量）', () => {
    const declarations = parseDeclarations(bridge)
    expect(declarations.size).toBeGreaterThan(0)
    for (const [name, value] of declarations) {
      const refs = Array.from(value.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g), (m) => m[1]!)
      expect(refs.length, `${name} 没有引用任何令牌`).toBeGreaterThan(0)
      for (const ref of refs) {
        expect(ref.startsWith('--nx-') || declarations.has(ref), `${name} 引用了 ${ref}`).toBe(true)
      }
    }
  })
})
