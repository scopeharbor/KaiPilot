/**
 * v3-motion-fallback-closure tasks 3.1 —— 动效偏好接线防回归静态护栏。
 *
 * 范式参照 `__tests__/next-atmosphere.test.tsx` / `__tests__/next-tokens.test.ts`（读源码断言）。
 * 四组判据（spec「动效偏好接线防回归」）：
 * 1. 含字面量 `behavior: 'smooth'` 的文件必须接入统一封装（`useMotionPreference` /
 *    `resolveScrollBehavior`），违规文件与行号在失败信息中列出；
 * 2. 含 `scrollTo(` / `scrollIntoView(` 且带字面量 `behavior` 取值的文件同样纳入判据
 *    （合规的即时滚动 `behavior: 'auto'` 不算违规）；
 * 3. `app/globals.css` 的全局压平块仍在（CSS 类动效兜底，防误删）；
 * 4. `hooks/use-immersion-tier.ts` 仍消费统一偏好读取点，且自身不再订阅媒体查询
 *    （防止回退成双订阅）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const FRONTEND_ROOT = process.cwd()
/** 全前端源码面（spec 覆盖口径 app/components/hooks/lib + 其余源码目录）。 */
const SCAN_ROOTS = [
  'app',
  'compiler',
  'components',
  'content',
  'hooks',
  'lib',
  'providers',
  'scripts',
  'stores',
  'types',
]
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__tests', '.next', 'coverage', 'public'])

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) {
      collectSourceFiles(full, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** 源码文件 → 文本（仓库相对 posix 路径便于失败信息定位）。 */
function loadSources(): Map<string, string> {
  const map = new Map<string, string>()
  for (const root of SCAN_ROOTS) {
    for (const full of collectSourceFiles(join(FRONTEND_ROOT, root))) {
      map.set(relative(FRONTEND_ROOT, full).split('\\').join('/'), readFileSync(full, 'utf8'))
    }
  }
  return map
}

const SOURCES = loadSources()

/** 统一封装入口（任一导入即视为已接入）。 */
const WRAPPER_IMPORT =
  /from\s+'(?:@\/hooks\/use-motion-preference|@\/lib\/next\/motion\/scroll-behavior)'/

// ---------------------------------------------------------------------------
// 判据 1 / 2：滚动调用点必须接入统一封装
// ---------------------------------------------------------------------------

/** `behavior: 'smooth'` / `behavior: "smooth"`（不含 `scroll-behavior:` CSS 属性写法）。 */
const SMOOTH_LITERAL = /(?<![\w-])behavior\s*:\s*(['"])smooth\1/g
/** `behavior: '<任意字面量>'`（值位置的字面量，ternary 等表达式不在此列）。 */
const BEHAVIOR_LITERAL = /(?<![\w-])behavior\s*:\s*(['"])([^'"]*)\1/g
const SCROLL_CALL = /scrollTo\(|scrollIntoView\(/

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/** 收集违规文件（含命中行号与行内容），失败信息直接可读。 */
function collectViolations(match: (source: string) => boolean): string[] {
  const violations: string[] = []
  for (const [path, source] of SOURCES) {
    if (!match(source)) continue
    if (WRAPPER_IMPORT.test(source)) continue
    const lines = Array.from(source.matchAll(SMOOTH_LITERAL), (m) => lineOf(source, m.index ?? 0))
    violations.push(`${path}${lines.length > 0 ? `:${lines.join(',')}` : ''}`)
  }
  return violations
}

describe('判据 1：字面量 behavior: "smooth" 的文件必须接入统一封装（tasks 3.1）', () => {
  test('检测器自检：能识别裸平滑滚动写法（防止护栏空转）', () => {
    expect(SMOOTH_LITERAL.test("el.scrollTo({ left: 0, behavior: 'smooth' })")).toBe(true)
    SMOOTH_LITERAL.lastIndex = 0
    expect(SMOOTH_LITERAL.test(`el.scrollTo({ left: 0, behavior: "smooth" })`)).toBe(true)
    SMOOTH_LITERAL.lastIndex = 0
    // CSS 属性写法不得误伤
    expect(SMOOTH_LITERAL.test('scroll-behavior: auto !important;')).toBe(false)
    SMOOTH_LITERAL.lastIndex = 0
  })

  test('未接入统一封装的裸 behavior: "smooth" 文件数为 0', () => {
    const violations = collectViolations((source) => {
      SMOOTH_LITERAL.lastIndex = 0
      return SMOOTH_LITERAL.test(source)
    })
    expect(
      violations,
      `以下文件写了字面量 behavior: 'smooth' 却未接入统一封装（resolveScrollBehavior）：\n${violations.join('\n')}`,
    ).toEqual([])
  })
})

describe('判据 2：带字面量 behavior 取值的滚动文件必须接入统一封装（tasks 3.1）', () => {
  test('违规文件数为 0（合规的 behavior: "auto" 即时滚动不判违规）', () => {
    const violations = collectViolations((source) => {
      if (!SCROLL_CALL.test(source)) return false
      BEHAVIOR_LITERAL.lastIndex = 0
      return Array.from(source.matchAll(BEHAVIOR_LITERAL)).some(([, , value]) => value !== 'auto')
    })
    expect(
      violations,
      `以下文件带字面量 behavior 取值的滚动调用未接入统一封装：\n${violations.join('\n')}`,
    ).toEqual([])
  })

  test('本 change 的 3 个站点均已接入统一封装', () => {
    for (const path of [
      'components/next/gantt/WorkspaceGanttChart.tsx',
      'components/next/reports/PresetReportPanel.tsx',
      'components/views/wbs/WbsTree.tsx',
    ]) {
      const source = SOURCES.get(path)
      expect(source, `未找到 ${path}`).toBeDefined()
      expect(source!, `${path} 未接入统一封装`).toMatch(WRAPPER_IMPORT)
      expect(source!, `${path} 仍残留裸平滑滚动`).toContain('resolveScrollBehavior(reducedMotion)')
      expect(source!, `${path} 不得自行读取动效偏好媒体查询`).not.toMatch(
        /matchMedia|prefers-reduced-motion/,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// 判据 3：globals.css 全局压平兜底块仍在
// ---------------------------------------------------------------------------

const GLOBALS_CSS = readFileSync(join(FRONTEND_ROOT, 'app/globals.css'), 'utf8')

/** 从匹配起点起做花括号配平，取出整块（含嵌套规则）。 */
function extractBalancedBlock(source: string, startIndex: number): string {
  const open = source.indexOf('{', startIndex)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(startIndex, i + 1)
    }
  }
  return source.slice(startIndex)
}

describe('判据 3：globals.css 减弱动效全局压平块不得被移除（tasks 3.1）', () => {
  const at = GLOBALS_CSS.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  const block = at === -1 ? '' : extractBalancedBlock(GLOBALS_CSS, at)

  test('存在 @media (prefers-reduced-motion: reduce) 全局压平块', () => {
    expect(at, '缺少 @media (prefers-reduced-motion: reduce) 媒体查询').toBeGreaterThan(-1)
  })

  test('块内同时压平 animation-duration / transition-duration / scroll-behavior（!important）', () => {
    expect(block, '未能取到全局压平块').not.toBe('')
    const missing: string[] = []
    if (!/animation-duration:\s*[^;]+!important/.test(block))
      missing.push('animation-duration !important')
    if (!/transition-duration:\s*[^;]+!important/.test(block))
      missing.push('transition-duration !important')
    if (!/scroll-behavior:\s*auto\s*!important/.test(block))
      missing.push('scroll-behavior: auto !important')
    expect(missing, `globals.css 全局压平块缺失：${missing.join('、')}`).toEqual([])
  })

  test('选择器覆盖 * / *::before / *::after（全元素兜底口径）', () => {
    expect(block).toContain('*::before')
    expect(block).toContain('*::after')
    expect(block).toMatch(/(^|\s|\n)\*/)
  })
})

// ---------------------------------------------------------------------------
// 判据 4：use-immersion-tier 仍复用统一偏好读取点（不得回退成第二套订阅）
// ---------------------------------------------------------------------------

const IMMERSION_TIER_SOURCE = readFileSync(
  join(FRONTEND_ROOT, 'hooks/use-immersion-tier.ts'),
  'utf8',
)

describe('判据 4：use-immersion-tier 复用统一偏好读取点（tasks 3.1）', () => {
  test('消费 useMotionPreference 且不再自行订阅媒体查询', () => {
    expect(IMMERSION_TIER_SOURCE).toMatch(
      /import\s+\{\s*useMotionPreference\s*\}\s+from\s+'@\/hooks\/use-motion-preference'/,
    )
    expect(IMMERSION_TIER_SOURCE).toMatch(/useMotionPreference\(/)
    expect(
      IMMERSION_TIER_SOURCE,
      'use-immersion-tier 不得回退为自行订阅 matchMedia（会产生第二个偏好订阅点）',
    ).not.toMatch(/matchMedia\(/)
  })
})
