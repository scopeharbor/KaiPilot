/**
 * v3-backend-type-debt-closure（F16 防范）—— DI 元数据守卫。
 *
 * 背景：`@inject()` 类的构造函数参数若其类型是 `import type` 导入的具体类，
 * `emitDecoratorMetadata` 的运行时元数据退化为 `Object`，容器实例化时报
 * `Cannot inject "[Function: Object]"`——编译期完全无感，只有运行到该路由才炸。
 *
 * 本测试静态扫描 app/**：@inject() 类的构造参数类型若是 app 内具体类，
 * 必须以值导入（`import X from` / `import { X } from`），不得 type-only。
 */
import { test } from '@japa/runner'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const BACKEND_ROOT = fileURLToPath(new URL('../..', import.meta.url))

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, acc)
    else if (entry.name.endsWith('.ts')) acc.push(p)
  }
  return acc
}

test.group('DI 元数据守卫（F16）', () => {
  test('@inject() 类的构造参数类型不得以 type-only 导入具体类', ({ assert }) => {
    const files = walk(join(BACKEND_ROOT, 'app'))

    // app 内具体类（default 或具名导出 class）
    const concreteClasses = new Set<string>()
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/g)) {
        concreteClasses.add(m[1]!)
      }
    }

    const violations: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!src.includes('@inject()')) continue
      const ctor = src.match(/constructor\s*\(([\s\S]*?)\)\s*[{:]/)
      if (!ctor) continue
      for (const pm of ctor[1]!.matchAll(
        /(?:private|public|protected)\s+(?:readonly\s+)?(\w+)\??:\s*([A-Z]\w*)/g,
      )) {
        const [, name, type] = pm
        if (!concreteClasses.has(type!)) continue // 接口/类型别名无运行时值，不在此列
        const typeOnlyDefault = new RegExp(`import\\s+type\\s+${type}\\s+from`)
        const typeOnlyNamed = new RegExp(`import\\s+type\\s+\\{[^}]*\\b${type}\\b[^}]*\\}\\s+from`)
        if (typeOnlyDefault.test(src) || typeOnlyNamed.test(src)) {
          violations.push(`${relative(BACKEND_ROOT, f).split(sep).join('/')}: ${name}: ${type}`)
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `@inject() 构造参数的类型必须值导入（否则容器运行时无法注入）：\n${violations.join('\n')}`,
    )
  })
})
