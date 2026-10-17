/**
 * v3-docker-compose-runtime-foundation（第九轮）—— PostgreSQL JSON indexability 静态审计。
 *
 * 背景（真实 GCP fresh PG 证据，MIGRATE_EXIT=1）：
 * 1844000000000_create_copilot_suggestion_inbox_table 声明
 *   table.unique(['organization_id', 'project_id', 'dedupe_key_json'], 'uq_csi_dedupe')
 * PG 报错：data type json has no default operator class for access method "btree"。
 * PG json 类型没有默认 btree operator class，不能参与普通 UNIQUE/B-tree 索引；
 * jsonb 自带默认 btree/hash opclass（PG ≥ 9.4）。SQLite 无 operator class 概念，
 * 全量 SQLite 迁移测试从未暴露。
 *
 * 本模块对 migrations 目录做纯静态扫描（不连数据库）：
 *   1. 收集全部 table.json(...) / table.jsonb(...) 列声明（含 raw CREATE TABLE /
 *      ADD COLUMN 中的 JSON/JSONB 列），建立 (table, column) → PG 有效类型注册表；
 *   2. 提取全部「创建型」约束：knex 表级 table.unique/index/primary、列链
 *      .unique()/.index()/.primary()、循环驱动 table.unique（字面量元组数组解析）、
 *      raw CREATE [UNIQUE] INDEX（含 USING method / WHERE 部分索引）、
 *      raw ADD CONSTRAINT UNIQUE/PRIMARY KEY/EXCLUDE；
 *   3. 凡约束列（或表达式）涉及 JSON 注册表列的，按方言守卫与 PG 有效类型分类：
 *      A. PG 必然失败 —— PG 有效类型为 json（非 jsonb）且约束为 btree UNIQUE/INDEX/
 *         PRIMARY，或 json + GIN/GiST（json 连 GIN 默认 opclass 也没有），PG 可达；
 *      B. jsonb 合法 —— 涉及列 PG 有效类型均为 jsonb（btree/GIN/GiST 均有默认
 *         opclass），PG 可达；
 *      C. intentional JSON search index —— jsonb + USING GIN/GiST（当前仓库无实例，
 *         出现时需人工确认语义后冻结）；
 *      D. SQLite-only —— 约束处于 SQLite 方言守卫内，PG 永远不会执行；
 *      E. 动态/无法静态解析 —— 记 unparsed，零容忍，由测试强制人工确认。
 *
 * 目标：A = 0 且 unparsed = 0，避免 fresh PG 在后续 JSON 索引上逐个爆。
 *
 * 解析约定：仓库为 standard（无分号）风格，语句边界按括号配平消费；注释先经
 * stripComments 剥离（长度保持，坐标可直接用于守卫区域判定）。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './pg_identifier_audit.js'
import { extractGuardRegions, isPgReachable } from './fk_dependency_audit.js'

export type JsonColumnKind = 'json' | 'jsonb'

/** JSON 列声明（knex 或 raw DDL）。 */
export interface JsonColumnDecl {
  migration: string
  table: string
  column: string
  /** knex .json( → PG json；.jsonb( → PG jsonb（SQLite 由 knex 映射回 json）。 */
  kind: JsonColumnKind
  /** 声明位置在 PG 上是否可达（SQLite-only 分支内的声明 PG 不存在该列）。 */
  pgReachable: boolean
  via: 'knex' | 'raw-create-table' | 'raw-add-column'
}

export type JsonConstraintClass = 'A' | 'B' | 'C' | 'D'

/** 涉及 JSON 列的创建型约束（唯一/索引/主键）。 */
export interface JsonConstraint {
  migration: string
  table: string
  kind: 'unique' | 'index' | 'primary'
  name: string | null
  columns: string[]
  /** columns（含表达式内引用）中命中 JSON 注册表的列。 */
  jsonColumns: string[]
  via: 'knex-table' | 'knex-chain' | 'knex-loop' | 'raw-index' | 'raw-constraint'
  /** 索引方法（raw USING；knex 恒为 btree）。 */
  usingMethod: 'btree' | 'gin' | 'gist' | 'hash' | 'brin' | null
  pgReachable: boolean
  guards: string[]
  cls: JsonConstraintClass
  reason: string
}

export interface JsonAuditUnparsed {
  migration: string
  snippet: string
  reason: string
}

export interface JsonIndexabilityReport {
  jsonColumns: JsonColumnDecl[]
  /** 仅收录涉及 JSON 列的约束（A/B/C/D）。 */
  constraints: JsonConstraint[]
  unparsed: JsonAuditUnparsed[]
  stats: {
    migrationsScanned: number
    /** 全部创建型约束扫描数（含不涉及 JSON 的）。 */
    constraintsScanned: number
    rawIndexesScanned: number
    loopConstraintsScanned: number
  }
  byClass: {
    A: JsonConstraint[]
    B: JsonConstraint[]
    C: JsonConstraint[]
    D: JsonConstraint[]
  }
}

// ---------------------------------------------------------------------------
// 基础解析工具（括号配平 / 顶层切分 / 字面量解析）
// ---------------------------------------------------------------------------

/** 括号/花括号配平：从 open 下标（开括号位置）找匹配闭括号，返回 [内容, 闭括号下标]。 */
function extractBalanced(
  source: string,
  open: number,
  openCh: '(' | '{' | '[' = '(',
  closeCh: ')' | '}' | ']' = ')',
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

/** 顶层逗号切分（忽略嵌套括号/数组/花括号与字符串内的逗号）。 */
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

/** 解析列参数（`'a'` 或 `['a','b']` 字面量）；非字面量返回 null。 */
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

/** 解析约束显式名参数：`'name'` / `{ indexName: 'name' }` / `{ keyName: 'name' }`。 */
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

// ---------------------------------------------------------------------------
// 表作用域（带源码偏移，供守卫判定）
// ---------------------------------------------------------------------------

interface TableSpanEx {
  table: string
  param: string
  body: string
  /** body 在源码中的起始下标（createTable/alterTable 回调开括号之后）。 */
  bodyStart: number
}

/** 提取 createTable/table/alterTable 回调体及其源码偏移（字面量表名或 this.tableName）。 */
function extractTableSpansEx(source: string, fileTableName: string | null): TableSpanEx[] {
  const spans: TableSpanEx[] = []
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
    spans.push({ table, param: m[3]!, body: balanced[0], bodyStart: braceOpen + 1 })
  }
  return spans
}

// ---------------------------------------------------------------------------
// 循环驱动约束解析（for (const [..] of 字面量元组数组)）
// ---------------------------------------------------------------------------

type LoopTupleElement = { kind: 'str'; value: string } | { kind: 'arr'; value: string[] }

/** 解析 `of EXPR` 指向的字面量元组数组（类属性或模块级 const）。 */
function resolveLoopLiteralArray(source: string, expr: string): LoopTupleElement[][] | null {
  const prop = expr.startsWith('this.') ? expr.slice(5) : expr
  const declPattern = new RegExp(`\\b${prop}\\s*:\\s*[^=;]+=\\s*\\[`, 'm')
  const declMatch = declPattern.exec(source)
  if (!declMatch) return null
  const bracketOpen = declMatch.index + declMatch[0].length - 1
  const balanced = extractBalanced(source, bracketOpen, '[', ']')
  if (!balanced) return null
  const inner = balanced[0]
  const tuples: LoopTupleElement[][] = []
  let pos = 0
  for (;;) {
    const openIdx = inner.indexOf('[', pos)
    if (openIdx < 0) break
    const tupleBalanced = extractBalanced(inner, openIdx, '[', ']')
    if (!tupleBalanced) return null
    const elements: LoopTupleElement[] = []
    for (const part of splitTopLevelArgs(tupleBalanced[0])) {
      const strLit = part.trim().match(/^'([^']*)'$/)
      if (strLit) {
        elements.push({ kind: 'str', value: strLit[1]! })
        continue
      }
      if (part.trim().startsWith('[')) {
        const cols = parseColumnsArg(part.trim())
        if (cols === null) return null
        elements.push({ kind: 'arr', value: cols })
        continue
      }
      return null
    }
    tuples.push(elements)
    pos = tupleBalanced[1] + 1
  }
  return tuples
}

/** 解析循环约束的列参数：`[..name]` / `[...name]` / `['a','b']` / `name`。 */
function resolveLoopColumnsArg(
  arg: string | undefined,
  destrMap: Map<string, LoopTupleElement>,
): string[] | null {
  if (!arg) return null
  const trimmed = arg.trim()
  const bare = trimmed.match(/^(\w+)$/)
  if (bare) {
    const el = destrMap.get(bare[1]!)
    return el && el.kind === 'arr' ? [...el.value] : null
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1)
    const columns: string[] = []
    for (const part of splitTopLevelArgs(inner)) {
      const p = part.trim()
      const lit = p.match(/^'([^']+)'$/)
      if (lit) {
        columns.push(lit[1]!)
        continue
      }
      const spread = p.match(/^\.\.\.(\w+)$/)
      if (spread) {
        const el = destrMap.get(spread[1]!)
        if (!el || el.kind !== 'arr') return null
        columns.push(...el.value)
        continue
      }
      const ref = p.match(/^(\w+)$/)
      if (ref) {
        const el = destrMap.get(ref[1]!)
        if (!el) return null
        if (el.kind === 'arr') columns.push(...el.value)
        else columns.push(el.value)
        continue
      }
      return null
    }
    return columns
  }
  return null
}

/** 解析循环约束的显式名参数：`'name'` / `{ indexName }` 简写 / `name` / `{ indexName: 'x' }`。 */
function resolveLoopNameArg(
  arg: string | undefined,
  destrMap: Map<string, LoopTupleElement>,
): string | null | undefined {
  if (arg === undefined || arg.trim().length === 0) return null
  const trimmed = arg.trim()
  const lit = trimmed.match(/^'([^']+)'$/)
  if (lit) return lit[1]!
  const shorthand = trimmed.match(/^\{\s*(\w+)\s*\}$/)
  if (shorthand) {
    const el = destrMap.get(shorthand[1]!)
    return el && el.kind === 'str' ? el.value : undefined
  }
  const bare = trimmed.match(/^(\w+)$/)
  if (bare) {
    const el = destrMap.get(bare[1]!)
    return el && el.kind === 'str' ? el.value : undefined
  }
  if (trimmed.startsWith('{')) {
    const m =
      trimmed.match(/\bindexName\s*:\s*'([^']+)'/) ?? trimmed.match(/\bkeyName\s*:\s*'([^']+)'/)
    return m ? m[1]! : undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 约束候选（分类前）
// ---------------------------------------------------------------------------

interface ConstraintCandidate {
  migration: string
  table: string
  kind: 'unique' | 'index' | 'primary'
  name: string | null
  columns: string[]
  /** raw 表达式原文（JSON 命中在分类阶段用注册表判定）。 */
  expressions: string[]
  via: JsonConstraint['via']
  usingMethod: JsonConstraint['usingMethod']
  /** 源码绝对下标（守卫判定用）。 */
  position: number
}

/** 从循环体中提取创建型约束（dropUnique/dropIndex 不是创建，跳过）。 */
function extractLoopConstraints(
  source: string,
  migration: string,
  push: (c: ConstraintCandidate) => void,
  unparsed: JsonAuditUnparsed[],
): number {
  let scanned = 0
  const loopPattern = /for\s*\(\s*const\s*\[([^\]]+)\]\s*of\s*(this\.\w+|\w+)(?:\([^)]*\))?\s*\)/g
  let lm: RegExpExecArray | null
  while ((lm = loopPattern.exec(source)) !== null) {
    const destrNames = lm[1]!.split(',').map((s) => s.trim())
    const expr = lm[2]!
    let bodyPos = lm.index + lm[0].length
    while (bodyPos < source.length && /\s/.test(source[bodyPos]!)) bodyPos++
    if (source[bodyPos] !== '{') continue
    const bodyBalanced = extractBalanced(source, bodyPos, '{', '}')
    if (!bodyBalanced) continue
    const loopBody = bodyBalanced[0]
    const loopBodyStart = bodyPos + 1

    // 仅当循环体内出现创建型调用时才要求元组数组可解析
    const alterPattern = /schema\.alterTable\(\s*(\w+)\s*,\s*\(\s*(\w+)\s*\)\s*=>\s*\{/g
    const alterMatches: RegExpExecArray[] = []
    let am: RegExpExecArray | null
    while ((am = alterPattern.exec(loopBody)) !== null) alterMatches.push(am)
    const hasCreation = alterMatches.some((m) => {
      const param = m[2]!
      const cbBrace = loopBody.indexOf('{', m.index + m[0].length - 1)
      const cbBalanced = extractBalanced(loopBody, cbBrace, '{', '}')
      if (!cbBalanced) return false
      return new RegExp(`${param}\\.(unique|index|primary)\\s*\\(`).test(cbBalanced[0])
    })
    if (!hasCreation) continue

    const tuples = resolveLoopLiteralArray(source, expr)
    if (!tuples) {
      unparsed.push({
        migration,
        snippet: source.slice(lm.index, lm.index + 80),
        reason: 'loop-expr-unresolved',
      })
      continue
    }

    for (const alter of alterMatches) {
      const tableVar = alter[1]!
      const param = alter[2]!
      const cbBrace = loopBody.indexOf('{', alter.index + alter[0].length - 1)
      const cbBalanced = extractBalanced(loopBody, cbBrace, '{', '}')
      if (!cbBalanced) continue
      const cbBody = cbBalanced[0]
      const cbStart = loopBodyStart + cbBrace + 1

      const callPattern = new RegExp(`${param}\\.(unique|index|primary)\\s*\\(`, 'g')
      let cm: RegExpExecArray | null
      while ((cm = callPattern.exec(cbBody)) !== null) {
        const kind = cm[1]! as 'unique' | 'index' | 'primary'
        const openParen = cbBody.indexOf('(', cm.index + cm[0].length - 1)
        const argsBalanced = extractBalanced(cbBody, openParen)
        const callPos = cbStart + cm.index
        if (!argsBalanced) {
          unparsed.push({
            migration,
            snippet: cbBody.slice(cm.index, cm.index + 60),
            reason: 'unbalanced',
          })
          continue
        }
        const args = splitTopLevelArgs(argsBalanced[0])
        for (const tuple of tuples) {
          const destrMap = new Map<string, LoopTupleElement>()
          destrNames.forEach((name, i) => {
            const el = tuple[i]
            if (el) destrMap.set(name, el)
          })
          const tableEl = destrMap.get(tableVar)
          if (!tableEl || tableEl.kind !== 'str') {
            unparsed.push({
              migration,
              snippet: `alterTable(${tableVar}, ...) of ${expr}`,
              reason: 'loop-table-not-literal',
            })
            continue
          }
          const columns = resolveLoopColumnsArg(args[0], destrMap)
          if (columns === null) {
            unparsed.push({
              migration,
              snippet: `${param}.${kind}(${(args[0] ?? '').slice(0, 60)}...)`,
              reason: 'loop-columns-unresolved',
            })
            continue
          }
          const name = resolveLoopNameArg(args[1], destrMap)
          if (name === undefined) {
            unparsed.push({
              migration,
              snippet: `${param}.${kind}(..., ${(args[1] ?? '').slice(0, 60)})`,
              reason: 'loop-name-unresolved',
            })
            continue
          }
          scanned++
          push({
            migration,
            table: tableEl.value,
            kind,
            name,
            columns,
            expressions: [],
            via: 'knex-loop',
            usingMethod: null,
            position: callPos,
          })
        }
      }
    }
  }
  return scanned
}

// ---------------------------------------------------------------------------
// raw DDL 解析
// ---------------------------------------------------------------------------

/** raw CREATE [UNIQUE] INDEX 语句解析结果。 */
interface RawIndexParse {
  unique: boolean
  name: string
  table: string | null
  tableDynamic: boolean
  usingMethod: 'btree' | 'gin' | 'gist' | 'hash' | 'brin' | null
  columns: string[]
  expressions: string[]
}

/** 解析 raw CREATE INDEX 语句（从 CREATE 关键字起的单条语句），失败返回 null。 */
function parseRawCreateIndex(stmt: string, fileTableName: string | null): RawIndexParse | null {
  const head = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(stmt)
  if (!head) return null
  const unique = Boolean(head[1])
  let rest = stmt.slice(head[0].length)
  rest = rest.replace(/^\s*CONCURRENTLY\s+/i, '')
  const nameMatch = /^[`"]?(\w+)[`"]?\s+/.exec(rest)
  if (!nameMatch) return null
  const name = nameMatch[1]!
  rest = rest.slice(nameMatch[0].length)
  const onMatch = /^ON\s+/i.exec(rest)
  if (!onMatch) return null
  rest = rest.slice(onMatch[0].length)
  let table: string | null = null
  let tableDynamic = false
  const dynTable = /^\$\{this\.tableName\}\s*/.exec(rest)
  if (dynTable) {
    table = fileTableName
    rest = rest.slice(dynTable[0].length)
  } else {
    const tableMatch = /^[`"]?([\w.]+)[`"]?\s*/.exec(rest)
    if (!tableMatch) {
      if (rest.startsWith('${')) tableDynamic = true
      else return null
    } else {
      const raw = tableMatch[1]!
      table = raw.includes('.') ? (raw.split('.').pop() ?? raw) : raw
      table = table.toLowerCase()
      rest = rest.slice(tableMatch[0].length)
    }
  }
  let usingMethod: RawIndexParse['usingMethod'] = null
  const usingMatch = /^USING\s+(\w+)\s*/i.exec(rest)
  if (usingMatch) {
    const method = usingMatch[1]!.toLowerCase()
    usingMethod =
      method === 'gin' || method === 'gist' || method === 'hash' || method === 'brin'
        ? method
        : 'btree'
    rest = rest.slice(usingMatch[0].length)
  }
  if (!rest.startsWith('(')) return null
  const balanced = extractBalanced(rest, 0)
  if (!balanced) return null
  const columns: string[] = []
  const expressions: string[] = []
  for (const part of splitTopLevelArgs(balanced[0])) {
    const el = part.trim()
    const plain = el.match(/^[`"]?(\w+)[`"]?$/)
    if (plain) {
      columns.push(plain[1]!)
      continue
    }
    const suffixed = el.match(
      /^[`"]?(\w+)[`"]?\s+(ASC|DESC|NULLS\s+FIRST|NULLS\s+LAST|\w+_ops)(\s+(ASC|DESC|NULLS\s+FIRST|NULLS\s+LAST|\w+_ops))*$/i,
    )
    if (suffixed) {
      columns.push(suffixed[1]!)
      continue
    }
    expressions.push(el)
  }
  return { unique, name, table, tableDynamic, usingMethod, columns, expressions }
}

/** raw CREATE TABLE 中的 JSON/JSONB 列登记。 */
function extractRawCreateTableJsonColumns(
  source: string,
  migration: string,
  fileTableName: string | null,
  regions: ReturnType<typeof extractGuardRegions>,
  columns: JsonColumnDecl[],
): void {
  const pattern =
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?|\$\{this\.tableName\})\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = pattern.exec(source)) !== null) {
    let table: string | null
    if (m[1] === '${this.tableName}') {
      table = fileTableName
    } else {
      const raw = m[1]!.replace(/^"|"$/g, '')
      table = (raw.includes('.') ? (raw.split('.').pop() ?? raw) : raw).toLowerCase()
    }
    if (!table) continue
    const openParen = source.indexOf('(', m.index + m[0].length - 1)
    const balanced = extractBalanced(source, openParen)
    if (!balanced) continue
    for (const def of splitTopLevelArgs(balanced[0])) {
      const colMatch = def.match(/^\s*"?(\w+)"?\s+([\s\S]*)$/)
      if (!colMatch) continue
      const rest = colMatch[2]!
      let kind: JsonColumnKind | null = null
      if (/\bJSONB\b/i.test(rest)) kind = 'jsonb'
      else if (/\bJSON\b/i.test(rest)) kind = 'json'
      if (!kind) continue
      const reach = isPgReachable(regions, m.index)
      columns.push({
        migration,
        table,
        column: colMatch[1]!,
        kind,
        pgReachable: reach.pgReachable,
        via: 'raw-create-table',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// 单文件审计
// ---------------------------------------------------------------------------

interface FileAudit {
  jsonColumns: JsonColumnDecl[]
  candidates: ConstraintCandidate[]
  unparsed: JsonAuditUnparsed[]
  stats: { constraintsScanned: number; rawIndexesScanned: number; loopConstraintsScanned: number }
}

/** 扫描单个迁移文件：JSON 列声明 + 全部创建型约束候选。 */
export function auditJsonMigrationSource(source: string, migration: string): FileAudit {
  const cleanSource = stripComments(source)
  const regions = extractGuardRegions(cleanSource)
  const fileTableName = cleanSource.match(/protected\s+tableName\s*=\s*'([^']+)'/)?.[1] ?? null
  const spans = extractTableSpansEx(cleanSource, fileTableName)
  const jsonColumns: JsonColumnDecl[] = []
  const candidates: ConstraintCandidate[] = []
  const unparsed: JsonAuditUnparsed[] = []
  let constraintsScanned = 0
  let rawIndexesScanned = 0
  let loopConstraintsScanned = 0

  // ── 1. knex JSON 列声明 + 列链约束 ──
  for (const span of spans) {
    const declPattern = new RegExp(`${span.param}\\s*\\.\\s*(json|jsonb)\\s*\\(\\s*'([^']+)'`, 'g')
    let dm: RegExpExecArray | null
    while ((dm = declPattern.exec(span.body)) !== null) {
      const kind = dm[1] as JsonColumnKind
      const column = dm[2]!
      const pos = span.bodyStart + dm.index
      const reach = isPgReachable(regions, pos)
      jsonColumns.push({
        migration,
        table: span.table,
        column,
        kind,
        pgReachable: reach.pgReachable,
        via: 'knex',
      })

      // 列链：声明后跟随的 .unique()/.index()/.primary()
      // 先消费 json/jsonb 调用自身的闭括号，再从其后消费链式段
      const declOpen = pos + dm[0].indexOf('(')
      const declBalanced = extractBalanced(cleanSource, declOpen)
      if (!declBalanced) continue
      let chainPos = declBalanced[1] + 1
      for (;;) {
        const seg = /^\s*\.\s*(\w+)\s*\(/.exec(cleanSource.slice(chainPos))
        if (!seg) break
        const openParen = chainPos + seg[0].length - 1
        const balanced = extractBalanced(cleanSource, openParen)
        if (!balanced) break
        const method = seg[1]!
        if (method === 'unique' || method === 'index' || method === 'primary') {
          const chainName = parseExplicitName(balanced[0].trim() || undefined)
          if (chainName === undefined) {
            // 显式名存在但无法静态解析：零容忍，不得默认当 auto-name 吞掉
            unparsed.push({
              migration,
              snippet: `${span.param}.${kind}(${balanced[0].slice(0, 60)}) chained on ${column}`,
              reason: 'chain-name-not-literal',
            })
            chainPos = balanced[1] + 1
            continue
          }
          constraintsScanned++
          candidates.push({
            migration,
            table: span.table,
            kind: method,
            name: chainName,
            columns: [column],
            expressions: [],
            via: 'knex-chain',
            usingMethod: null,
            position: chainPos,
          })
        }
        chainPos = balanced[1] + 1
      }
    }
  }

  // ── 2. knex 表级 table.unique/index/primary ──
  for (const span of spans) {
    const stmtPattern = new RegExp(`${span.param}\\s*\\.\\s*(unique|index|primary)\\s*\\(`, 'g')
    let m: RegExpExecArray | null
    while ((m = stmtPattern.exec(span.body)) !== null) {
      const kind = m[1]! as 'unique' | 'index' | 'primary'
      const openParen = span.body.indexOf('(', m.index + m[0].length - 1)
      const balanced = extractBalanced(span.body, openParen)
      if (!balanced) {
        unparsed.push({
          migration,
          snippet: span.body.slice(m.index, m.index + 60),
          reason: 'unbalanced',
        })
        continue
      }
      const args = splitTopLevelArgs(balanced[0])
      const columns = parseColumnsArg(args[0])
      if (columns === null) {
        unparsed.push({
          migration,
          snippet: `${span.param}.${kind}(${(args[0] ?? '').slice(0, 60)}...)`,
          reason: 'columns-not-literal',
        })
        continue
      }
      const name = parseExplicitName(args[1])
      if (name === undefined) {
        unparsed.push({
          migration,
          snippet: `${span.param}.${kind}(..., ${(args[1] ?? '').slice(0, 60)})`,
          reason: 'name-not-literal',
        })
        continue
      }
      constraintsScanned++
      candidates.push({
        migration,
        table: span.table,
        kind,
        name,
        columns,
        expressions: [],
        via: 'knex-table',
        usingMethod: null,
        position: span.bodyStart + m.index,
      })
    }
  }

  // ── 3. 循环驱动约束（字面量元组数组）──
  loopConstraintsScanned += extractLoopConstraints(
    cleanSource,
    migration,
    (c) => {
      candidates.push(c)
    },
    unparsed,
  )
  constraintsScanned += loopConstraintsScanned

  // ── 4. raw CREATE TABLE / ADD COLUMN 的 JSON 列登记 ──
  extractRawCreateTableJsonColumns(cleanSource, migration, fileTableName, regions, jsonColumns)
  // 仅匹配类型字面量为 JSON/JSONB 的 ADD COLUMN；仓库 raw SQL 不带分号，
  // 宽字符捕获会越过字符串边界吞掉后续语句（曾把 VARCHAR(255) 误记为 JSON）。
  const addColumnPattern =
    /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+(JSONB?)\b/gi
  let acm: RegExpExecArray | null
  while ((acm = addColumnPattern.exec(cleanSource)) !== null) {
    const kind = acm[3]!.toUpperCase() === 'JSONB' ? 'jsonb' : 'json'
    const rawTable = acm[1]!.replace(/^"|"$/g, '')
    const table = (
      rawTable.includes('.') ? (rawTable.split('.').pop() ?? rawTable) : rawTable
    ).toLowerCase()
    const reach = isPgReachable(regions, acm.index)
    jsonColumns.push({
      migration,
      table,
      column: acm[2]!,
      kind,
      pgReachable: reach.pgReachable,
      via: 'raw-add-column',
    })
  }

  // ── 5. raw CREATE [UNIQUE] INDEX ──
  const rawIndexPattern = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+/gi
  let rm: RegExpExecArray | null
  while ((rm = rawIndexPattern.exec(cleanSource)) !== null) {
    // 语句可跨多行（模板字符串/raw 多行 SQL）：取宽窗口，parseRawCreateIndex
    // 在列清单闭括号后自然停止；WHERE 等后缀不影响解析。
    const stmt = cleanSource.slice(rm.index, Math.min(rm.index + 2000, cleanSource.length))
    const parsed = parseRawCreateIndex(stmt, fileTableName)
    if (!parsed) {
      unparsed.push({ migration, snippet: stmt.slice(0, 80), reason: 'raw-index-unparsed' })
      continue
    }
    if (parsed.tableDynamic || !parsed.table) {
      unparsed.push({ migration, snippet: stmt.slice(0, 80), reason: 'raw-table-dynamic' })
      continue
    }
    rawIndexesScanned++
    candidates.push({
      migration,
      table: parsed.table,
      kind: parsed.unique ? 'unique' : 'index',
      name: parsed.name,
      columns: parsed.columns,
      expressions: parsed.expressions,
      via: 'raw-index',
      usingMethod: parsed.usingMethod,
      position: rm.index,
    })
  }

  // ── 6. raw ADD CONSTRAINT UNIQUE / PRIMARY KEY / EXCLUDE ──
  const rawConstraintPattern =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)\s+ADD\s+CONSTRAINT\s+"?(\w+)"?\s+(UNIQUE|PRIMARY\s+KEY|EXCLUDE)\b/gi
  let rc: RegExpExecArray | null
  while ((rc = rawConstraintPattern.exec(cleanSource)) !== null) {
    const rawTable = rc[1]!.replace(/^"|"$/g, '')
    const table = (
      rawTable.includes('.') ? (rawTable.split('.').pop() ?? rawTable) : rawTable
    ).toLowerCase()
    const name = rc[2]!
    const ckind = rc[3]!.toUpperCase()
    let p = rc.index + rc[0].length
    while (p < cleanSource.length && /\s/.test(cleanSource[p]!)) p++
    if (ckind === 'EXCLUDE') {
      if (cleanSource[p] !== '(') {
        unparsed.push({
          migration,
          snippet: cleanSource.slice(rc.index, rc.index + 80),
          reason: 'raw-exclude-unparsed',
        })
        continue
      }
      const balanced = extractBalanced(cleanSource, p)
      if (!balanced) {
        unparsed.push({
          migration,
          snippet: cleanSource.slice(rc.index, rc.index + 80),
          reason: 'unbalanced',
        })
        continue
      }
      const cols: string[] = []
      for (const part of splitTopLevelArgs(balanced[0])) {
        const colMatch = part.trim().match(/^"?(\w+)"?\s+WITH\s+/i)
        if (!colMatch) {
          unparsed.push({
            migration,
            snippet: part.slice(0, 60),
            reason: 'raw-exclude-element-unparsed',
          })
          continue
        }
        cols.push(colMatch[1]!)
      }
      constraintsScanned++
      // EXCLUDE 需要 GiST/SP-GiST opclass：json 无、jsonb 亦无默认 GiST 相等 opclass
      candidates.push({
        migration,
        table,
        kind: 'unique',
        name,
        columns: cols,
        expressions: [],
        via: 'raw-constraint',
        usingMethod: 'gist',
        position: rc.index,
      })
      continue
    }
    const usingMatch = /^USING\s+(\w+)\s*/i.exec(cleanSource.slice(p))
    if (usingMatch) p += usingMatch[0].length
    if (cleanSource[p] !== '(') {
      unparsed.push({
        migration,
        snippet: cleanSource.slice(rc.index, rc.index + 80),
        reason: 'raw-constraint-unparsed',
      })
      continue
    }
    const balanced = extractBalanced(cleanSource, p)
    if (!balanced) {
      unparsed.push({
        migration,
        snippet: cleanSource.slice(rc.index, rc.index + 80),
        reason: 'unbalanced',
      })
      continue
    }
    const cols: string[] = []
    let elementFailed = false
    for (const part of splitTopLevelArgs(balanced[0])) {
      const colMatch = part.trim().match(/^"?(\w+)"?$/)
      if (!colMatch) {
        unparsed.push({
          migration,
          snippet: part.slice(0, 60),
          reason: 'raw-constraint-element-unparsed',
        })
        elementFailed = true
        break
      }
      cols.push(colMatch[1]!)
    }
    if (elementFailed) continue
    constraintsScanned++
    candidates.push({
      migration,
      table,
      kind: ckind === 'UNIQUE' ? 'unique' : 'primary',
      name,
      columns: cols,
      expressions: [],
      via: 'raw-constraint',
      usingMethod: null,
      position: rc.index,
    })
  }

  return {
    jsonColumns,
    candidates,
    unparsed,
    stats: { constraintsScanned, rawIndexesScanned, loopConstraintsScanned },
  }
}

// ---------------------------------------------------------------------------
// 分类
// ---------------------------------------------------------------------------

/** (table, column) → PG 有效 JSON 类型；非 JSON 列返回 null。 */
function resolvePgJsonKind(
  registry: Map<string, JsonColumnDecl[]>,
  table: string,
  column: string,
): { kind: JsonColumnKind; declaredOnPg: boolean } | null {
  const entries = registry.get(`${table}::${column}`)
  if (!entries || entries.length === 0) return null
  const pgDecls = entries.filter((e) => e.pgReachable)
  if (pgDecls.length === 0) {
    return { kind: entries[entries.length - 1]!.kind, declaredOnPg: false }
  }
  const sorted = [...pgDecls].sort((a, b) => a.migration.localeCompare(b.migration))
  return { kind: sorted[sorted.length - 1]!.kind, declaredOnPg: true }
}

/** 全仓审计：两遍扫描（先建 JSON 列注册表，再分类约束）。 */
export function auditJsonIndexability(migrationsDir: string): JsonIndexabilityReport {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.ts'))
    .sort()
  const fileAudits: Array<{ audit: FileAudit; regions: ReturnType<typeof extractGuardRegions> }> =
    []
  const allJsonColumns: JsonColumnDecl[] = []
  const allUnparsed: JsonAuditUnparsed[] = []
  const stats = {
    migrationsScanned: 0,
    constraintsScanned: 0,
    rawIndexesScanned: 0,
    loopConstraintsScanned: 0,
  }

  // 第一遍：逐文件提取 + JSON 列注册表
  for (const file of files) {
    const source = readFileSync(join(migrationsDir, file), 'utf8')
    const audit = auditJsonMigrationSource(source, file)
    const regions = extractGuardRegions(stripComments(source))
    fileAudits.push({ audit, regions })
    allJsonColumns.push(...audit.jsonColumns)
    allUnparsed.push(...audit.unparsed)
    stats.migrationsScanned++
    stats.constraintsScanned += audit.stats.constraintsScanned
    stats.rawIndexesScanned += audit.stats.rawIndexesScanned
    stats.loopConstraintsScanned += audit.stats.loopConstraintsScanned
  }

  const registry = new Map<string, JsonColumnDecl[]>()
  for (const decl of allJsonColumns) {
    const key = `${decl.table}::${decl.column}`
    const list = registry.get(key) ?? []
    list.push(decl)
    registry.set(key, list)
  }

  // 第二遍：分类（仅收录涉及 JSON 列的约束）
  // up/down 会重复声明同一约束（如 1797000000000 PG 分支 up + down 重建），
  // 二者不会同时落库，按 (migration, table, kind, name, columns) 去重保留首次。
  const constraints: JsonConstraint[] = []
  const seenConstraints = new Set<string>()
  for (const { audit, regions } of fileAudits) {
    for (const candidate of audit.candidates) {
      const jsonColumns = new Set<string>()
      const undeclaredOnPg: string[] = []
      for (const col of candidate.columns) {
        const resolved = resolvePgJsonKind(registry, candidate.table, col)
        if (resolved) {
          jsonColumns.add(col)
          if (!resolved.declaredOnPg) undeclaredOnPg.push(col)
        }
      }
      for (const expr of candidate.expressions) {
        for (const decl of allJsonColumns.filter((d) => d.table === candidate.table)) {
          if (new RegExp(`\\b${decl.column}\\b`).test(expr)) jsonColumns.add(decl.column)
        }
      }
      if (jsonColumns.size === 0) continue

      const reach = isPgReachable(regions, candidate.position)
      if (undeclaredOnPg.length > 0 && reach.pgReachable) {
        allUnparsed.push({
          migration: candidate.migration,
          snippet: `${candidate.table}(${undeclaredOnPg.join(',')})`,
          reason: 'json-column-not-declared-on-pg',
        })
        continue
      }
      const involved = [...jsonColumns].map((col) => ({
        column: col,
        resolved: resolvePgJsonKind(registry, candidate.table, col)!,
      }))
      const anyJson = involved.some((e) => e.resolved.kind === 'json')
      const method = candidate.usingMethod ?? 'btree'
      let cls: JsonConstraintClass
      let reason: string
      if (method === 'gin' || method === 'gist') {
        if (anyJson) {
          cls = reach.pgReachable ? 'A' : 'D'
          reason = `PG json 无默认 ${method.toUpperCase()} operator class，该索引在 PG 必然失败`
        } else {
          cls = reach.pgReachable ? 'C' : 'D'
          reason = `jsonb + ${method.toUpperCase()}：intentional JSON search index（需人工冻结）`
        }
      } else if (anyJson) {
        cls = reach.pgReachable ? 'A' : 'D'
        reason = 'PG json 无默认 btree operator class，UNIQUE/INDEX/PRIMARY 必然失败'
      } else {
        cls = reach.pgReachable ? 'B' : 'D'
        reason = '涉及列 PG 有效类型均为 jsonb，默认 btree/hash opclass 合法'
      }
      const dedupeKey = `${candidate.migration}|${candidate.table}|${candidate.kind}|${candidate.name ?? ''}|${candidate.columns.join(',')}`
      if (seenConstraints.has(dedupeKey)) continue
      seenConstraints.add(dedupeKey)
      constraints.push({
        migration: candidate.migration,
        table: candidate.table,
        kind: candidate.kind,
        name: candidate.name,
        columns: candidate.columns,
        jsonColumns: [...jsonColumns].sort(),
        via: candidate.via,
        usingMethod: candidate.usingMethod,
        pgReachable: reach.pgReachable,
        guards: reach.guards,
        cls,
        reason,
      })
    }
  }

  return {
    jsonColumns: allJsonColumns,
    constraints,
    unparsed: allUnparsed,
    stats,
    byClass: {
      A: constraints.filter((c) => c.cls === 'A'),
      B: constraints.filter((c) => c.cls === 'B'),
      C: constraints.filter((c) => c.cls === 'C'),
      D: constraints.filter((c) => c.cls === 'D'),
    },
  }
}
