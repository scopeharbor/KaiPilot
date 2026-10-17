// v3-multitenant-database-isolation §4.6 —— 业务 raw SQL 清点门禁。
//
// spec「Raw SQL and schema introspection MUST be guarded」要求：租户 scoped 的 raw SQL
// 必须带租户 scope 参数，未 scope 的 raw SQL 只允许用于 schema introspection 或已登记的
// 全局维护。本测试把这条约束变成可执行门禁——扫描 `app/` 下每一处 `rawQuery(` 调用，
// 要求它满足下列之一，否则失败：
//
// 1. 语句片段含组织条件（`organization_id` / `organizationId`）；
// 2. 语句片段含项目条件（`project_id` / `projectId`）——项目必属唯一组织，且调用方
//    一律先经 RBAC/Policy 校验项目归属组织（`RbacService.check` 会查
//    `projectExistsInOrg`），故项目边界等价于租户边界；
// 3. 语句只读 schema 元数据（PRAGMA / sqlite_master / information_schema / pg_catalog /
//    连接探活），按 spec 允许未 scope；
// 4. 文件在已核准白名单内（introspection helper / 方言 helper / 边界服务本身）。
//
// 本轮就是这条门禁定位出 `cross_project_allocation_service` 唯一一处既无组织也无项目
// 条件的 `resource_allocations` 读写（同时暴露它未走 trx、方言不兼容、DateTime 直接
// 当 binding 三个附带缺陷）。扫描源码文本，不依赖运行时，可离线执行。
import { test } from '@japa/runner'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP_DIR = join(process.cwd(), 'app')

/** 语句片段向后取的行数：足以覆盖多行模板字符串 SQL 与 bindings 数组。 */
const STATEMENT_LOOKAHEAD = 16

/**
 * 已核准的文件级白名单——这些文件的职责本身就是「未 scope 的元数据访问」或
 * 「提供 scoped wrapper」，不适用业务 scope 要求。
 */
const FILE_EXEMPTIONS: Record<string, string> = {
  'app/services/database_schema_introspection.ts': '只读 schema 元数据（迁移守卫专用）',
  'app/services/dialect/dialect_helper.ts': '方言判定与安全 raw query 出口',
  'app/services/database_tenant_boundary.ts': 'scoped raw wrapper 与 introspection 出口本身',
  'app/services/pdm_migration/validators/pg_compatibility_gate.ts':
    'PG 兼容性门禁：只探测连接能力与扩展，不读业务行',
}

/** 元数据来源标记：出现其一即认定该语句不读业务行。 */
const METADATA_SOURCE =
  /information_schema|pg_catalog|PRAGMA|sqlite_master|to_regclass|pg_class|pg_index|pg_constraint|current_setting|SELECT\s+1\b|SHOW\s|version\(\)/i

/** 租户/项目 scope 标记。 */
const TENANT_SCOPE = /organization_id|organizationId|project_id|projectId/

/**
 * 显式豁免标记：写在调用点上方或语句内的 `db-scope-verified: <理由>` 注释。
 * 用于「scope 已在同一事务的前置校验中完成、本条语句只按已解析出的主键写入」这类情形
 * （如先按项目 scope 解析出 allocation id，再 `UPDATE ... WHERE id = ?`）。
 * 每处必须写理由——这是可审计的例外，不是静默放行。
 */
const SCOPE_VERIFIED_MARKER = /db-scope-verified:\s*\S+/

/** 调用点向前取的上下文行数（识别写在上方的豁免标记）。 */
const STATEMENT_LOOKBEHIND = 6

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

/** 注释行本身不是调用点（保留注释以便识别豁免标记，故按行首判定而非整体剥离）。 */
function isCommentLine(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

interface RawSqlUsage {
  file: string
  line: number
  snippet: string
  /** 调用点前后上下文：既覆盖多行 SQL 与 bindings，也覆盖写在上方的豁免标记 */
  context: string
}

function collectRawSqlUsages(): RawSqlUsage[] {
  const usages: RawSqlUsage[] = []
  for (const file of listSourceFiles(APP_DIR)) {
    const rel = relative(file)
    if (rel in FILE_EXEMPTIONS) continue
    const lines = readFileSync(file, 'utf-8').split(/\r?\n/)
    lines.forEach((text, index) => {
      if (!/rawQuery\(/.test(text)) return
      if (isCommentLine(text)) return
      usages.push({
        file: rel,
        line: index + 1,
        snippet: text.trim(),
        context: lines
          .slice(Math.max(0, index - STATEMENT_LOOKBEHIND), index + STATEMENT_LOOKAHEAD)
          .join('\n'),
      })
    })
  }
  return usages
}

test.group('业务 raw SQL 清点（§4.6）', () => {
  test('每处 rawQuery 必须带租户/项目 scope，或只读 schema 元数据', ({ assert }) => {
    const usages = collectRawSqlUsages()
    assert.isAbove(usages.length, 0, '应能扫描到 raw SQL 调用（扫描器本身失效时也要失败）')

    const violations = usages
      .filter((u) => !TENANT_SCOPE.test(u.context))
      .filter((u) => !METADATA_SOURCE.test(u.context))
      .filter((u) => !SCOPE_VERIFIED_MARKER.test(u.context))
      .map((u) => `${u.file}:${u.line} — ${u.snippet}`)

    assert.deepEqual(
      violations,
      [],
      `以下 raw SQL 既无租户/项目 scope 也不是元数据查询，且未声明 db-scope-verified：\n${violations.join('\n')}`,
    )
  })

  test('白名单文件必须真实存在（防止豁免条目随文件改名而失效）', ({ assert }) => {
    for (const [file, reason] of Object.entries(FILE_EXEMPTIONS)) {
      assert.isNotEmpty(reason, `${file} 的豁免必须写明理由`)
      assert.doesNotThrow(() => statSync(join(process.cwd(), file)), `白名单文件不存在: ${file}`)
    }
  })
})
