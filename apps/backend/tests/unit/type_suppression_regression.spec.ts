/**
 * v3-backend-type-debt-closure（任务 8.4）—— 类型抑制静态回归测试（棘轮）。
 *
 * 规则：
 * - 每个已登记文件的 `@ts-ignore` / `@ts-expect-error` / `as any` 计数不得超过
 *   `tests/type_suppression_registry.json` 的登记值（只许减不许增）。
 * - 任何**未登记**文件出现上述抑制标记即失败（新增抑制必须先口头评审再登记，
 *   登记时须写明理由——登记文件头部注释为准）。
 *
 * 目的：本 change 清零了 345 个 tsc 错误；本测试保证「同类债务不再累积」
 * 有可执行门禁，而不是一次性收敛后慢慢回升。
 */
import { test } from '@japa/runner'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const BACKEND_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCAN_DIRS = ['app', 'tests', 'start', 'config', 'database', 'providers', 'commands']
const SKIP_DIRS = new Set(['node_modules', 'build', 'tmp'])

interface FileSuppressionBudget {
  tsIgnore: number
  tsExpectError: number
  asAny: number
}

interface Registry {
  files: Record<string, FileSuppressionBudget>
}

function loadRegistry(): Registry {
  const raw = readFileSync(join(BACKEND_ROOT, 'tests/type_suppression_registry.json'), 'utf8')
  return JSON.parse(raw) as Registry
}

function scan(): Record<string, FileSuppressionBudget> {
  const result: Record<string, FileSuppressionBudget> = {}
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(join(dir, entry.name))
        continue
      }
      if (!entry.name.endsWith('.ts')) continue
      const fullPath = join(dir, entry.name)
      const content = readFileSync(fullPath, 'utf8')
      const tsIgnore = (content.match(/@ts-ignore/g) ?? []).length
      const tsExpectError = (content.match(/@ts-expect-error/g) ?? []).length
      const asAny = (content.match(/as any/g) ?? []).length
      if (tsIgnore + tsExpectError + asAny > 0) {
        result[relative(BACKEND_ROOT, fullPath).replace(/\\/g, '/')] = {
          tsIgnore,
          tsExpectError,
          asAny,
        }
      }
    }
  }
  for (const dir of SCAN_DIRS) {
    walk(join(BACKEND_ROOT, dir))
  }
  return result
}

test.group('类型抑制棘轮（任务 8.4）', () => {
  test('不存在超出登记的 @ts-ignore/@ts-expect-error/as any，新增文件不得携带抑制', ({
    assert,
  }) => {
    const registry = loadRegistry()
    const current = scan()
    const violations: string[] = []

    for (const [file, counts] of Object.entries(current)) {
      const budget = registry.files[file]
      if (!budget) {
        violations.push(
          `${file}: 未登记文件携带抑制（@ts-ignore×${counts.tsIgnore} @ts-expect-error×${counts.tsExpectError} as any×${counts.asAny}）`,
        )
        continue
      }
      if (counts.tsIgnore > budget.tsIgnore) {
        violations.push(`${file}: @ts-ignore ${budget.tsIgnore} → ${counts.tsIgnore}（新增）`)
      }
      if (counts.tsExpectError > budget.tsExpectError) {
        violations.push(
          `${file}: @ts-expect-error ${budget.tsExpectError} → ${counts.tsExpectError}（新增）`,
        )
      }
      if (counts.asAny > budget.asAny) {
        violations.push(`${file}: as any ${budget.asAny} → ${counts.asAny}（新增）`)
      }
    }

    assert.deepEqual(
      violations,
      [],
      `类型抑制只许减不许增；新增须先登记并写明理由：\n${violations.join('\n')}`,
    )
  })
})
