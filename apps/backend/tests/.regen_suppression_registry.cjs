// 重生成 tests/type_suppression_registry.json（正斜杠键，当前真实计数）。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const roots = ['app', 'tests', 'start', 'config', 'database', 'providers', 'commands']
const registry = {}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'build' || e.name === 'tmp') continue
      walk(p)
    } else if (e.name.endsWith('.ts')) {
      const c = fs.readFileSync(p, 'utf8')
      const tsIgnore = (c.match(/@ts-ignore/g) || []).length
      const tsExpectError = (c.match(/@ts-expect-error/g) || []).length
      const asAny = (c.match(/as any/g) || []).length
      if (tsIgnore + tsExpectError + asAny > 0) {
        registry[path.relative(ROOT, p).split(path.sep).join('/')] = {
          tsIgnore,
          tsExpectError,
          asAny,
        }
      }
    }
  }
}

for (const r of roots) walk(path.join(ROOT, r))

const sorted = Object.fromEntries(Object.entries(registry).sort(([a], [b]) => a.localeCompare(b)))

fs.writeFileSync(
  path.join(ROOT, 'tests/type_suppression_registry.json'),
  JSON.stringify(
    {
      _comment:
        'v3-backend-type-debt-closure 8.4：类型抑制棘轮登记。每文件登记当前 @ts-ignore/@ts-expect-error/as any 计数上限；测试要求不得超出、新增文件不得带抑制。削减抑制后请同步下调（重生成：node tests/.regen_suppression_registry.cjs）。',
      generatedAt: '2026-08-22',
      files: sorted,
    },
    null,
    2,
  ) + '\n',
)
const totals = Object.values(sorted).reduce(
  (a, b) => ({
    tsIgnore: a.tsIgnore + b.tsIgnore,
    tsExpectError: a.tsExpectError + b.tsExpectError,
    asAny: a.asAny + b.asAny,
  }),
  { tsIgnore: 0, tsExpectError: 0, asAny: 0 },
)
console.log('files:', Object.keys(sorted).length, 'totals:', JSON.stringify(totals))
