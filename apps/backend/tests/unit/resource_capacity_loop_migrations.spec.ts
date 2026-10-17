// v3-resource-capacity-forecasting-closed-loop §3.2 —— 迁移静态分析测试。
// 覆盖：up/down 对称、organization 父链与 CASCADE、唯一索引、CHECK 封闭枚举、
// JSON 默认值、SQLite/PG 兼容形状（无 PG 不兼容列型）、低敏列面。
// 模式参照 budget_decisions_migration.spec.ts 的静态分析先例。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION_FILES = [
  '1980000000000_create_resource_capacity_loops_tables.ts',
  '1980000000001_create_resource_capacity_loop_outcome_tables.ts',
]

function readMigration(file: string): string {
  const candidates = [
    resolve(process.cwd(), 'apps/backend/database/migrations', file),
    resolve(process.cwd(), 'database/migrations', file),
  ]
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf-8')
    } catch {
      continue
    }
  }
  throw new Error(`migration 文件不存在：${file}`)
}

const TABLES_UP = [
  'resource_capacity_loops',
  'resource_capacity_baseline_snapshots',
  'resource_capacity_scenarios',
  'resource_capacity_simulation_snapshots',
  'resource_capacity_selections',
  'resource_capacity_handoff_receipts',
  'resource_capacity_observation_snapshots',
  'resource_capacity_reviews',
] as const

describe('§3.2 resource_capacity_* 迁移静态契约', () => {
  it('两张迁移文件覆盖全部 8 张表，且 up/down 对称（down 逆序 drop）', () => {
    const m1 = readMigration(MIGRATION_FILES[0]!)
    const m2 = readMigration(MIGRATION_FILES[1]!)
    const all = m1 + m2

    for (const t of TABLES_UP) {
      expect(all).toContain(`createTable('${t}'`)
    }
    // 每个文件内 down 按建表逆序 drop。
    const drops1 = [...m1.matchAll(/dropTable\('(\w+)'\)/g)].map((m) => m[1])
    expect(drops1).toEqual([
      'resource_capacity_simulation_snapshots',
      'resource_capacity_scenarios',
      'resource_capacity_baseline_snapshots',
      'resource_capacity_loops',
    ])
    const drops2 = [...m2.matchAll(/dropTable\('(\w+)'\)/g)].map((m) => m[1])
    expect(drops2).toEqual([
      'resource_capacity_reviews',
      'resource_capacity_observation_snapshots',
      'resource_capacity_handoff_receipts',
      'resource_capacity_selections',
    ])
    expect(drops1.length + drops2.length).toBe(8)
    for (const t of TABLES_UP) {
      expect(drops1.concat(drops2)).toContain(t)
    }
  })

  it('每张表都显式带 organization_id 且 FK 指向 organizations 并 CASCADE', () => {
    for (const file of MIGRATION_FILES) {
      const src = readMigration(file)
      const tableBlocks = src.split('createTable(').slice(1)
      expect(tableBlocks.length).toBeGreaterThan(0)
      for (const block of tableBlocks) {
        expect(block).toContain("'organization_id'")
        expect(block).toContain(".inTable('organizations')")
        expect(block).toContain("onDelete('CASCADE')")
      }
    }
  })

  it('子表经 loop_id / scenario_id 父链引用闭环父表', () => {
    const all = MIGRATION_FILES.map(readMigration).join('\n')
    for (const parent of [
      ".inTable('resource_capacity_loops')",
      ".inTable('resource_capacity_baseline_snapshots')",
      ".inTable('resource_capacity_scenarios')",
      ".inTable('resource_capacity_simulation_snapshots')",
      ".inTable('resource_capacity_selections')",
      ".inTable('resource_capacity_observation_snapshots')",
    ]) {
      expect(all).toContain(parent)
    }
  })

  it('封闭枚举用 CHECK 约束固化：state/granularity/confidence/stale_state/target/status/outcome', () => {
    const all = MIGRATION_FILES.map(readMigration).join('\n')
    expect(all).toContain(
      "state IN ('draft','simulated','selected','handed-off','observing','reviewed','closed','cancelled')",
    )
    expect(all).toContain("granularity IN ('day','week','month')")
    expect(all).toContain("confidence_band IN ('high','medium','low')")
    expect(all).toContain("stale_state IN ('current','stale')")
    expect(all).toContain(
      "target IN ('cross-project-allocation-draft','project-resource-suggestion-preview','safe-navigation')",
    )
    expect(all).toContain(
      "status IN ('pending','previewed','confirmed_downstream','applied_downstream','partial','failed','cancelled','expired')",
    )
    expect(all).toContain("outcome IN ('goal_met','partially_met','not_met','invalidated')")
  })

  it('幂等唯一索引齐备：baseline digest / simulation digest / selection fingerprint / handoff idempotency', () => {
    const all = MIGRATION_FILES.map(readMigration).join('\n')
    expect(all).toContain("table.unique(['organization_id', 'loop_id', 'baseline_digest'])")
    // simulation 快照 unique 因 PG 63-byte 截断撞名改为多行 + 显式短名写法，
    // 断言需容忍换行与缩进（对照迁移文件 uq_rcss_org_scenario_digest）。
    expect(all).toMatch(
      /table\.unique\(\s*\['organization_id', 'scenario_id', 'simulation_digest'\]/,
    )
    expect(all).toContain("table.unique(['organization_id', 'selection_fingerprint'])")
    expect(all).toContain("table.unique(['organization_id', 'idempotency_hash'])")
    expect(all).toContain("table.unique(['organization_id', 'observation_snapshot_id'])")
  })

  it('JSON 列有默认值；快照表不可变（无 updated_at）', () => {
    const all = MIGRATION_FILES.map(readMigration).join('\n')
    expect(all).toMatch(/overlays_json[\s\S]{0,80}?defaultTo\('\[\]'\)/)
    expect(all).toMatch(/warnings_json[\s\S]{0,80}?defaultTo\('\[\]'\)/)
    // baseline/simulation/observation 快照只有 created_at：
    const snapshotTables = [
      'resource_capacity_baseline_snapshots',
      'resource_capacity_simulation_snapshots',
      'resource_capacity_observation_snapshots',
    ]
    const m1 = readMigration(MIGRATION_FILES[0]!)
    const m2 = readMigration(MIGRATION_FILES[1]!)
    for (const t of snapshotTables) {
      const src = t === 'resource_capacity_observation_snapshots' ? m2 : m1
      const after = src.split(`createTable('${t}'`)[1] ?? ''
      // 截断到下一个 createTable，避免把后续表的内容算进本表块。
      const block = after.split("this.schema.createTable('")[0]
      expect(block).not.toContain('updated_at')
      expect(block).toContain('created_at')
    }
  })

  it('SQLite/PG 兼容形状：小时数以字符串承载而非 decimal/numeric 专有精度', () => {
    const all = MIGRATION_FILES.map(readMigration).join('\n')
    expect(all).not.toMatch(/\.decimal\(|\.numeric\(|\.float\(/)
    expect(all).toContain("string('gap_delta_hours', 24)")
  })

  it('低敏红线：receipt/review 不存 confirm token、payload 正文或 URL/path/secret 列', () => {
    const FORBIDDEN = [
      /confirm_fingerprint/i,
      /apply_handle/i,
      /token(?!s)/i,
      /secret/i,
      /\burl\b/i,
      /file_path/i,
      /authorization/i,
    ]
    const m2 = readMigration(MIGRATION_FILES[1]!)
    for (const p of FORBIDDEN) {
      expect(p.test(m2)).toBe(false)
    }
  })
})
