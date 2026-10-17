/**
 * v3-multitenant-database-isolation —— 幂等键唯一约束补齐组织 scope（任务 3.3 / 3.5）。
 *
 * spec「Tenant-local uniqueness includes organization」要求：resource code / slug /
 * handle / policy name / artifact key / idempotency key 若只在组织内唯一，迁移必须
 * 建立含 `organization_id` 的复合唯一约束。
 *
 * 核准（2026-08-09）发现 5 张表的幂等键仍是**全局唯一**，构成两类跨租问题：
 * 1. 组织 O1 先占用某 key 后，O2 用同 key 写入直接唯一冲突 → 以错误差异泄露
 *    「该 key 在别处已存在」（存在性侧信道）；
 * 2. 幂等命中查询按 key 全局匹配时会读到他租行（见 §5.4 同批修复的
 *    ocr_budget_guard / ocr_provider_attempt_recorder / rewrap_service）。
 *
 * 修复清单（全部改为组织或父级 scope 内唯一）：
 * - kms_rewrap_jobs(idempotency_key)                → (organization_id, idempotency_key)
 * - ocr_provider_budget_decisions(idempotency_key)  → (organization_id, idempotency_key)
 * - ocr_provider_attempts(idempotency_key)          → (organization_id, idempotency_key)
 * - ocr_queue_items(idempotency_key_hash)           → (organization_id, idempotency_key_hash)
 * - ai_draft_layer_apply_results(idempotency_key)   → (session_id, idempotency_key)
 *   （tenant-derived 表，无 organization_id 列；session_id 即其 catalog 父级链，
 *    等价于组织 scope，见 database_isolation_catalog 声明）
 *
 * 唯一性放宽方向兼容既有数据（原全局唯一的行必然满足新复合唯一），SQLite 与 PG
 * 均通过 knex dropUnique/unique 生成方言对应语句。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

/** [表名, 旧唯一约束名, 旧列, 新唯一约束名, 新列] */
const REWRITES: ReadonlyArray<[string, string, string[], string, string[]]> = [
  [
    'kms_rewrap_jobs',
    'kms_rewrap_jobs_idempotency_key_unique',
    ['idempotency_key'],
    'uq_kms_rewrap_org_idem',
    ['organization_id', 'idempotency_key'],
  ],
  [
    'ocr_provider_budget_decisions',
    'ocr_budget_decisions_ik_unique',
    ['idempotency_key'],
    'uq_ocr_budget_org_idem',
    ['organization_id', 'idempotency_key'],
  ],
  [
    'ocr_provider_attempts',
    'ocr_attempts_ik_unique',
    ['idempotency_key'],
    'uq_ocr_attempts_org_idem',
    ['organization_id', 'idempotency_key'],
  ],
  [
    'ocr_queue_items',
    'ocr_queue_idemp_key_uniq',
    ['idempotency_key_hash'],
    'uq_ocr_queue_org_idem',
    ['organization_id', 'idempotency_key_hash'],
  ],
  [
    'ai_draft_layer_apply_results',
    'ai_draft_layer_apply_results_idempotency_key_unique',
    ['idempotency_key'],
    'uq_adlar_session_idem',
    ['session_id', 'idempotency_key'],
  ],
]

export default class extends BaseSchema {
  async up() {
    for (const [table, oldName, oldColumns, newName, newColumns] of REWRITES) {
      // 开源个人版没有企业表（kms_rewrap_jobs）：表不存在时跳过。私有库里表都存在，
      // 行为不变；已执行过的迁移不会重跑（v3-personal-edition-open-source-export 3.7）。
      if (!(await this.db.schema.hasTable(table))) continue
      this.schema.alterTable(table, (t) => {
        t.dropUnique(oldColumns, oldName)
      })
      this.schema.alterTable(table, (t) => {
        t.unique(newColumns, newName)
      })
    }
  }

  async down() {
    for (const [table, oldName, oldColumns, newName, newColumns] of REWRITES) {
      if (!(await this.db.schema.hasTable(table))) continue
      this.schema.alterTable(table, (t) => {
        t.dropUnique(newColumns, newName)
      })
      this.schema.alterTable(table, (t) => {
        t.unique(oldColumns, oldName)
      })
    }
  }
}
