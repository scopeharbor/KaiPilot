/**
 * v3-backend-test-runner-coverage-closure —— 测试运行器覆盖回归绊线。
 *
 * 保证 apps/backend/tests/ 下的每一个测试文件都明确归属于 Japa 或 Vitest，
 * 绝不允许存在 node:test（会导致 Japa 报告 NO TESTS EXECUTED 且退出码 0 的假绿漏洞）
 * 或未知运行器框架。
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function collectSpecFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const entry of entries.slice().sort()) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      collectSpecFiles(full, acc)
    } else if (entry.endsWith('.spec.ts') || entry.endsWith('.spec.js')) {
      acc.push(full)
    }
  }
  return acc
}

function stripComments(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutBlock
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

describe('test-runner-coverage-regression — 运行器覆盖与防假绿绊线', () => {
  const testsDir = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const specFiles = collectSpecFiles(testsDir)

  it('全量测试文件数必须大于 700 且正确收集', () => {
    expect(specFiles.length).toBeGreaterThan(700)
  })

  it('零 node:test 导入（杜绝 Japa NO TESTS EXECUTED 假绿漏洞）', () => {
    const nodeTestFiles: string[] = []
    const pattern = /from\s+['"]node:test['"]/

    for (const file of specFiles) {
      const content = stripComments(readFileSync(file, 'utf8'))
      if (pattern.test(content)) {
        nodeTestFiles.push(file)
      }
    }

    expect(nodeTestFiles).toEqual([])
  })

  it('每个测试文件必须严格归属于 Japa (@japa/runner) 或 Vitest (vitest)', () => {
    const unknownFiles: string[] = []
    const japaPattern = /from\s+['"]@japa\/runner['"]/
    const vitestPattern = /from\s+['"]vitest['"]|import\(\s*['"]vitest['"]\s*\)/

    for (const file of specFiles) {
      const content = stripComments(readFileSync(file, 'utf8'))
      const isJapa = japaPattern.test(content)
      const isVitest = vitestPattern.test(content)

      if (!isJapa && !isVitest) {
        unknownFiles.push(file)
      }
    }

    expect(unknownFiles).toEqual([])
  })
})
