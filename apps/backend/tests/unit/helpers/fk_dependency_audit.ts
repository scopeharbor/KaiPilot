/**
 * v3-docker-compose-runtime-foundation（第八轮）—— FK 依赖顺序静态审计。
 *
 * 背景（真实 GCP fresh PG 证据，MIGRATE_EXIT=1）：
 * 1840100000000_create_copilot_memory_entries_table 内联声明
 * basis_session_db_id → copilot_sessions 外键，而 copilot_sessions 由更晚的
 * 1841000000000 才创建。SQLite 的 CREATE TABLE 不校验被引用表存在性，故全量
 * SQLite 迁移测试从未暴露；PostgreSQL 建约束即要求父表存在，fresh PG 直接
 * `relation "copilot_sessions" does not exist`。
 *
 * 本模块对 migrations 目录做纯静态扫描（不连数据库），提取全部 FK 引用
 * （列链 .references().inTable()、表级 table.foreign()、raw ADD CONSTRAINT），
 * 建立 table → 创建迁移映射，检出 child migration 早于 parent 创建的
 * forward reference，并按方言守卫分类：
 *   A. PG 可达的 forward FK —— 真实 blocker，零容忍；
 *   B. 仅 SQLite 分支的 forward FK（PG 永远不会执行）；
 *   C. 有意的 deferred FK —— SQLite 分支保留 inline FK，且存在更晚的 PG 可达
 *      迁移为同一 (childTable, childColumn, parentTable) 补 FK（如
 *      1841000000002 补 fk_cme_basis_session）；
 *   D. 父表不由本仓库任何迁移创建（外部 bootstrap 表）；
 *   E. 动态/无法静态解析 —— 记 unparsed，由测试强制人工确认。
 *
 * 解析约定：仓库为 standard（无分号）风格，语句边界不靠 `;`，而是按
 * `.method(...)` 链式段逐个括号配平消费；注释先经 stripComments 剥离。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { knexAutoName, stripComments } from './pg_identifier_audit.js'

export interface FkReference {
  /** 所在迁移文件名 */
  migration: string
  /** 子表（FK 所在表） */
  childTable: string
  childColumns: string[]
  parentTable: string
  parentColumn: string
  onDelete: string | null
  /** 最终约束名（显式名或 knex 自动名 `<table>_<col>_foreign`） */
  fkName: string
  explicitName: boolean
  /** FK 语句外层的方言守卫条件原文（用于人工复核） */
  guards: string[]
  /** 静态判定：PG 是否可能执行到该 FK 语句 */
  pgReachable: boolean
}

export interface FkAuditUnparsed {
  migration: string
  snippet: string
  reason: string
}

export interface TableCreation {
  table: string
  migration: string
}

export type ForwardFkCategory = 'A' | 'B' | 'C' | 'D'

export interface ForwardFkReference extends FkReference {
  category: ForwardFkCategory
  /** 创建父表的迁移（D 类为 null） */
  parentMigration: string | null
  /** C 类：补齐同一 FK 的 PG 可达后续迁移 */
  deferredBy: string | null
}

export interface FkAuditReport {
  references: FkReference[]
  unparsed: FkAuditUnparsed[]
  tableCreations: TableCreation[]
  forwardReferences: ForwardFkReference[]
}

/** 圆括号配平（字符串字面量感知）。 */
function extractBalanced(source: string, open: number): [string, number] | null {
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
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return [source.slice(open + 1, i), i]
    }
  }
  return null
}

/** 花括号配平。 */
function extractBalancedBrace(source: string, open: number): [string, number] | null {
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
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return [source.slice(open + 1, i), i]
    }
  }
  return null
}

/** 顶层逗号切分（忽略嵌套）。 */
function splitTopLevelArgs(argsSource: string): string[] {
  const args: string[] = []
  let depth = 0
  let inString: string | null = null
  let current = ''
  for (let i = 0; i < argsSource.length; i++) {
    const ch = argsSource[i]!
    if (inString) {
      current += ch
      if (ch === '\\') current += argsSource[++i] ?? ''
      else if (ch === inString) inString = null
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

/** 解析列参数（`'a'` 或 `['a','b']`）；非字面量返回 null。 */
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

/**
 * 从 pos 起逐段消费 `.method(...)` 链（允许换行/空白），返回链文本与结束下标。
 * 仓库为无分号风格，链边界 = 下一个非 `.method(` 输入。
 */
function consumeChain(body: string, start: number): { text: string; end: number } {
  let pos = start
  let text = ''
  for (;;) {
    const seg = /^\s*\.\s*(\w+)\s*\(/.exec(body.slice(pos))
    if (!seg) break
    const openParen = pos + seg[0].length - 1
    const balanced = extractBalanced(body, openParen)
    if (!balanced) break
    text += body.slice(pos, balanced[1] + 1)
    pos = balanced[1] + 1
  }
  return { text, end: pos }
}

interface GuardRegion {
  start: number
  end: number
  cond: string
  negated: boolean
}

/**
 * 扫描 `if (cond) { ... } else { ... }` 区域（字符串感知，支持 else / else if 链）。
 * 用于判定某条 FK 语句是否处于方言分支内。
 */
export function extractGuardRegions(source: string): GuardRegion[] {
  const regions: GuardRegion[] = []
  const stack: Array<{ cond: string; negated: boolean; start: number }> = []
  let inString: string | null = null
  let i = 0
  while (i < source.length) {
    const ch = source[i]!
    if (inString) {
      if (ch === '\\') i += 2
      else {
        if (ch === inString) inString = null
        i++
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch
      i++
      continue
    }
    // if (cond) {
    const ifMatch = /^if\s*\(/.exec(source.slice(i))
    if (ifMatch && (i === 0 || !/[\w$]/.test(source[i - 1]!))) {
      const openParen = i + ifMatch[0].length - 1
      const balanced = extractBalanced(source, openParen)
      if (balanced) {
        let j = balanced[1] + 1
        while (j < source.length && /\s/.test(source[j]!)) j++
        if (source[j] === '{') {
          stack.push({ cond: balanced[0], negated: false, start: j + 1 })
          i = j + 1
          continue
        }
        i = balanced[1] + 1
        continue
      }
    }
    if (ch === '{') {
      stack.push({ cond: '', negated: false, start: i + 1 })
      i++
      continue
    }
    if (ch === '}') {
      const top = stack.pop()
      i++
      if (top && top.cond.length > 0) {
        regions.push({ start: top.start, end: i - 1, cond: top.cond, negated: top.negated })
      }
      // else / else if 链：else 翻转 negation，else if 交由下一轮 if 识别
      const elseMatch = /^\s*else\s*/.exec(source.slice(i))
      if (elseMatch && top) {
        const j = i + elseMatch[0].length
        if (/^if\s*\(/.test(source.slice(j))) {
          // else if (...) { —— 回退到 if 关键字重新进入识别
          i = j
          continue
        }
        let k = j
        while (k < source.length && /\s/.test(source[k]!)) k++
        if (source[k] === '{') {
          stack.push({ cond: top.cond, negated: !top.negated, start: k + 1 })
          i = k + 1
          continue
        }
      }
      continue
    }
    i++
  }
  return regions
}

type DialectGuard = 'sqlite-only' | 'pg-only' | 'unknown'

/** 判定守卫条件的方言含义。 */
export function classifyGuardCondition(cond: string): DialectGuard {
  if (/!isSqliteDialect\s*\(/.test(cond)) return 'pg-only'
  if (/\bisSqliteDialect\s*\(/.test(cond)) return 'sqlite-only'
  if (/!isPgDialect\s*\(/.test(cond)) return 'sqlite-only'
  if (/\bisPgDialect\s*\(/.test(cond)) return 'pg-only'
  if (/!isSqlite\b/.test(cond)) return 'pg-only'
  if (/\bisSqlite\b/.test(cond)) return 'sqlite-only'
  if (/!={2}\s*'(sqlite3|better-sqlite3)'/.test(cond)) return 'pg-only'
  if (/===\s*'(sqlite3|better-sqlite3)'/.test(cond)) return 'sqlite-only'
  if (/!={2}\s*'(postgres|redshift)'/.test(cond)) return 'sqlite-only'
  if (/===\s*'(postgres|redshift)'/.test(cond)) return 'pg-only'
  return 'unknown'
}

function invertGuard(g: DialectGuard): DialectGuard {
  if (g === 'sqlite-only') return 'pg-only'
  if (g === 'pg-only') return 'sqlite-only'
  return 'unknown'
}

/**
 * 判定 position 处的语句在 PG 上是否可达。
 * 保守原则：任一外层守卫把 PG 排除则不可达；无法识别的守卫视为两端可达。
 */
export function isPgReachable(
  regions: GuardRegion[],
  position: number,
): {
  pgReachable: boolean
  guards: string[]
} {
  const guards: string[] = []
  let reachable = true
  for (const region of regions) {
    if (position < region.start || position >= region.end) continue
    const dialect = classifyGuardCondition(region.cond)
    const effective = region.negated ? invertGuard(dialect) : dialect
    guards.push(`${region.negated ? 'else of ' : ''}if (${region.cond.trim()})`)
    if (effective === 'sqlite-only') reachable = false
  }
  return { pgReachable: reachable, guards }
}

/** 解析 createTable/table/alterTable 的表名表达式。 */
function resolveTableExpr(expr: string, source: string): string | null {
  const trimmed = expr.trim()
  const lit = trimmed.match(/^'([^']+)'$/)
  if (lit) return lit[1]!
  if (trimmed === 'this.tableName') {
    return source.match(/protected\s+tableName\s*=\s*'([^']+)'/)?.[1] ?? null
  }
  const staticProp = trimmed.match(/^\w+\.(\w*[tT]ableName)$/)
  if (staticProp) {
    const prop = staticProp[1]!
    const re = new RegExp(`static\\s+(?:readonly\\s+)?${prop}\\s*=\\s*'([^']+)'`)
    return source.match(re)?.[1] ?? null
  }
  if (/^\w+$/.test(trimmed)) {
    const re = new RegExp(`(?:const|let)\\s+${trimmed}\\s*=\\s*'([^']+)'`)
    return source.match(re)?.[1] ?? null
  }
  return null
}

interface TableSpan {
  method: string
  table: string
  param: string
  body: string
  bodyStart: number
}

/** body 是否含 FK 相关调用（决定表名不可解析时是跳过还是记 unparsed）。 */
function bodyHasFkMarkers(body: string): boolean {
  return /\.references\s*\(|\.inTable\s*\(|\.\s*foreign\s*\(/.test(body)
}

/** 提取 createTable/createTableIfNotExists/table/alterTable 回调体（含表名解析）。 */
function extractSpans(
  source: string,
  migration: string,
): { spans: TableSpan[]; unparsed: FkAuditUnparsed[] } {
  const spans: TableSpan[] = []
  const unparsed: FkAuditUnparsed[] = []
  const callPattern =
    /schema\.(createTable|createTableIfNotExists|table|alterTable)\s*\(\s*([^,]+?)\s*,\s*\(\s*(\w+)\s*\)\s*=>\s*\{/g
  let m: RegExpExecArray | null
  while ((m = callPattern.exec(source)) !== null) {
    const braceOpen = source.indexOf('{', m.index + m[0].length - 1)
    const balanced = extractBalancedBrace(source, braceOpen)
    if (!balanced) continue
    const table = resolveTableExpr(m[2]!, source)
    if (!table) {
      // 循环变量等动态表名：body 无 FK 调用时与本审计无关，跳过；
      // 含 FK 调用则必须人工确认（记 unparsed，测试零容忍）。
      if (bodyHasFkMarkers(balanced[0])) {
        unparsed.push({
          migration,
          snippet: `${m[0].slice(0, 60)} :: ${balanced[0].slice(0, 60)}`,
          reason: `table-expr-unresolved-with-fk: ${m[2]!.trim().slice(0, 40)}`,
        })
      }
      continue
    }
    spans.push({
      method: m[1]!,
      table,
      param: m[3]!,
      body: balanced[0],
      bodyStart: braceOpen + 1,
    })
  }
  return { spans, unparsed }
}

/** 从链文本提取 .references('col') / .inTable('table') / .onDelete('X') / .withKeyName('n')。
 * inTable 参数允许静态属性/常量表达式（如 `ClassName.tableName`），经 resolveTableExpr 解析；
 * 仍不可解析返回 undefined（记 unparsed）。 */
function parseFkChainTail(
  tail: string,
  source: string,
): {
  parentColumn: string | null
  parentTable: string | null | undefined
  onDelete: string | null
  withKeyName: string | null
} {
  const refMatch = tail.match(/\.references\s*\(\s*'([^']+)'\s*\)/)
  const inTableMatch = tail.match(/\.inTable\s*\(\s*([^)]+?)\s*\)/)
  const onDeleteMatch = tail.match(/\.onDelete\s*\(\s*'([^']+)'\s*\)/)
  const withKeyNameMatch = tail.match(/\.withKeyName\s*\(\s*'([^']+)'\s*\)/)
  let parentTable: string | null | undefined = null
  if (inTableMatch) {
    parentTable = resolveTableExpr(inTableMatch[1]!, source) ?? undefined
  }
  return {
    parentColumn: refMatch?.[1] ?? null,
    parentTable,
    onDelete: onDeleteMatch?.[1] ?? null,
    withKeyName: withKeyNameMatch?.[1] ?? null,
  }
}

/** 扫描单个迁移文件，提取 FK 引用与建表记录。 */
export function auditFkMigrationSource(
  source: string,
  migration: string,
): {
  references: FkReference[]
  unparsed: FkAuditUnparsed[]
  tableCreations: TableCreation[]
} {
  const clean = stripComments(source)
  const regions = extractGuardRegions(clean)
  const references: FkReference[] = []
  const unparsed: FkAuditUnparsed[] = []
  const tableCreations: TableCreation[] = []

  const { spans, unparsed: spanUnparsed } = extractSpans(clean, migration)
  unparsed.push(...spanUnparsed)

  for (const span of spans) {
    if (span.method === 'createTable' || span.method === 'createTableIfNotExists') {
      tableCreations.push({ table: span.table, migration })
    }
    const { table, param, body, bodyStart } = span

    // 每条 builder 语句的首个调用：`table . <method> ( ... )`，随后消费链尾。
    // foreign 走表级分支；其余首个参数为字符串字面量者按列定义链处理。
    const stmtPattern = new RegExp(`${param}\\s*\\.\\s*(\\w+)\\s*\\(`, 'g')
    let sm: RegExpExecArray | null
    while ((sm = stmtPattern.exec(body)) !== null) {
      const method = sm[1]!
      const openParen = sm.index + sm[0].length - 1
      const balanced = extractBalanced(body, openParen)
      if (!balanced) continue
      const firstCallArgs = balanced[0]
      const chain = consumeChain(body, balanced[1] + 1)
      const tail = chain.text

      if (method === 'foreign') {
        // 表级 table.foreign('col' | ['cols'], 'name'?)....references().inTable()...
        const args = splitTopLevelArgs(firstCallArgs)
        const columns = parseColumnsArg(args[0])
        if (columns === null || columns.length === 0) {
          unparsed.push({
            migration,
            snippet: `${param}.foreign(${args[0]?.slice(0, 60) ?? ''}...)`,
            reason: 'columns-not-literal',
          })
          continue
        }
        const nameLit = args[1]?.trim().match(/^'([^']+)'$/)
        const chainInfo = parseFkChainTail(tail, clean)
        const explicitName = chainInfo.withKeyName ?? nameLit?.[1] ?? null
        if (chainInfo.parentTable === undefined) {
          unparsed.push({ migration, snippet: tail.slice(0, 80), reason: 'inTable-not-literal' })
          continue
        }
        if (!chainInfo.parentTable || !chainInfo.parentColumn) {
          unparsed.push({
            migration,
            snippet: `${param}.foreign(...)${tail.slice(0, 60)}`,
            reason: 'missing-inTable-or-references',
          })
          continue
        }
        const { pgReachable, guards } = isPgReachable(regions, bodyStart + sm.index)
        references.push({
          migration,
          childTable: table,
          childColumns: columns,
          parentTable: chainInfo.parentTable,
          parentColumn: chainInfo.parentColumn,
          onDelete: chainInfo.onDelete,
          fkName: explicitName ?? knexAutoName(table, [columns[0]!], 'foreign'),
          explicitName: explicitName !== null,
          guards,
          pgReachable,
        })
        continue
      }

      // 列定义链：首参数须为字符串字面量列名，且链中含 .references(
      if (method === 'index' || method === 'unique' || method === 'primary') continue
      if (method === 'dropForeign' || method === 'dropUnique' || method === 'dropIndex') continue
      const firstArg = splitTopLevelArgs(firstCallArgs)[0]?.trim()
      const colLit = firstArg?.match(/^'([^']+)'$/)
      if (!colLit) continue
      if (!/\.references\s*\(/.test(tail)) continue
      const chainInfo = parseFkChainTail(tail, clean)
      if (chainInfo.parentTable === undefined) {
        unparsed.push({ migration, snippet: tail.slice(0, 80), reason: 'inTable-not-literal' })
        continue
      }
      if (!chainInfo.parentTable || !chainInfo.parentColumn) continue
      const { pgReachable, guards } = isPgReachable(regions, bodyStart + sm.index)
      references.push({
        migration,
        childTable: table,
        childColumns: [colLit[1]!],
        parentTable: chainInfo.parentTable,
        parentColumn: chainInfo.parentColumn,
        onDelete: chainInfo.onDelete,
        fkName: chainInfo.withKeyName ?? knexAutoName(table, [colLit[1]!], 'foreign'),
        explicitName: chainInfo.withKeyName !== null,
        guards,
        pgReachable,
      })
    }
  }

  // ── raw SQL FK 解析（三种形态）──
  // 每个 FOREIGN KEY 关键字出现都必须被以下某条规则覆盖，否则记 unparsed。
  const coveredFkPositions = new Set<number>()
  const coverFromMatch = (m: RegExpExecArray) => {
    const kwOffset = m[0].toUpperCase().indexOf('FOREIGN')
    if (kwOffset >= 0) coveredFkPositions.add(m.index + kwOffset)
  }

  // 形态 1：ALTER TABLE <字面量子表> ADD CONSTRAINT name FOREIGN KEY (col) REFERENCES p (pcol)
  const rawFkPattern =
    /ALTER\s+TABLE\s+["'`]?(?:\w+["'`]?\.["'`]?)?(\w+)["'`]?\s+ADD\s+CONSTRAINT\s+["'`]?(\w+)["'`]?\s+FOREIGN\s+KEY\s*\(\s*["'`]?(\w+)["'`]?\s*\)\s+REFERENCES\s+["'`]?(?:\w+["'`]?\.["'`]?)?(\w+)["'`]?\s*\(\s*["'`]?(\w+)["'`]?\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/gi
  let rm: RegExpExecArray | null
  const literalRawRanges: Array<[number, number]> = []
  while ((rm = rawFkPattern.exec(clean)) !== null) {
    coverFromMatch(rm)
    literalRawRanges.push([rm.index, rm.index + rm[0].length])
    const { pgReachable, guards } = isPgReachable(regions, rm.index)
    references.push({
      migration,
      childTable: rm[1]!,
      childColumns: [rm[3]!],
      parentTable: rm[4]!,
      parentColumn: rm[5]!,
      onDelete: rm[6]?.toUpperCase() ?? null,
      fkName: rm[2]!,
      explicitName: true,
      guards,
      pgReachable,
    })
  }

  // 形态 2：ALTER TABLE <动态子表 ${...}> ADD CONSTRAINT <动态名> FOREIGN KEY (col)
  //         REFERENCES <字面量父表>(pcol)（如 1839300000001 对 DEFERRED_TABLES 循环）。
  //         子表动态不可解析时以 '<dynamic>' 登记；父表字面量仍可参与顺序审计。
  const dynamicAlterPattern =
    /ALTER\s+TABLE\s+[^)]*?ADD\s+CONSTRAINT\s+[^)]*?FOREIGN\s+KEY\s*\(\s*["'`]?(\w+)["'`]?\s*\)\s+REFERENCES\s+["'`]?(?:(\w+)["'`]?\.["'`]?)?(\w+)["'`]?\s*\(\s*["'`]?(\w+)["'`]?\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/gi
  while ((rm = dynamicAlterPattern.exec(clean)) !== null) {
    if (literalRawRanges.some(([s, e]) => rm!.index >= s && rm!.index < e)) continue
    coverFromMatch(rm)
    const { pgReachable, guards } = isPgReachable(regions, rm.index)
    references.push({
      migration,
      childTable: '<dynamic>',
      childColumns: [rm[1]!],
      parentTable: rm[3]!,
      parentColumn: rm[4]!,
      onDelete: rm[5]?.toUpperCase() ?? null,
      fkName: '<dynamic>',
      explicitName: true,
      guards,
      pgReachable,
    })
  }

  // 形态 3：CREATE TABLE DDL 内联 `FOREIGN KEY (col) REFERENCES tbl(pcol)`
  //         （SQLite 重建分支的 raw CREATE TABLE；子表 = 前方最近的 CREATE TABLE 目标）
  const inlineFkPattern =
    /FOREIGN\s+KEY\s*\(\s*["'`]?(\w+)["'`]?\s*\)\s+REFERENCES\s+["'`]?(\w+)["'`]?\s*\(\s*["'`]?(\w+)["'`]?\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/gi
  const createTablePositions: Array<{ pos: number; table: string }> = []
  {
    const ctPattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi
    let cm: RegExpExecArray | null
    while ((cm = ctPattern.exec(clean)) !== null) {
      createTablePositions.push({ pos: cm.index, table: cm[1]! })
    }
  }
  while ((rm = inlineFkPattern.exec(clean)) !== null) {
    if (coveredFkPositions.has(rm.index)) continue
    // 已被形态 1/2 覆盖（关键字位置相同）的跳过；其余按 inline 处理
    const owner = [...createTablePositions].reverse().find((c) => c.pos < rm!.index)
    coverFromMatch(rm)
    const { pgReachable, guards } = isPgReachable(regions, rm.index)
    references.push({
      migration,
      childTable: owner?.table ?? '<unknown>',
      childColumns: [rm[1]!],
      parentTable: rm[2]!,
      parentColumn: rm[3]!,
      onDelete: rm[4]?.toUpperCase() ?? null,
      fkName: '<inline-ddl>',
      explicitName: false,
      guards,
      pgReachable,
    })
  }

  // 每个 FOREIGN KEY 出现都必须被覆盖，否则记 unparsed（强制人工确认）
  const fkKeyword = /FOREIGN\s+KEY/gi
  let km: RegExpExecArray | null
  while ((km = fkKeyword.exec(clean)) !== null) {
    if (coveredFkPositions.has(km.index)) continue
    unparsed.push({
      migration,
      snippet: clean.slice(Math.max(0, km.index - 120), km.index + 120).replace(/\s+/g, ' '),
      reason: 'raw-fk-dynamic',
    })
  }

  // raw CREATE TABLE（建表映射补全）
  for (const c of createTablePositions) {
    tableCreations.push({ table: c.table, migration })
  }

  return { references, unparsed, tableCreations }
}

/** 审计整个 migrations 目录并分类 forward references。 */
export function auditFkDependencies(migrationsDir: string): FkAuditReport {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.ts'))
    .sort()
  const references: FkReference[] = []
  const unparsed: FkAuditUnparsed[] = []
  const creations: TableCreation[] = []
  for (const file of files) {
    const result = auditFkMigrationSource(readFileSync(join(migrationsDir, file), 'utf8'), file)
    references.push(...result.references)
    unparsed.push(...result.unparsed)
    creations.push(...result.tableCreations)
  }

  // 父表最早创建迁移（SQLite 重建分支会重复 createTable 同名表，取最早）
  const firstCreation = new Map<string, string>()
  for (const c of creations) {
    const existing = firstCreation.get(c.table)
    if (!existing || c.migration < existing) firstCreation.set(c.table, c.migration)
  }

  const forwardReferences: ForwardFkReference[] = []
  for (const fk of references) {
    const parentMigration = firstCreation.get(fk.parentTable) ?? null
    if (parentMigration && parentMigration <= fk.migration) continue // 正常后向引用
    if (!parentMigration) {
      forwardReferences.push({ ...fk, category: 'D', parentMigration: null, deferredBy: null })
      continue
    }
    if (fk.pgReachable) {
      // A：PG 可达的 forward FK —— 真实 blocker
      forwardReferences.push({ ...fk, category: 'A', parentMigration, deferredBy: null })
      continue
    }
    // C 判定：存在更晚的 PG 可达 FK 补齐同一 (childTable, childColumns, parentTable)
    const deferredBy =
      references.find(
        (other) =>
          other.pgReachable &&
          other.migration > fk.migration &&
          other.childTable === fk.childTable &&
          other.parentTable === fk.parentTable &&
          other.childColumns.join(',') === fk.childColumns.join(','),
      )?.migration ?? null
    forwardReferences.push({
      ...fk,
      category: deferredBy ? 'C' : 'B',
      parentMigration,
      deferredBy,
    })
  }

  return { references, unparsed, tableCreations: creations, forwardReferences }
}
