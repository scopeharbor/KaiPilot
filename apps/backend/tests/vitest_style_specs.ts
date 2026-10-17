/**
 * v3-copilot-live-submission-channel —— vitest 风格 spec 的**规则式**识别。
 *
 * 背景：本仓库后端测试有两套运行器——依赖 AdonisJS 运行时的 spec 走 Japa，
 * 纯逻辑 spec `import ... from 'vitest'` 走 Vitest。Japa 一旦加载 vitest 风格
 * 文件，就会在启动阶段抛 "Vitest failed to access its internal state" 并让
 * **整个套件无法启动**。
 *
 * 原先靠 `tests/bootstrap.ts` 里的静态 exclude 名单规避，但每新增一个 vitest
 * 风格 spec 都要手动补名单，漏一个就全套件崩——已实际发生。
 *
 * 本模块改为按内容判定：扫描 `tests/` 下的 `*.spec.ts`，凡从 `vitest` 导入者
 * 即归 Vitest。Japa 的 exclude 与 Vitest 的 include 共用这一份判定，
 * 两侧不再可能漂移。
 *
 * 判定是确定性的：同一工作树同一结果，排序稳定，不依赖时钟与随机源。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 从 `vitest` 导入的判定模式（含 `import ... from 'vitest'` 与 `import('vitest')`）。 */
const VITEST_IMPORT_PATTERN = /from\s+['"]vitest['"]|import\(\s*['"]vitest['"]\s*\)/

/** 去掉块注释与行注释，避免注释中的示例代码影响判定。 */
function stripComments(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutBlock
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

/** 测试根目录（相对本文件所在目录）。 */
const TESTS_DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function collectSpecFiles(dir: string, acc: string[]): string[] {
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

function isVitestStyle(file: string): boolean {
  try {
    // 必须先剥注释再判定：本仓库有 japa 文件在**注释里**解释 "import ... from 'vitest'"
    // 的历史问题，带注释匹配会把它误判成 vitest 文件，进而被 Japa 排除、又被 Vitest
    // 直接 import，抛 "Cannot import japa test file directly" 且该文件的断言全部不执行。
    return VITEST_IMPORT_PATTERN.test(stripComments(readFileSync(file, 'utf8')))
  } catch {
    return false
  }
}

/**
 * 返回 vitest 风格 spec 的**仓库相对**路径（以 `tests/` 开头，正斜杠分隔）。
 *
 * 供 Japa exclude 与 Vitest include 共用。
 */
export function listVitestStyleSpecs(): readonly string[] {
  const baseDir = TESTS_DIR.replace(/[/\\]$/, '')
  const projectRoot = join(baseDir, '..')
  const files = collectSpecFiles(baseDir, [])
  return files
    .filter(isVitestStyle)
    .map((file) => relative(projectRoot, file).split(sep).join('/'))
    .sort()
}
