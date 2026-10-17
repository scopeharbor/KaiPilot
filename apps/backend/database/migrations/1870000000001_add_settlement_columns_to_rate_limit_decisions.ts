/**
 * v3-copilot-live-submission-channel §8.7 — 限流决策结算列。
 *
 * 为什么需要这两列：
 * `RateLimitGuard.postflight` 本已存在并计算 `deviation`，但它把真实 token 写回
 * `current_count`（覆盖掉决策当时的窗口计数），并用「`estimated_delta` 非空且
 * `current_count > 0`」当幂等标记——决策当时窗口非空是常态，于是**首次结算就被误判为
 * 已结算**，偏差从来没被记下来过。
 *
 * 修法是给结算一个自己的落点，而**不新建偏差表**（tasks 8.7 明确要求）：
 * 偏差 = `actual_tokens - estimated_delta`，两列都在本表内，可直接聚合。
 *
 * 方言兼容：仅用 Lucid/knex 可移植 API，PG 迁移路径保留。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class AddSettlementColumnsToRateLimitDecisions extends BaseSchema {
  protected tableName = 'rate_limit_decisions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // 真实 token 用量（结算前为 null）。与 estimated_delta 之差即偏差。
      table.integer('actual_tokens').nullable()
      // 结算时刻。非空即已结算——幂等判定只看这一列，不再靠计数推断。
      table.timestamp('settled_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('actual_tokens')
      table.dropColumn('settled_at')
    })
  }
}
