import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const BACKEND_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCAN_DIRS = ['app', 'tests', 'start', 'config', 'database', 'providers', 'commands']
const SKIP_DIRS = new Set(['node_modules', 'build', 'tmp'])

function scan() {
  const result = {}
  const walk = (dir) => {
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

const current = scan()
// Sort keys alphabetically
const sortedFiles = {}
for (const key of Object.keys(current).sort()) {
  sortedFiles[key] = current[key]
}

const registry = {
  _comment:
    'v3-backend-type-debt-closure 8.4：类型抑制棘轮登记。每文件登记当前 @ts-ignore/@ts-expect-error/as any 计数上限；测试要求不得超出、新增文件不得带抑制。削减抑制后请同步下调（重生成：node tests/.regen_suppression_registry.mjs）。',
  generatedAt: new Date().toISOString().slice(0, 10),
  files: sortedFiles,
}

writeFileSync(
  join(BACKEND_ROOT, 'tests/type_suppression_registry.json'),
  JSON.stringify(registry, null, 2) + '\n',
  'utf8',
)

console.log(
  'Successfully regenerated type_suppression_registry.json with',
  Object.keys(sortedFiles).length,
  'files.',
)
