import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CrossProjectTasksHudLens } from '@/components/next/tasks/CrossProjectTasksHudLens'

/**
 * v3-ui-next-batch4-reports-change-queue W1 · tasks 1.1 / 1.2
 * 跨项目任务 HUD 引用断言与消除重复测试（next-cross-project-tasks-hud-import.test.tsx）
 *
 * 覆盖：
 * 1. 根目录冗余转发壳 components/next/CrossProjectTasksHudLens.tsx 物理不存在；
 * 2. 真实实现文件 components/next/tasks/CrossProjectTasksHudLens.tsx 物理存在且健全；
 * 3. SpaceMapOverlay.tsx、RoleHomeContainer.tsx 与既有测试套件直接规范引用 tasks 目录源文件；
 * 4. 全仓新轨代码与测试递归扫描零旧路径 import 悬空引用与模块分叉；
 * 5. 规范导入符号为有效 React 组件。
 */
describe('跨项目任务 HUD 引用断言与消除重复测试（W1 · tasks 1.1/1.2）', () => {
  const frontendRoot = resolve(__dirname, '..')
  const oldShellPath = join(frontendRoot, 'components', 'next', 'CrossProjectTasksHudLens.tsx')
  const canonicalPath = join(
    frontendRoot,
    'components',
    'next',
    'tasks',
    'CrossProjectTasksHudLens.tsx',
  )
  const spaceMapPath = join(frontendRoot, 'components', 'next', 'navigation', 'SpaceMapOverlay.tsx')
  const roleHomePath = join(frontendRoot, 'components', 'next', 'home', 'RoleHomeContainer.tsx')
  const hudTestPath = join(frontendRoot, '__tests__', 'next-cross-project-tasks-hud.test.tsx')

  test('根目录旧转发文件 components/next/CrossProjectTasksHudLens.tsx 已被安全删除', () => {
    expect(existsSync(oldShellPath), '旧转发壳文件必须已被删除，不得复活').toBe(false)
  })

  test('真实实现文件 components/next/tasks/CrossProjectTasksHudLens.tsx 物理存在且非空', () => {
    expect(existsSync(canonicalPath), '真实 HUD 组件实现文件必须存在').toBe(true)
    const content = readFileSync(canonicalPath, 'utf8')
    expect(content).toContain('export function CrossProjectTasksHudLens')
    expect(content.length).toBeGreaterThan(1000)
  })

  test('SpaceMapOverlay.tsx 直接且唯一引用 components/next/tasks/CrossProjectTasksHudLens', () => {
    expect(existsSync(spaceMapPath)).toBe(true)
    const content = readFileSync(spaceMapPath, 'utf8')
    expect(content).toMatch(
      /import\s+\{[^}]*CrossProjectTasksHudLens[^}]*\}\s+from\s+['"]@\/components\/next\/tasks\/CrossProjectTasksHudLens['"]/,
    )
    expect(content).not.toMatch(/from\s+['"]@\/components\/next\/CrossProjectTasksHudLens['"]/)
  })

  test('RoleHomeContainer.tsx 直接且唯一引用 tasks/CrossProjectTasksHudLens 源文件', () => {
    expect(existsSync(roleHomePath)).toBe(true)
    const content = readFileSync(roleHomePath, 'utf8')
    expect(content).toMatch(
      /import\s+\{[^}]*CrossProjectTasksHudLens[^}]*\}\s+from\s+['"](\.\.\/tasks|@\/components\/next\/tasks)\/CrossProjectTasksHudLens['"]/,
    )
    expect(content).not.toMatch(/from\s+['"]\.\/CrossProjectTasksHudLens['"]/)
    expect(content).not.toMatch(/from\s+['"]@\/components\/next\/CrossProjectTasksHudLens['"]/)
  })

  test('next-cross-project-tasks-hud.test.tsx 统一引用 tasks/CrossProjectTasksHudLens', () => {
    expect(existsSync(hudTestPath)).toBe(true)
    const content = readFileSync(hudTestPath, 'utf8')
    expect(content).toMatch(
      /import\s+\{[^}]*CrossProjectTasksHudLens[^}]*\}\s+from\s+['"]@\/components\/next\/tasks\/CrossProjectTasksHudLens['"]/,
    )
    expect(content).not.toMatch(/from\s+['"]@\/components\/next\/CrossProjectTasksHudLens['"]/)
  })

  test('全仓新轨组件目录（components/next 与 app/(next)）零旧转发路径 import 悬空引用', () => {
    function collectFiles(dir: string): string[] {
      if (!existsSync(dir)) return []
      const entries = readdirSync(dir)
      const files: string[] = []
      for (const entry of entries) {
        const full = join(dir, entry)
        const st = statSync(full)
        if (st.isDirectory()) {
          files.push(...collectFiles(full))
        } else if (/\.(ts|tsx)$/.test(entry)) {
          files.push(full)
        }
      }
      return files
    }

    const targetDirs = [
      join(frontendRoot, 'components', 'next'),
      join(frontendRoot, 'app', '(next)'),
    ]

    const allCodeFiles = targetDirs.flatMap((d) => collectFiles(d))
    expect(allCodeFiles.length).toBeGreaterThan(20)

    const invalidImportRegex =
      /from\s+['"](@\/components\/next\/CrossProjectTasksHudLens|(?:\.\.?\/)+CrossProjectTasksHudLens)['"]/

    const violations: Array<{ file: string; match: string }> = []
    for (const file of allCodeFiles) {
      const code = readFileSync(file, 'utf8')
      const m = code.match(invalidImportRegex)
      if (m) {
        violations.push({ file, match: m[0] })
      }
    }

    expect(violations, `发现违规引用根目录旧转发路径: ${JSON.stringify(violations)}`).toEqual([])
  })

  test('导出的 CrossProjectTasksHudLens 为有效函数组件', () => {
    expect(typeof CrossProjectTasksHudLens).toBe('function')
  })
})
