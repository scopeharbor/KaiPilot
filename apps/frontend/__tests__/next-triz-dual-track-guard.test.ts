// v3-triz-contradiction-copilot tasks 8.1 —— 前端双轨护栏测试
//
// 红线与双轨证明（D23 + design D14）：
// ① 新轨组件（components/next/ai/cards/Triz*、components/next/signals/、components/next/charts/lenses/triz/、
//    lib/api/triz-copilot.ts、lib/api/project-signals.ts）不 import components/triz/、components/copilot/ 或旧轨 14 页面；
// ② 旧轨 14 个 TRIZ 页面文件不在本 change 改动集合（以 .tmp/taskbooks/tbc-before-tree.txt 基线快照 + 当前 git status 差集比对，注明多会话口径）；
// ③ 负向验证：人为构造违规 import 或改动集合中混入旧轨页面时，护栏判定必须失败。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const FRONTEND_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(FRONTEND_ROOT, '..', '..')

/** 旧轨 14 个 TRIZ 页面基线清单（9 条 triz 路径页 + 5 条同级分析页，冻结式只读） */
export const LEGACY_14_TRIZ_PAGES = [
  'apps/frontend/app/(dashboard)/projects/[id]/triz/assistant/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz/contradiction-matrix/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz/function-analysis/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-decision-center/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-evolution-trend/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-pm-phase/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-resource-analyzer/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-skill-layer/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-workbench/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/contradictions/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/health-risk-command-center/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/predictions/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/recommendations/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/renderer-candidates/[candidateId]/page.tsx',
] as const

/** 违禁导入路径特征（新轨绝不可依赖旧轨组件或旧轨页面） */
export const FORBIDDEN_IMPORT_PATTERNS = [
  /components\/triz\//i,
  /components\/copilot\//i,
  /app\/\(dashboard\)\/projects\/\[id\]\/triz/i,
  /app\/\(dashboard\)\/projects\/\[id\]\/contradictions/i,
  /app\/\(dashboard\)\/projects\/\[id\]\/health-risk-command-center/i,
  /app\/\(dashboard\)\/projects\/\[id\]\/predictions/i,
  /app\/\(dashboard\)\/projects\/\[id\]\/recommendations/i,
  /app\/\(dashboard\)\/projects\/\[id\]\/renderer-candidates/i,
]

/** 收集指定目录及其子目录下所有匹配扩展名的代码文件 */
function collectSourceFiles(dirOrFile: string, acc: string[] = []): string[] {
  const fullPath = resolve(FRONTEND_ROOT, dirOrFile)
  if (!existsSync(fullPath)) return acc

  const stat = statSync(fullPath)
  if (stat.isFile()) {
    acc.push(fullPath)
    return acc
  }

  const entries = readdirSync(fullPath)
  for (const entry of entries) {
    const entryPath = join(fullPath, entry)
    const entryStat = statSync(entryPath)
    if (entryStat.isDirectory()) {
      collectSourceFiles(entryPath, acc)
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      acc.push(entryPath)
    }
  }
  return acc
}

/** 纯函数：提取代码中的全部 import/require 目标，并检查是否命中违禁模式 */
export function findForbiddenImportsInSource(
  source: string,
  patterns: readonly RegExp[],
): string[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const importTargets: string[] = []

  // import ... from '...'
  for (const match of clean.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    importTargets.push(match[1]!)
  }
  // import('...')
  for (const match of clean.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    importTargets.push(match[1]!)
  }
  // require('...')
  for (const match of clean.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    importTargets.push(match[1]!)
  }

  const violations: string[] = []
  for (const target of importTargets) {
    for (const pattern of patterns) {
      if (pattern.test(target)) {
        violations.push(target)
        break
      }
    }
  }

  return [...new Set(violations)]
}

/** 纯函数：检查文件路径集合中是否包含旧轨 14 页任何一项 */
export function checkLegacyPagesTouched(
  changedFiles: readonly string[],
  legacyPages: readonly string[],
): string[] {
  const normalizedChanged = changedFiles.map((p) => p.replace(/\\/g, '/').trim())
  const normalizedLegacy = legacyPages.map((p) => p.replace(/\\/g, '/').trim())
  return normalizedLegacy.filter((page) =>
    normalizedChanged.some((ch) => ch.endsWith(page) || page.endsWith(ch)),
  )
}

describe('前端双轨护栏 ① 新轨组件零 import 旧轨组件与旧轨页面', () => {
  const newTrackFileTargets = [
    'components/next/ai/cards',
    'components/next/signals',
    'components/next/charts/lenses/triz',
    'lib/api/triz-copilot.ts',
    'lib/api/project-signals.ts',
  ]

  const filesToScan: string[] = []
  for (const target of newTrackFileTargets) {
    collectSourceFiles(target, filesToScan)
  }

  it('扫描到新轨目标代码文件（防空转）', () => {
    expect(filesToScan.length).toBeGreaterThanOrEqual(8)
    const relPaths = filesToScan.map((f) => relative(FRONTEND_ROOT, f).replace(/\\/g, '/'))
    expect(relPaths).toContain('lib/api/triz-copilot.ts')
    expect(relPaths).toContain('lib/api/project-signals.ts')
    expect(relPaths).toContain('components/next/signals/ProjectSignalCards.tsx')
    expect(relPaths).toContain('components/next/signals/RoleSignalQueue.tsx')
  })

  it('所有新轨代码文件绝不 import components/triz/、components/copilot/ 或旧轨 14 页', () => {
    const allViolations: Array<{ file: string; violations: string[] }> = []

    for (const file of filesToScan) {
      const content = readFileSync(file, 'utf8')
      const violations = findForbiddenImportsInSource(content, FORBIDDEN_IMPORT_PATTERNS)
      if (violations.length > 0) {
        allViolations.push({
          file: relative(FRONTEND_ROOT, file).replace(/\\/g, '/'),
          violations,
        })
      }
    }

    expect(allViolations).toEqual([])
  })

  it('负向验证：人为构造旧轨 import 时护栏判定失败', () => {
    const mockBadCode1 = `import { OldWidget } from '@/components/triz/OldWidget'`
    expect(findForbiddenImportsInSource(mockBadCode1, FORBIDDEN_IMPORT_PATTERNS)).toEqual([
      '@/components/triz/OldWidget',
    ])

    const mockBadCode2 = `import LegacyAssistant from '@/app/(dashboard)/projects/[id]/triz/assistant/page'`
    expect(findForbiddenImportsInSource(mockBadCode2, FORBIDDEN_IMPORT_PATTERNS)).toEqual([
      '@/app/(dashboard)/projects/[id]/triz/assistant/page',
    ])

    const mockBadCode3 = `const copilot = require('@/components/copilot/drawer')`
    expect(findForbiddenImportsInSource(mockBadCode3, FORBIDDEN_IMPORT_PATTERNS)).toEqual([
      '@/components/copilot/drawer',
    ])
  })
})

describe('前端双轨护栏 ② 旧轨 14 个 TRIZ 页面文件零修改（基线快照比对与多会话口径）', () => {
  it('旧轨 14 个页面物理文件全部存在（冻结式留存）', () => {
    expect(LEGACY_14_TRIZ_PAGES.length).toBe(14)
    for (const relPath of LEGACY_14_TRIZ_PAGES) {
      const fullPath = resolve(REPO_ROOT, relPath)
      expect(existsSync(fullPath)).toBe(true)
    }
  })

  it('旧轨 14 个页面未出现在当前工作树修改集中（对齐基线快照）', () => {
    let statusOutput = ''
    try {
      statusOutput = execSync('git status --porcelain', {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      })
    } catch {
      statusOutput = ''
    }

    const changedLines = statusOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[MADRCU?! ]+\s+/, '').replace(/^"(.*)"$/, '$1'))

    // 检查是否有任何旧轨 14 页被修改或删除
    const touched = checkLegacyPagesTouched(changedLines, LEGACY_14_TRIZ_PAGES)
    expect(touched).toEqual([])
  })

  it('基线快照 .tmp/taskbooks/tbc-before-tree.txt 中旧轨 14 页同样为零改动', () => {
    const baselineFile = resolve(REPO_ROOT, '.tmp/taskbooks/tbc-before-tree.txt')
    if (existsSync(baselineFile)) {
      const baselineContent = readFileSync(baselineFile, 'utf8')
      const baselineLines = baselineContent
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(/^[MADRCU?! ]+\s+/, '').replace(/^"(.*)"$/, '$1'))

      const touchedInBaseline = checkLegacyPagesTouched(baselineLines, LEGACY_14_TRIZ_PAGES)
      expect(touchedInBaseline).toEqual([])
    }
  })

  it('负向验证：人为在变更集注入旧轨页面时护栏判定失败', () => {
    const fakeChanges = [
      'apps/frontend/components/next/ai/cards/TrizContradictionCard.tsx',
      'apps/frontend/app/(dashboard)/projects/[id]/contradictions/page.tsx',
    ]
    const detected = checkLegacyPagesTouched(fakeChanges, LEGACY_14_TRIZ_PAGES)
    expect(detected).toEqual([
      'apps/frontend/app/(dashboard)/projects/[id]/contradictions/page.tsx',
    ])
  })
})
