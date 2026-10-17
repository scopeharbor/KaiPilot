/**
 * v3-docker-compose-runtime-foundation（第七轮）—— PostgreSQL 标识符 63-byte 截断静态审计。
 *
 * 背景（真实 GCP fresh PG 证据）：1815021000001 迁移里
 * `table.unique(['delivery_event_id','attempt_number'])` 与
 * `table.index(['delivery_event_id','attempt_number'])` 的 knex 自动名
 * （`outgoing_webhook_delivery_attempts_delivery_event_id_attempt_number_{unique,index}`）
 * 都被 PG 截断为同一 63 字节前缀 `outgoing_webhook_delivery_attempts_delivery_event_id_attempt_nu`，
 * unique 的 backing index 先占位，create index 随后报 `relation ... already exists`，fresh PG 迁移 exit 1。
 *
 * 本模块对 migrations 目录做纯静态扫描（不连数据库），复刻 knex 3.2.x/3.3.x 的默认命名算法
 * （`lib/schema/tablecompiler.js` 的 `_indexCommand`：`${table}_${columns.join('_')}_${type}`.toLowerCase()），
 * 计算每个 schema 对象的最终标识符、字节长度与 PG 截断后名，并检出：
 *   1. 索引命名空间（schema 级：index / unique backing / pkey / raw CREATE INDEX）截断后碰撞；
 *   2. 外键命名空间（表级：foreign）截断后碰撞；
 *   3. 一切超过 63 字节的标识符（截断本身合法但属隐患，供显式命名/allowlist 裁决）。
 *
 * 解析是确定性的：仅识别字符串字面量参数；遇到动态表达式（变量拼接等）记为 unparsed，
 * 由测试强制人工确认，绝不静默跳过。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** PostgreSQL NAMEDATALEN=64，标识符最大 63 字节。 */
export const PG_IDENTIFIER_MAX_BYTES = 63

export type AuditOperation =
  'index' | 'unique' | 'foreign' | 'primary' | 'raw-index' | 'raw-unique-index'

export interface AuditObject {
  migration: string
  table: string
  operation: AuditOperation
  columns: string[]
  /** 最终标识符（显式名或 knex 自动名，已小写化） */
  name: string
  explicit: boolean
  byteLength: number
  /** PG 63 字节截断后的实际落库名 */
  truncatedName: string
}

export interface AuditUnparsed {
  migration: string
  snippet: string
  reason: string
}

export interface AuditReport {
  objects: AuditObject[]
  unparsed: AuditUnparsed[]
  /** 索引命名空间（schema 级）截断后重名组 */
  indexNamespaceCollisions: Array<{ truncatedName: string; objects: AuditObject[] }>
  /** 外键命名空间（表级）截断后重名组 */
  foreignNamespaceCollisions: Array<{
    table: string
    truncatedName: string
    objects: AuditObject[]
  }>
  /** 所有超过 63 字节的标识符（截断但未必碰撞） */
  truncated: AuditObject[]
}

/** knex `_indexCommand` 复刻：table 中的 `.`/`-` 先替换为 `_`，再整体小写。 */
export function knexAutoName(table: string, columns: string[], type: string): string {
  const normalizedTable = table.replace(/\.|-/g, '_')
  return `${normalizedTable}_${columns.join('_')}_${type}`.toLowerCase()
}

/** PG 标识符截断：按 UTF-8 字节截到 63，丢弃不完整的尾字符（本仓库标识符为 ASCII，等价 slice(0,63)）。 */
export function truncatePgIdentifier(name: string): string {
  const bytes = Buffer.from(name, 'utf8')
  if (bytes.length <= PG_IDENTIFIER_MAX_BYTES) return name
  let end = PG_IDENTIFIER_MAX_BYTES
  // 回退到完整 UTF-8 字符边界（PG 按字符截断）
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}

export function byteLength(name: string): number {
  return Buffer.byteLength(name, 'utf8')
}

interface TableSpan {
  table: string
  /** 回调参数名（通常为 table，少量迁移用 t） */
  param: string
  body: string
}

/** 括号/花括号配平：从 open 下标处找到匹配闭括号，返回 [内容, 结束下标]。 */
function extractBalanced(
  source: string,
  open: number,
  openCh: '(' | '{' = '(',
  closeCh: ')' | '}' = ')',
): [string, number] | null {
  let depth = 0
  let inString: string | null = null
  for (let i = open; i < source.length; i++) {
    const ch = source[i]!
    if (inString) {
      if (ch === '\\') i++
      else if (ch === inString) inString = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') inString = ch
    else if (ch === openCh) depth++
    else if (ch === closeCh) {
      depth--
      if (depth === 0) return [source.slice(open + 1, i), i]
    }
  }
  return null
}

/** 顶层逗号切分参数列表（忽略嵌套括号/数组/字符串内的逗号）。 */
function splitTopLevelArgs(argsSource: string): string[] {
  const args: string[] = []
  let depth = 0
  let inString: string | null = null
  let current = ''
  for (let i = 0; i < argsSource.length; i++) {
    const ch = argsSource[i]!
    if (inString) {
      current += ch
      if (ch === '\\') {
        current += argsSource[++i] ?? ''
      } else if (ch === inString) inString = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') inString = ch
    else if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0 && !inString) {
      args.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim().length > 0) args.push(current.trim())
  return args
}

/** 从参数文本解析字符串字面量数组（`['a','b']` 或 `'a'`）；非字面量返回 null。 */
function parseColumnsArg(arg: string | undefined): string[] | null {
  if (!arg) return null
  const trimmed = arg.trim()
  const arrayMatch = trimmed.match(/^\[([\s\S]*)\]$/)
  const inner = arrayMatch ? arrayMatch[1]! : trimmed
  if (inner.trim().length === 0) return []
  const columns: string[] = []
  for (const part of splitTopLevelArgs(inner)) {
    const lit = part.trim().match(/^'([^']+)'$/)
    if (!lit) return null
    columns.push(lit[1]!)
  }
  return columns
}

/** 从可选参数解析显式名：`'name'` 或 `{ indexName: 'name' / keyName: 'name' }`；无显式名返回 null，不可解析返回 undefined。 */
function parseExplicitName(arg: string | undefined): string | null | undefined {
  if (arg === undefined || arg.trim().length === 0) return null
  const trimmed = arg.trim()
  const lit = trimmed.match(/^'([^']+)'$/)
  if (lit) return lit[1]!
  if (trimmed.startsWith('{')) {
    const m =
      trimmed.match(/\bindexName\s*:\s*'([^']+)'/) ?? trimmed.match(/\bkeyName\s*:\s*'([^']+)'/)
    return m ? m[1]! : null
  }
  return undefined
}

/** 提取迁移文件中的表作用域（createTable/table/alterTable 回调体）。 */
export function extractTableSpans(source: string, fileTableName: string | null): TableSpan[] {
  const spans: TableSpan[] = []
  const callPattern =
    /schema\.(createTable|createTableIfNotExists|table|alterTable)\s*\(\s*(this\.tableName|'[^']+')\s*,\s*\(\s*(\w+)\s*\)\s*=>\s*\{/g
  let m: RegExpExecArray | null
  while ((m = callPattern.exec(source)) !== null) {
    const nameExpr = m[2]!
    const table =
      nameExpr === 'this.tableName' ? fileTableName : (nameExpr.match(/^'([^']+)'$/)?.[1] ?? null)
    if (!table) continue
    const braceOpen = source.indexOf('{', m.index + m[0].length - 1)
    const balanced = extractBalanced(source, braceOpen, '{', '}')
    if (!balanced) continue
    spans.push({ table, param: m[3]!, body: balanced[0] })
  }
  return spans
}

/** 解析列级 `.unique()` / `.index()` 链尾的显式名参数（如 `.index('idx_x')`）。 */
function parseChainNameArg(chainTail: string, method: 'unique' | 'index'): string | null {
  const callPattern = new RegExp(`\\.${method}\\s*\\(([^)]*)\\)`)
  const m = chainTail.match(callPattern)
  if (!m) return null
  const arg = m[1]!.trim()
  if (arg.length === 0) return null
  const lit = arg.match(/^'([^']+)'$/)
  return lit ? lit[1]! : null
}

/** 从列定义链（`table.integer('x')...references(...)` / `....unique()` / `....index()`）提取列级索引/外键。 */
function extractColumnChains(
  body: string,
  table: string,
  param: string,
  migration: string,
  objects: AuditObject[],
): void {
  // 每条语句以分号结束；列定义链从 `<param>.<type>('<col>'` 开始。
  const chainPattern = new RegExp(`${param}\\.(\\w+)\\(\\s*'([^']+)'([\\s\\S]*?);`, 'g')
  let m: RegExpExecArray | null
  while ((m = chainPattern.exec(body)) !== null) {
    const column = m[2]!
    const chainTail = m[3]!
    const pushObject = (operation: AuditOperation, type: string, explicitName: string | null) => {
      const name = (explicitName ?? knexAutoName(table, [column], type)).toLowerCase()
      objects.push({
        migration,
        table,
        operation,
        columns: [column],
        name,
        explicit: explicitName !== null,
        byteLength: byteLength(name),
        truncatedName: truncatePgIdentifier(name),
      })
    }
    if (/\.references\s*\(/.test(chainTail)) pushObject('foreign', 'foreign', null)
    if (new RegExp(`\\.unique\\s*\\(`).test(chainTail)) {
      pushObject('unique', 'unique', parseChainNameArg(chainTail, 'unique'))
    }
    // 列级 .index(：排除表级 `table.index(...)` 自身（其 chainTail 不含 `.index(`）
    if (new RegExp(`\\.index\\s*\\(`).test(chainTail)) {
      pushObject('index', 'index', parseChainNameArg(chainTail, 'index'))
    }
  }
}

/**
 * 剥离注释（保留字符串字面量与换行），避免注释中引用的历史写法（如
 * `// 原 table.index(['delivery_event_id','attempt_number']) …`）被误判为真实 schema 对象。
 */
export function stripComments(source: string): string {
  let out = ''
  let inString: string | null = null
  let i = 0
  while (i < source.length) {
    const ch = source[i]!
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += source[++i] ?? ''
      } else if (ch === inString) inString = null
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch
      out += ch
      i++
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      out += '  '
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      out += '  '
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

/** 扫描单个迁移文件。 */
export function auditMigrationSource(
  source: string,
  migration: string,
): {
  objects: AuditObject[]
  unparsed: AuditUnparsed[]
} {
  const cleanSource = stripComments(source)
  const objects: AuditObject[] = []
  const unparsed: AuditUnparsed[] = []
  const fileTableName = cleanSource.match(/protected\s+tableName\s*=\s*'([^']+)'/)?.[1] ?? null
  const spans = extractTableSpans(cleanSource, fileTableName)

  const push = (
    table: string,
    operation: AuditOperation,
    type: string,
    columns: string[],
    explicitName: string | null,
  ) => {
    const name = (explicitName ?? knexAutoName(table, columns, type)).toLowerCase()
    objects.push({
      migration,
      table,
      operation,
      columns,
      name,
      explicit: explicitName !== null,
      byteLength: byteLength(name),
      truncatedName: truncatePgIdentifier(name),
    })
  }

  for (const span of spans) {
    const { table, param, body } = span
    // 表级 table.index / table.unique / table.foreign / table.primary
    const stmtPattern = new RegExp(`${param}\\.(index|unique|foreign|primary)\\s*\\(`, 'g')
    let m: RegExpExecArray | null
    while ((m = stmtPattern.exec(body)) !== null) {
      const kind = m[1]! as 'index' | 'unique' | 'foreign' | 'primary'
      const openParen = body.indexOf('(', m.index + m[0].length - 1)
      const balanced = extractBalanced(body, openParen)
      if (!balanced) {
        unparsed.push({
          migration,
          snippet: body.slice(m.index, m.index + 80),
          reason: 'unbalanced',
        })
        continue
      }
      const args = splitTopLevelArgs(balanced[0])
      const columns = parseColumnsArg(args[0])
      if (columns === null) {
        unparsed.push({
          migration,
          snippet: `${param}.${kind}(${args[0]?.slice(0, 60) ?? ''}...)`,
          reason: 'columns-not-literal',
        })
        continue
      }
      const explicit = parseExplicitName(args[1])
      if (explicit === undefined) {
        unparsed.push({
          migration,
          snippet: `${param}.${kind}(..., ${args[1]?.slice(0, 60) ?? ''})`,
          reason: 'name-not-literal',
        })
        continue
      }
      push(table, kind, kind, columns, explicit)
    }

    // 列级链：.references() → FK，.unique()/.index() → 表级等价命名
    extractColumnChains(body, table, param, migration, objects)

    // increments → `<table>_pkey`（PG 自动命名主键 backing index）
    const incrementsPattern = new RegExp(`${param}\\.(increments|bigincrements)\\s*\\(`, 'g')
    if (incrementsPattern.test(body)) {
      push(table, 'primary', 'pkey', ['id'], null)
    }
  }

  // raw CREATE INDEX（显式名；`${this.tableName}` 解析为文件级表名，其余动态表名记 unparsed）
  const rawPattern =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s+ON\s+(\$\{this\.tableName\}|["'`]?[\w.]+["'`]?)/gi
  let rm: RegExpExecArray | null
  while ((rm = rawPattern.exec(cleanSource)) !== null) {
    const name = rm[2]!.toLowerCase()
    const tableExpr = rm[3]!
    let table: string | null
    if (tableExpr === '${this.tableName}') {
      table = fileTableName
    } else {
      table = tableExpr.replace(/^["'`]|["'`]$/g, '').toLowerCase()
    }
    if (!table) {
      unparsed.push({ migration, snippet: rm[0].slice(0, 80), reason: 'raw-table-dynamic' })
      continue
    }
    objects.push({
      migration,
      table,
      operation: rm[1] ? 'raw-unique-index' : 'raw-index',
      columns: [],
      name,
      explicit: true,
      byteLength: byteLength(name),
      truncatedName: truncatePgIdentifier(name),
    })
  }

  return { objects, unparsed }
}

/** 汇总审计：碰撞与截断清单。 */
export function summarizeAudit(objects: AuditObject[]): Omit<AuditReport, 'objects' | 'unparsed'> {
  // 同一迁移内同名对象的重复出现（up/down 重建、方言分支互斥）不会同时落库，去重；
  // 同迁移内**不同名**对象（如 attempts 的 ..._unique 与 ..._index）截断后仍可能碰撞，必须保留。
  const seen = new Set<string>()
  const effective = objects.filter((o) => {
    const key = `${o.migration}${o.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const indexNamespace = effective.filter((o) => o.operation !== 'foreign')
  const foreignNamespace = effective.filter((o) => o.operation === 'foreign')

  const group = (list: AuditObject[], key: (o: AuditObject) => string) => {
    const map = new Map<string, AuditObject[]>()
    for (const o of list) {
      const k = key(o)
      const arr = map.get(k)
      if (arr) arr.push(o)
      else map.set(k, [o])
    }
    return [...map.entries()].filter(([, arr]) => arr.length > 1)
  }

  return {
    indexNamespaceCollisions: group(indexNamespace, (o) => o.truncatedName).map(
      ([truncatedName, objs]) => ({ truncatedName, objects: objs }),
    ),
    foreignNamespaceCollisions: group(foreignNamespace, (o) => `${o.table} ${o.truncatedName}`).map(
      ([key, objs]) => {
        const [table, truncatedName] = key.split(' ')
        return { table: table!, truncatedName: truncatedName!, objects: objs }
      },
    ),
    truncated: effective.filter((o) => o.byteLength > PG_IDENTIFIER_MAX_BYTES),
  }
}

/** 审计整个 migrations 目录。 */
export function auditMigrationsDir(migrationsDir: string): AuditReport {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.ts'))
    .sort()
  const allObjects: AuditObject[] = []
  const allUnparsed: AuditUnparsed[] = []
  for (const file of files) {
    const { objects, unparsed } = auditMigrationSource(
      readFileSync(join(migrationsDir, file), 'utf8'),
      file,
    )
    allObjects.push(...objects)
    allUnparsed.push(...unparsed)
  }
  return { objects: allObjects, unparsed: allUnparsed, ...summarizeAudit(allObjects) }
}
