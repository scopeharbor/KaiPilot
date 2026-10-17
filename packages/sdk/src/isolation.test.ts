import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { globSync } from 'node:fs'

// v2-5-typescript-sdk-core §6.4 —— 验证 SDK 不导入 apps/frontend、apps/backend、
// Zustand、Next.js、AdonisJS 或应用专用运行态文件。仅检查实际 import 语句，
// 注释中提及对齐来源不算违规。

const srcDir = resolve(__dirname)
// 非测试、非 fixture 的实现源文件。
const implFiles = globSync('*.ts', { cwd: srcDir }).filter(
  (f) => !f.endsWith('.test.ts') && !f.endsWith('.fixture.ts') && f !== 'test-fixtures.ts',
)

const FORBIDDEN = [
  /from\s+['"]apps\/frontend/,
  /from\s+['"]apps\/backend/,
  /from\s+['"]@\/stores/,
  /from\s+['"]zustand/,
  /from\s+['"]next\//,
  /from\s+['"]@adonisjs/,
  /from\s+['"]#services/,
  /from\s+['"]#models/,
  /from\s+['"]#controllers/,
  /from\s+['"]#validators/,
  /from\s+['"]#policies/,
]

describe('v2-5-typescript-sdk-core runtime isolation', () => {
  test('implementation source files do not import frontend/backend/Zustand/Next/Adonis', () => {
    expect(implFiles.length).toBeGreaterThan(0)
    const violations: string[] = []
    for (const file of implFiles) {
      const content = readFileSync(resolve(srcDir, file), 'utf8')
      // 仅匹配 import 语句（行首或前导空格 + import）
      const importLines = content
        .split('\n')
        .filter((l) => /^\s*import\b/.test(l) || /^\s*}\s*from\b/.test(l))
        .join('\n')
      for (const pattern of FORBIDDEN) {
        if (pattern.test(importLines)) {
          violations.push(`${file}: ${pattern.source}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  test('consumer fixture imports resolve from workspace packages only', () => {
    const content = readFileSync(resolve(srcDir, 'consumer-compile.fixture.ts'), 'utf8')
    // 对整个文件做 import 源匹配，不依赖 prettier 的换行结构。
    expect(/from\s+['"]@aiproj\/sdk['"]/.test(content)).toBe(true)
    expect(/from\s+['"]@aiproj\/types['"]/.test(content)).toBe(true)
    // 不应从 apps/* 相对路径导入
    expect(/from\s+['"][.\\/]*apps\/(frontend|backend)/.test(content)).toBe(false)
  })
})
