import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

/**
 * `database/schema.ts` 代码生成规则。
 *
 * ## 为什么需要这份规则
 *
 * `schema.ts` 由 `node ace migration:run` 自动重生成。在这份规则存在之前，生成器的
 * 默认映射与本仓库既有代码的假设**不一致**，导致任何人跑一次迁移就会把构建搞坏：
 * 重生成后 `audit_logs_controller`、`task_dependencies_controller`、
 * `ocr_entity_link_target_adapter` 等文件立刻报 `bigint | number` 不能赋给 `number`。
 * 于是没人敢重生成，提交版与生成器输出持续漂移（实测已差 213 个 bigint 列 + 若干
 * decimal 列），新表的 schema 类也一直进不来。
 *
 * 两处默认值与本仓库不合：
 *
 * 1. **BIGINT → `bigint | number`**（生成器默认）。这个联合类型在两种方言下都不成立，
 *    而且会把 `bigint` 传染给每一个消费主键/外键的调用点。
 * 2. **DECIMAL → `string`**（生成器默认）。本仓库的 decimal 列（成本、置信度等）
 *    全部按数值消费。
 *
 * ## 运行期实测（2026-09-05，探针直连）
 *
 * | 列类型 | PostgreSQL (node-pg) | SQLite (better-sqlite3) |
 * |---|---|---|
 * | `bigint` / `int8` | `string`（`"1"`） | `number` |
 * | `numeric` / `decimal` | `string`（`"1.50"`） | `number` |
 * | `integer` | `number` | `number` |
 *
 * 也就是说：**没有任何单一标注在两种方言下都为真**。这里选 `number`，理由是
 * 它与全仓既有假设一致（`User` 模型早就手写了 `declare id: number` 并注明
 * 「收窄 schema 基类的 bigint | number -> number」），也与本机 SQLite 的实际返回一致；
 * 而 PG 侧返回字符串是**独立于类型标注的既有行为**，改标注既不会引入也不会修复它。
 *
 * ⚠️ PG 上 bigint/numeric 返回字符串这一点是真实存在的跨方言隐患，处置方式是注册
 * node-pg 的 type parser（int8=20 / numeric=1700），但那会全局改变每一条查询的返回值，
 * 且对超出 `Number.MAX_SAFE_INTEGER` 的值与高精度小数有精度取舍，属于产品级决策，
 * 不在代码生成规则的职责范围内，故此处只记录不代劳。
 *
 * ## 维护约定
 *
 * 改动本文件后必须重跑一次 `node ace migration:run` 并确认 `pnpm --filter backend
 * exec tsc --noEmit` 为零错误——这份规则的唯一目的就是让「重生成」不再是破坏性操作。
 */
export default {
  types: {
    /**
     * 主键与外键在本仓库一律按 `number` 消费。
     * 生成器默认的 `bigint | number` 会让每个调用点都要处理一个实际不会出现的 bigint。
     */
    bigint: {
      tsType: 'number',
      imports: [],
      decorators: [{ name: '@column' }],
    },
    /**
     * decimal / numeric 列（成本、工期、置信度等）按数值消费，
     * 不用生成器默认的 `string`。
     */
    decimal: {
      tsType: 'number',
      imports: [],
      decorators: [{ name: '@column' }],
    },
  },
} satisfies SchemaRules
