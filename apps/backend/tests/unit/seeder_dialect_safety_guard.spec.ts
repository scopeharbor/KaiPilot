import { test } from '@japa/runner'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * seeder 跨方言写法的静态守卫。
 *
 * 默认测试只跑 SQLite，而 SQLite-only 的写法在 SQLite 上是绿的——
 * 所以这类缺陷靠运行时测试抓不到，只能在源码层面拦截。三条规则对应三个已修过的坑：
 * - 直接消费 `.insert()` 的返回值取主键：pg 不带 returning 时回 Result 对象，会被当 id 写进外键；
 * - `Array.isArray(r) ? r[0] : r`：同上的旧惯用法，看起来两种形态都处理了；
 * - 布尔列与 0/1/true/false 直接比较：PG 回 true/false、SQLite 回 0/1，判据在一侧恒真。
 */

const SEEDERS_DIR = fileURLToPath(new URL('../../database/seeders/', import.meta.url))

interface Rule {
  id: string
  pattern: RegExp
  fix: string
}

const RULES: Rule[] = [
  {
    id: 'consumed-insert-result',
    // `=` 或 `return` 之后紧跟一条以 `.insert(` / `.multiInsert(` 结尾的调用链。
    // `return` 只认同一行：`if (x) return` 换行后的语句按 ASI 是独立语句，不消费返回值。
    pattern:
      /(?:=\s*|\breturn\b[ \t]*)(?:await\s+)?[\w$]+(?:\s*\.\s*[\w$]+\s*(?:\((?:[^()]|\([^()]*\))*\))?)*?\s*\.\s*(?:insert|multiInsert)\s*\(/g,
    fix: '取主键改用 insertReturningId(client, table, values)',
  },
  {
    id: 'array-isarray-id',
    pattern: /Array\.isArray\(\s*[\w$]+\s*\)\s*\?\s*[\w$]+\s*\[\s*0\s*\]/g,
    fix: '删除该惯用法，改用 insertReturningId(client, table, values)',
  },
  {
    id: 'raw-boolean-compare',
    pattern: /\.\s*is_\w+\s*[!=]==?\s*(?:0|1|true|false)\b/g,
    fix: '布尔列比较前先 normalizeBoolean(value)',
  },
]

/** 去掉注释，避免说明文字里的反例被误报；`https://` 这类冒号后的 `//` 不受影响。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

function findViolations(source: string): { rule: string; line: number; fix: string }[] {
  const code = stripComments(source)
  const violations: { rule: string; line: number; fix: string }[] = []
  for (const rule of RULES) {
    for (const match of code.matchAll(rule.pattern)) {
      const line = code.slice(0, match.index).split('\n').length
      violations.push({ rule: rule.id, line, fix: rule.fix })
    }
  }
  return violations
}

test.group('seeder 跨方言静态守卫', () => {
  test('守卫规则能识别已知的 SQLite-only 写法', ({ assert }) => {
    const bad: Record<string, string> = {
      'consumed-insert-result': [
        "const r = await trx.table('users').insert({ email: 'a' })",
        // Prettier 折行后的解构写法（原 kms_key_rings_seeder）
        "const [ringId] = await this.client\n  .table('kms_key_rings')\n  .insert({\n    purpose,\n  })",
        "return trx.table('tasks').insert(values)",
        "const ids = await trx.table('x').multiInsert([{ a: 1 }])",
      ].join('\n'),
      'array-isarray-id': 'return Array.isArray(r) ? r[0] : r',
      'raw-boolean-compare': [
        'if (existing.is_active !== 1) patch.is_active = 1',
        'if (row.is_super_admin === true) return',
      ].join('\n'),
    }
    const expectedCounts: Record<string, number> = {
      'consumed-insert-result': 4,
      'array-isarray-id': 1,
      'raw-boolean-compare': 2,
    }

    for (const [rule, source] of Object.entries(bad)) {
      const hits = findViolations(source).filter((v) => v.rule === rule)
      assert.lengthOf(hits, expectedCounts[rule], `规则 ${rule} 应命中全部反例`)
    }
  })

  test('守卫规则不误报跨方言安全的写法', ({ assert }) => {
    const good = [
      "await trx.table('organization_members').insert({ organization_id: org.id })",
      "await trx.table('resource_allocations').multiInsert([{ a: 1 }])",
      "const userId = await insertReturningId(trx, 'users', { email })",
      // dev_users_seeder 的 ensureMember：提前 return 后另起一行插入
      "if (exists) return\nawait trx.table('organization_members').insert({ role })",
      'if (!normalizeBoolean(existing.is_active)) patch.is_active = 1',
      "const password = await hash.make('password123')\n\nawait trx.table('x').insert({ password })",
      "base_url: 'https://api.openai.com/v1',",
      '// 旧写法 const r = await trx.table("x").insert({}) 只在注释里出现',
      '/* return Array.isArray(r) ? r[0] : r */',
    ].join('\n')

    assert.deepEqual(findViolations(good), [])
  })

  test('database/seeders 下所有 seeder 均无 SQLite-only 写法', ({ assert }) => {
    const files = readdirSync(SEEDERS_DIR).filter((name) => /\.(?:ts|js)$/.test(name))
    // 防止目录路径写错导致守卫静默空转
    assert.isAbove(files.length, 0, `未在 ${SEEDERS_DIR} 找到任何 seeder`)

    const report = files.flatMap((name) =>
      findViolations(readFileSync(join(SEEDERS_DIR, name), 'utf8')).map(
        (v) => `database/seeders/${name}:${v.line} [${v.rule}] ${v.fix}`,
      ),
    )
    assert.deepEqual(report, [], `发现 SQLite-only 写法：\n${report.join('\n')}`)
  })
})
