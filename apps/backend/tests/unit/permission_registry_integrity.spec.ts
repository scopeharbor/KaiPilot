// v3-legacy-contract-debt-fixes W5（D-F）—— 权限码登记债回归守卫。
//
// 债因：`resource_gap_analysis_policy.ts` 曾以 `'ai:resource-gap:explain' as Permission`
// 消费一个**未登记**的权限码。`as Permission` 把 `ALL_PERMISSIONS`（RL-14 确定性白名单）
// 的类型约束绕过去了：编译期不报错、运行期 `RbacService.check` 对未知码只会返回拒绝，
// 于是这条链路静默"永久关闭"，且没有任何测试能发现。
//
// 本测试把该债的两个确定性特征锚成契约，防止同类写法再次进来：
//   1) `app/policies`、`app/controllers` 源码里不得出现 `as Permission` 强转
//      （既有命中冻结为基线，见 `KNOWN_CAST_BASELINE`）；
//   2) 源码里出现的权限码字面量必须已在 `ALL_PERMISSIONS` 登记
//      （既有违规冻结为豁免，见 `UNREGISTERED_LITERAL_EXEMPTIONS`）。
//
// 只扫源码文本、不依赖运行时，可在 unit suite 离线执行；体例沿用
// `tests/unit/tenant_scope_inventory.spec.ts`（同款 stripComments + 按文件/条目登记豁免 +
// 僵尸豁免断言）。注：`ALL_PERMISSIONS` 去重与 `isPermission` 守卫已由
// `tests/unit/rbac.spec.ts` 覆盖，此处不重复。
import { test } from '@japa/runner'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AI_RESOURCE_GAP_EXPLAIN, isPermission } from '#start/rbac/permissions'

const SCAN_DIRS = ['app/policies', 'app/controllers'].map((dir) => join(process.cwd(), dir))

const RESOURCE_GAP_POLICY = join(
  process.cwd(),
  'app',
  'policies',
  'resource_gap_analysis_policy.ts',
)

/** 权限码形状：小写/下划线/数字段 + 至少一个冒号（`start/rbac/permissions.ts` 的命名体例）。 */
const PERMISSION_LITERAL = /'([a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)+)'/g

/** Node 内建模块说明符（`import { randomUUID } from 'node:crypto'`）与权限码同形但语义无关。 */
const NODE_BUILTIN_MODULE = /^node:/

const PERMISSION_CAST = /\bas Permission\b/

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full))
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

function relative(file: string): string {
  return file.slice(process.cwd().length + 1).replace(/\\/g, '/')
}

/** 去掉行注释与块注释，避免把说明文字里的示例当成真实代码。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

interface Finding {
  file: string
  line: number
  snippet: string
}

function keyOf(finding: Finding): string {
  return `${finding.file}::${finding.snippet}`
}

function describeFindings(findings: Finding[]): string {
  return findings.map((f) => `${f.file}:${f.line} — ${f.snippet}`).join('\n')
}

function sourceLines(file: string): string[] {
  return stripComments(readFileSync(file, 'utf-8')).split(/\r?\n/)
}

function scanLines(pattern: RegExp): Finding[] {
  const findings: Finding[] = []
  for (const file of SCAN_DIRS.flatMap(listSourceFiles)) {
    sourceLines(file).forEach((text, index) => {
      if (!pattern.test(text)) return
      findings.push({ file: relative(file), line: index + 1, snippet: normalize(text) })
    })
  }
  return findings
}

function collectPermissionLiterals(): Finding[] {
  const findings: Finding[] = []
  for (const file of SCAN_DIRS.flatMap(listSourceFiles)) {
    sourceLines(file).forEach((text, index) => {
      for (const match of text.matchAll(PERMISSION_LITERAL)) {
        if (NODE_BUILTIN_MODULE.test(match[1])) continue
        findings.push({ file: relative(file), line: index + 1, snippet: match[1] })
      }
    })
  }
  return findings
}

/**
 * 既有 `as Permission` 强转基线（已在 Wave C 全部解冻清零）。
 */
const KNOWN_CAST_BASELINE: Record<string, string> = {}

/**
 * 既有未登记字面量豁免（已在 Wave C 全部补登记并使用常量清零）。
 */
const UNREGISTERED_LITERAL_EXEMPTIONS: Record<string, string> = {}

test.group('Permission registry integrity —— 权限码登记与强转守卫（D-F）', () => {
  test('policies / controllers 不得出现 `as Permission` 强转（严格白名单模式）', ({ assert }) => {
    const findings = scanLines(PERMISSION_CAST)
    assert.deepEqual(
      [...new Set(findings.map(keyOf))].sort(),
      [],
      [
        '`as Permission` 绕过 ALL_PERMISSIONS 的类型约束（RL-14 白名单纪律）。',
        '新增命中请改用 #start/rbac/permissions 导出的常量；修掉既有条目请同步删除基线条目。',
        `当前命中：\n${describeFindings(findings)}`,
      ].join('\n'),
    )
  })

  test('policies / controllers 的字面量权限码必须已在 ALL_PERMISSIONS 登记', ({ assert }) => {
    const findings = collectPermissionLiterals()
    const unregistered = findings.filter(
      (f) => !isPermission(f.snippet) && !(keyOf(f) in UNREGISTERED_LITERAL_EXEMPTIONS),
    )
    assert.deepEqual(
      [...new Set(unregistered.map(keyOf))].sort(),
      [],
      [
        '未登记权限码在运行期只会被拒绝，等于把能力静默关掉。',
        '修法：在 start/rbac/permissions.ts 的 ALL_PERMISSIONS 按分组补登记并按体例导出常量。',
        `当前命中：\n${describeFindings(unregistered)}`,
      ].join('\n'),
    )
  })

  test('豁免表不得留下僵尸条目（既有债修掉后必须同步删除豁免）', ({ assert }) => {
    const observed = new Set([
      ...scanLines(PERMISSION_CAST).map(keyOf),
      ...collectPermissionLiterals().map(keyOf),
    ])
    const stale = [
      ...Object.keys(KNOWN_CAST_BASELINE),
      ...Object.keys(UNREGISTERED_LITERAL_EXEMPTIONS),
    ].filter((key) => !observed.has(key))
    assert.deepEqual(
      stale,
      [],
      '豁免条目已不再命中，请从测试的豁免表删除，否则豁免会静默腐烂成永久遮羞布。',
    )
  })

  test('D-F.1 回归锚点：ai:resource-gap:explain 已登记并由 policy 以常量消费（无强转）', ({
    assert,
  }) => {
    assert.isTrue(
      isPermission(AI_RESOURCE_GAP_EXPLAIN),
      'ai:resource-gap:explain 必须登记进 ALL_PERMISSIONS',
    )
    assert.equal(AI_RESOURCE_GAP_EXPLAIN, 'ai:resource-gap:explain')

    const source = stripComments(readFileSync(RESOURCE_GAP_POLICY, 'utf-8'))
    assert.isTrue(
      source.includes('AI_RESOURCE_GAP_EXPLAIN'),
      'resource_gap_analysis_policy 必须通过导入的常量消费该权限码',
    )
    assert.isFalse(
      source.includes(`'${AI_RESOURCE_GAP_EXPLAIN}'`),
      'resource_gap_analysis_policy 不得再内联该权限码字面量',
    )
  })
})
