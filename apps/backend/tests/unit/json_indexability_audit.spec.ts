import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  auditJsonIndexability,
  auditJsonMigrationSource,
} from './helpers/json_indexability_audit.js'
import { stripComments } from './helpers/pg_identifier_audit.js'

/**
 * v3-docker-compose-runtime-foundation（第九轮）—— PostgreSQL JSON indexability 回归门禁。
 *
 * 真实证据：fresh GCP PG 在 1844000000000 exit 1——
 *   alter table "copilot_suggestion_inbox" add constraint "uq_csi_dedupe"
 *   unique ("organization_id", "project_id", "dedupe_key_json")
 *   error: data type json has no default operator class for access method "btree"
 * PG json 无默认 btree operator class；SQLite 无此概念，全量 SQLite 迁移测试从未暴露。
 *
 * 修复（dialect-aware 类型裁决，非机械改型）：
 * - dedupe_key_json 语义 = InboxDedupeKey { problemKind, declaredKey }，仅两个字符串
 *   标量字段；项目已有 canonical 序列化 serializeInboxDedupeKey =
 *   `${problemKind}::${declaredKey}`，注释明示「用于 map key 或 DB 唯一约束」，
 *   服务端去重恒用该规范串（inbox_aggregator / trigger_rule_evaluator）。
 * - jsonb 结构相等 ⟺ 两字段字符串相等 ⟺ 规范串相等（无数组/数字/嵌套，jsonb
 *   规范化不影响该形状的相等语义）；PG jsonb 自带默认 btree/hash opclass。
 * - 184400 从未在任何 PG 成功执行（fresh PG 本轮首次到达即失败），SQLite 由 knex
 *   原生映射 jsonb→json（sqlite-columncompiler），DDL 逐字节不变，无历史破坏。
 * - source_refs_json（InboxSourceRef[] payload，无任何按内容过滤查询）同理纳入
 *   idx_csi_org_proj_source，同轮修复避免下一轮 fresh PG 再爆。
 *
 * 本 spec 锁定：
 *   1. 修复契约：184400 两列 jsonb、约束签名原样、无 raw DDL/GIN/opclass/text cast/
 *      临时 hash 列/IF NOT EXISTS；
 *   2. 语义契约：InboxDedupeKey 形状与 canonical 序列化、model prepare/consume 不变；
 *   3. 全仓审计：A（PG 必然失败）= 0、unparsed = 0、C/D = 0，B 冻结为修复后的
 *      两项（双向比对防 stale）；
 *   4. 解析器自身：knex 表级/列链/循环元组/raw 多行语句/方言守卫全形态覆盖。
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../database/migrations/', import.meta.url))
const MIGRATION_184400 = '1844000000000_create_copilot_suggestion_inbox_table.ts'
const TYPES_FILE = fileURLToPath(
  new URL('../../../../packages/types/src/copilot-suggestion-inbox.ts', import.meta.url),
)
const MODEL_FILE = fileURLToPath(
  new URL('../../app/models/copilot_suggestion_inbox.ts', import.meta.url),
)

/** 修复后 PG 合法（B 类）约束冻结清单——新增任何 JSON 约束立即失败，需人工核实语义后更新。 */
const KNOWN_PG_JSONB_CONSTRAINTS = [
  {
    migration: MIGRATION_184400,
    table: 'copilot_suggestion_inbox',
    kind: 'unique',
    name: 'uq_csi_dedupe',
    jsonColumns: ['dedupe_key_json'],
  },
  {
    migration: MIGRATION_184400,
    table: 'copilot_suggestion_inbox',
    kind: 'index',
    name: 'idx_csi_org_proj_source',
    jsonColumns: ['source_refs_json'],
  },
]

/** 在临时目录上跑全量分类（合成迁移集）。 */
function auditSources(sources: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'json-idx-audit-'))
  try {
    for (const [name, content] of Object.entries(sources)) {
      writeFileSync(join(dir, name), content, 'utf8')
    }
    return auditJsonIndexability(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('json_indexability_audit 解析器', () => {
  it('提取表级字面量 unique/index/primary（含显式名与多行数组）', () => {
    const source = `
import { BaseSchema } from '@adonisjs/lucid/schema'
export default class extends BaseSchema {
  protected tableName = 't1'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.json('meta').notNullable()
      table.jsonb('payload').notNullable()
      table.unique(['org_id', 'meta'], 'uq_t1_meta')
      table.index(
        ['org_id', 'payload'],
        'idx_t1_payload',
      )
      table.primary(['a', 'b'], { keyName: 'pk_t1' })
    })
  }
}
`
    const audit = auditJsonMigrationSource(source, 'x.ts')
    expect(audit.unparsed).toEqual([])
    const knexTable = audit.candidates.filter((c) => c.via === 'knex-table')
    expect(knexTable).toHaveLength(3)
    expect(knexTable[0]).toMatchObject({
      table: 't1',
      kind: 'unique',
      name: 'uq_t1_meta',
      columns: ['org_id', 'meta'],
    })
    expect(knexTable[1]).toMatchObject({ kind: 'index', name: 'idx_t1_payload' })
    expect(knexTable[2]).toMatchObject({ kind: 'primary', name: 'pk_t1' })
    expect(audit.jsonColumns.map((c) => `${c.column}:${c.kind}`)).toEqual([
      'meta:json',
      'payload:jsonb',
    ])
  })

  it('提取列链 .json().unique() / .index()（via=knex-chain）', () => {
    const source = `
export default class {
  protected tableName = 't2'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table
        .json('settings')
        .notNullable()
        .unique('uq_t2_settings')
      table.jsonb('doc').index()
    })
  }
}
`
    const audit = auditJsonMigrationSource(source, 'x.ts')
    expect(audit.unparsed).toEqual([])
    const chains = audit.candidates.filter((c) => c.via === 'knex-chain')
    expect(chains).toHaveLength(2)
    expect(chains[0]).toMatchObject({
      kind: 'unique',
      name: 'uq_t2_settings',
      columns: ['settings'],
    })
    expect(chains[1]).toMatchObject({ kind: 'index', name: null, columns: ['doc'] })
  })

  it('列链显式名非字面量时记 unparsed（不得默认当 auto-name 吞掉）', () => {
    const source = `
export default class {
  protected tableName = 't3'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.json('meta').unique(buildName())
    })
  }
}
`
    const audit = auditJsonMigrationSource(source, 'x.ts')
    expect(audit.unparsed).toHaveLength(1)
    expect(audit.unparsed[0]!.reason).toBe('chain-name-not-literal')
  })

  it('解析跨多行 raw CREATE UNIQUE INDEX（含 WHERE 部分索引）', () => {
    const source = `
export default class {
  async up() {
    this.schema.raw(\`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_t4_idem
      ON t4 (organization_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
    \`)
  }
}
`
    const audit = auditJsonMigrationSource(source, 'x.ts')
    expect(audit.unparsed).toEqual([])
    const raw = audit.candidates.filter((c) => c.via === 'raw-index')
    expect(raw).toHaveLength(1)
    expect(raw[0]).toMatchObject({
      table: 't4',
      kind: 'unique',
      name: 'idx_t4_idem',
      columns: ['organization_id', 'idempotency_key'],
    })
  })

  it('识别 raw index USING GIN 方法', () => {
    const source = `
export default class {
  async up() {
    this.schema.raw('CREATE INDEX idx_t5_doc ON t5 USING gin (doc jsonb_path_ops)')
  }
}
`
    const audit = auditJsonMigrationSource(source, 'x.ts')
    expect(audit.unparsed).toEqual([])
    expect(audit.candidates[0]).toMatchObject({ usingMethod: 'gin', columns: ['doc'] })
  })

  it('raw ADD COLUMN 类型仅以 JSON/JSONB 字面量登记（无分号 raw SQL 不越界）', () => {
    // 回归：1797000000000 形态——VARCHAR ADD COLUMN 后无分号，
    // 后续 raw CREATE TABLE 内含 JSON 列；idempotency_key 不得误判为 JSON。
    const source = `
export default class {
  async up() {
    await this.db.rawQuery(\`
      ALTER TABLE compiler_runs
      ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255)
    \`)
    this.schema.raw(\`
      CREATE TABLE compiler_runs_tmp (
        id INTEGER PRIMARY KEY,
        input JSON NOT NULL,
        idempotency_key VARCHAR(255)
      )
    \`)
    await this.db.rawQuery(\`
      ALTER TABLE logs ADD COLUMN payload JSONB
    \`)
  }
}
`
    const audit = auditJsonMigrationSource(source, 'x.ts')
    const keys = audit.jsonColumns.map((c) => `${c.table}.${c.column}:${c.kind}`).sort()
    expect(keys).toEqual(['compiler_runs_tmp.input:json', 'logs.payload:jsonb'])
  })

  it('解析类属性元组循环驱动 table.unique（1890000000000 形态）', () => {
    const source = `
export default class {
  private readonly additions: ReadonlyArray<readonly [string, readonly string[], string]> = [
    ['copilot_sessions', ['organization_id', 'session_id'], 'uq_cs_org_session'],
    [
      'ai_trace_spans',
      ['organization_id', 'span_id'],
      'uq_ats_org_span',
    ],
  ]
  async up() {
    for (const [tableName, columns, indexName] of this.additions) {
      this.schema.alterTable(tableName, (table) => {
        table.unique([...columns], { indexName })
      })
    }
  }
}
`
    const audit = auditJsonMigrationSource(source, 'x.ts')
    expect(audit.unparsed).toEqual([])
    const loops = audit.candidates.filter((c) => c.via === 'knex-loop')
    expect(loops).toHaveLength(2)
    expect(loops[0]).toMatchObject({
      table: 'copilot_sessions',
      kind: 'unique',
      name: 'uq_cs_org_session',
      columns: ['organization_id', 'session_id'],
    })
    expect(loops[1]).toMatchObject({ table: 'ai_trace_spans', name: 'uq_ats_org_span' })
  })

  it('解析模块级 const 元组循环（1839300000002 形态），dropUnique 不算创建', () => {
    const source = `
const REWRITES: ReadonlyArray<[string, string, string[], string, string[]]> = [
  [
    'kms_rewrap_jobs',
    'kms_rewrap_jobs_idempotency_key_unique',
    ['idempotency_key'],
    'uq_kms_rewrap_org_idem',
    ['organization_id', 'idempotency_key'],
  ],
]
export default class {
  async up() {
    for (const [table, oldName, oldColumns, newName, newColumns] of REWRITES) {
      this.schema.alterTable(table, (t) => {
        t.dropUnique(oldColumns, oldName)
      })
      this.schema.alterTable(table, (t) => {
        t.unique(newColumns, newName)
      })
    }
  }
}
`
    const audit = auditJsonMigrationSource(source, 'x.ts')
    expect(audit.unparsed).toEqual([])
    const loops = audit.candidates.filter((c) => c.via === 'knex-loop')
    expect(loops).toHaveLength(1)
    expect(loops[0]).toMatchObject({
      table: 'kms_rewrap_jobs',
      kind: 'unique',
      name: 'uq_kms_rewrap_org_idem',
      columns: ['organization_id', 'idempotency_key'],
    })
  })

  it('循环 expr 不可解析时记 unparsed（loop-expr-unresolved）', () => {
    const source = `
export default class {
  async up() {
    for (const [tableName, columns, indexName] of this.loadFromSomewhere()) {
      this.schema.alterTable(tableName, (table) => {
        table.unique([...columns], { indexName })
      })
    }
  }
}
`
    const audit = auditJsonMigrationSource(source, 'x.ts')
    expect(audit.unparsed.some((u) => u.reason === 'loop-expr-unresolved')).toBe(true)
  })

  it('表级 columns 非字面量时记 unparsed（columns-not-literal）', () => {
    const source = `
export default class {
  protected tableName = 't9'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.unique(dynamicColumns(), 'uq_t9_x')
    })
  }
}
`
    const audit = auditJsonMigrationSource(source, 'x.ts')
    expect(audit.unparsed.some((u) => u.reason === 'columns-not-literal')).toBe(true)
  })
})

describe('json_indexability_audit 分类', () => {
  it('PG 可达的 json（非 jsonb）UNIQUE → A（PG 必然失败）', () => {
    const report = auditSources({
      '1000000000001_a.ts': `
export default class {
  protected tableName = 'ta'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.json('meta').notNullable()
      table.unique(['org_id', 'meta'], 'uq_ta_meta')
    })
  }
}
`,
    })
    expect(report.unparsed).toEqual([])
    expect(report.byClass.A).toHaveLength(1)
    expect(report.byClass.A[0]).toMatchObject({ table: 'ta', name: 'uq_ta_meta', cls: 'A' })
  })

  it('PG 可达的 jsonb UNIQUE/INDEX → B（jsonb 合法）', () => {
    const report = auditSources({
      '1000000000001_b.ts': `
export default class {
  protected tableName = 'tb'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.jsonb('dedupe_key_json').notNullable()
      table.unique(['org_id', 'dedupe_key_json'], 'uq_tb_dedupe')
    })
  }
}
`,
    })
    expect(report.unparsed).toEqual([])
    expect(report.byClass.A).toEqual([])
    expect(report.byClass.B).toHaveLength(1)
    expect(report.byClass.B[0]).toMatchObject({ name: 'uq_tb_dedupe', cls: 'B', pgReachable: true })
  })

  it('SQLite-only 守卫内的 raw JSON 索引 → D（PG 永不执行）', () => {
    const report = auditSources({
      '1000000000001_d.ts': `
export default class {
  protected tableName = 'td'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.json('meta').notNullable()
    })
    if (isSqliteDialect(this.db.dialect.name)) {
      this.schema.raw('CREATE INDEX idx_td_meta ON td (meta)')
    }
  }
}
`,
    })
    expect(report.unparsed).toEqual([])
    expect(report.byClass.A).toEqual([])
    expect(report.byClass.D).toHaveLength(1)
    expect(report.byClass.D[0]).toMatchObject({ name: 'idx_td_meta', cls: 'D', pgReachable: false })
  })

  it('jsonb + USING GIN → C（intentional search index）；json + GIN → A', () => {
    const report = auditSources({
      '1000000000001_c.ts': `
export default class {
  protected tableName = 'tc'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.jsonb('doc').notNullable()
      table.json('legacy').notNullable()
    })
    this.schema.raw('CREATE INDEX idx_tc_doc ON tc USING gin (doc)')
    this.schema.raw('CREATE INDEX idx_tc_legacy ON tc USING gin (legacy)')
  }
}
`,
    })
    expect(report.unparsed).toEqual([])
    expect(report.byClass.C).toHaveLength(1)
    expect(report.byClass.C[0]).toMatchObject({ name: 'idx_tc_doc', cls: 'C', usingMethod: 'gin' })
    expect(report.byClass.A).toHaveLength(1)
    expect(report.byClass.A[0]).toMatchObject({ name: 'idx_tc_legacy', cls: 'A' })
  })

  it('raw 表达式索引涉及 json 列（btree）→ A', () => {
    const report = auditSources({
      '1000000000001_e.ts': `
export default class {
  protected tableName = 'te'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.json('meta').notNullable()
    })
    this.schema.raw("CREATE INDEX idx_te_meta_key ON te ((meta->>'key'))")
  }
}
`,
    })
    expect(report.unparsed).toEqual([])
    expect(report.byClass.A).toHaveLength(1)
    expect(report.byClass.A[0]!.jsonColumns).toEqual(['meta'])
  })

  it('up/down 重复声明同一约束去重（保留首次）', () => {
    const report = auditSources({
      '1000000000001_f.ts': `
export default class {
  protected tableName = 'tf'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.json('meta').notNullable()
    })
    this.schema.raw('CREATE UNIQUE INDEX uq_tf_meta ON tf (meta)')
  }
  async down() {
    this.schema.raw('CREATE UNIQUE INDEX uq_tf_meta ON tf (meta)')
  }
}
`,
    })
    expect(report.unparsed).toEqual([])
    expect(report.byClass.A).toHaveLength(1)
  })
})

describe('1844000000000 修复契约', () => {
  const source = readFileSync(join(MIGRATIONS_DIR, MIGRATION_184400), 'utf8')

  it('dedupe_key_json 与 source_refs_json 使用 jsonb（PG 可索引类型）', () => {
    expect(source).toContain("table.jsonb('dedupe_key_json')")
    expect(source).toContain("table.jsonb('source_refs_json')")
    // 不再残留 json（非 b）声明
    expect(source).not.toContain("table.json('dedupe_key_json'")
    expect(source).not.toContain("table.json('source_refs_json'")
  })

  it('uq_csi_dedupe 唯一约束签名原样保留（等价完整性，不删约束）', () => {
    expect(source).toContain(
      "table.unique(['organization_id', 'project_id', 'dedupe_key_json'], 'uq_csi_dedupe')",
    )
  })

  it('idx_csi_org_proj_source 索引签名原样保留', () => {
    expect(source).toContain(
      "table.index(['organization_id', 'project_id', 'source_refs_json'], 'idx_csi_org_proj_source')",
    )
  })

  it('无被禁 workaround：raw DDL / GIN / opclass / 临时 hash 列 / text cast / IF NOT EXISTS', () => {
    // 注释承载修复说明（允许出现 operator class 等词），DDL 本体必须干净
    const stripped = stripComments(source)
    expect(stripped).not.toMatch(/this\.schema\.raw\(|rawQuery\(/)
    expect(stripped).not.toMatch(/USING\s+(gin|gist)/i)
    expect(stripped).not.toMatch(/\w+_ops\b|opclass/i)
    expect(stripped).not.toContain('dedupe_key_hash')
    expect(stripped).not.toMatch(/::text/i)
    expect(stripped).not.toMatch(/IF\s+NOT\s+EXISTS/i)
  })
})

describe('dedupe 语义契约', () => {
  const typesSource = readFileSync(TYPES_FILE, 'utf8')
  const modelSource = readFileSync(MODEL_FILE, 'utf8')

  it('InboxDedupeKey 仅含 problemKind/declaredKey 两个字符串标量字段（无数组/嵌套）', () => {
    const bodyMatch = typesSource.match(/export interface InboxDedupeKey\s*\{([\s\S]*?)\}/)
    expect(bodyMatch).not.toBeNull()
    const body = bodyMatch![1]!
    expect(body).toMatch(/problemKind:\s*InboxProblemKind/)
    expect(body).toMatch(/declaredKey:\s*string/)
    // 无数组类型字段——数组顺序语义不进入去重键
    expect(body).not.toMatch(/\[\]|Array</)
  })

  it('serializeInboxDedupeKey 为稳定规范串 problemKind::declaredKey（DB 唯一约束身份）', () => {
    const fnIdx = typesSource.indexOf('export function serializeInboxDedupeKey')
    expect(fnIdx).toBeGreaterThanOrEqual(0)
    const window = typesSource.slice(fnIdx, fnIdx + 400)
    expect(window).toContain('`${key.problemKind}::${key.declaredKey}`')
  })

  it('model dedupe_key_json payload 契约不变（prepare/consume = JSON.stringify/parse）', () => {
    expect(modelSource).toContain("columnName: 'dedupe_key_json'")
    expect(modelSource).toMatch(/prepare:\s*\(v:\s*InboxDedupeKey\)\s*=>\s*JSON\.stringify\(v\)/)
    // e67a5bde 起 consume 兼容两种驱动形态：SQLite 回字符串（JSON.parse），
    // PostgreSQL 的 json 列驱动已解析为对象（原样放行，避免二次 parse 读取即 500）。
    expect(modelSource).toMatch(
      /consume:\s*\(v:\s*unknown\)\s*=>\s*\(typeof v === 'string' \? JSON\.parse\(v\) : v\)/,
    )
  })
})

describe('repository-wide JSON indexability 门禁', () => {
  const report = auditJsonIndexability(MIGRATIONS_DIR)

  it('扫描覆盖：≥273 迁移、≥300 JSON 列声明、≥900 创建型约束', () => {
    expect(report.stats.migrationsScanned).toBeGreaterThanOrEqual(273)
    expect(report.jsonColumns.length).toBeGreaterThanOrEqual(300)
    expect(report.stats.constraintsScanned).toBeGreaterThanOrEqual(900)
  })

  it('unparsed = 0（无动态/无法静态解析的创建型约束）', () => {
    expect(report.unparsed).toEqual([])
  })

  it('A = 0（PG 必然失败的 json btree/GIN 约束不存在）', () => {
    expect(report.byClass.A).toEqual([])
  })

  it('C = 0 且 D = 0（当前无 intentional GIN JSON 搜索索引、无 SQLite-only JSON 约束）', () => {
    expect(report.byClass.C).toEqual([])
    expect(report.byClass.D).toEqual([])
  })

  it('B 冻结为修复后的两项（双向比对防 stale）', () => {
    const actual = report.byClass.B.map((c) => ({
      migration: c.migration,
      table: c.table,
      kind: c.kind,
      name: c.name,
      jsonColumns: c.jsonColumns,
    }))
    expect(actual).toEqual(KNOWN_PG_JSONB_CONSTRAINTS)
    expect(KNOWN_PG_JSONB_CONSTRAINTS).toEqual(actual)
  })

  it('两项 B 约束均 PG 可达且经 knex 表级声明', () => {
    for (const c of report.byClass.B) {
      expect(c.pgReachable).toBe(true)
      expect(c.via).toBe('knex-table')
    }
  })
})
