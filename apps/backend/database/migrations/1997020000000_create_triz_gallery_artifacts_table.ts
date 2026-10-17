import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-triz-contradiction-copilot W4 任务 4.1 —— `triz_gallery_artifacts` 分馆产物表（design D5）。
 *
 * 一行 = 分馆产物在**某一版本**上的快照。版本链的键是「项目 + 产物类型」三元组
 * （`organization_id` + `project_id` + `artifact_type`）：
 * - 新建（创建端点）= 该链的第 1 版；更新（更新端点）= 该链的下一版**新行**，
 *   旧版本行原样保留 ⇒ 版本回退可取回旧版本内容，且软删除不物理破坏历史；
 * - 「是否当前版本」由服务层按链内最大 `version` 判定，库层用
 *   `uq_triz_gallery_artifacts_proj_type_version` 保证版本号在链内不重复、可寻址。
 *
 * 字段族（spec「分馆产物的持久化与权限」第 1 条）：
 * - 归属：`organization_id` / `project_id`（全部查询强制双列过滤，跨组织统一 404）；
 * - 产物：`artifact_type`（四类闭集 CHECK）/ `content`(JSON 结构化内容) / `version`；
 * - 审计与软删：`created_by`（创建人，NOT NULL）/ `updated_by`（更新人，可空）
 *   / `deleted_at` / 时间戳。
 *
 * **低敏边界**：`content` 只承载结构化产物（格子 / 节点 / 连线 / 标注 / 参数对与原则编号快照），
 * MUST NOT 存 prompt、模型输出全文或陈述原文全文；服务层对内容做键名与体积双重拦截
 * （见 `app/services/triz_copilot/triz_gallery_artifact_service.ts`）。
 * **不承载通用图表契约**：本表独立于既有 `diagrams` / `DiagramSpec`（design D13），
 * 既有图表产物表的类型枚举与结构零改动。
 *
 * 方言兼容：无 `.after()`；约束与索引显式命名（≤ PostgreSQL 63 字节）；
 * JSON 列不参与 btree 唯一 / 索引（PG `json` 无默认 opclass）。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_gallery_artifacts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // ── 产物类型闭集（spec：矛盾矩阵快照 / 九屏幕 / 功能分析 / 进化 S 曲线快照） ──
      table.string('artifact_type', 32).notNullable()
      table.check(
        "artifact_type IN ('contradiction_matrix','nine_windows','function_analysis','s_curve')",
      )

      /** 结构化产物内容（格子 / 节点 / 连线 / 标注 / 参数对与原则编号快照）；不存任何全文。 */
      table.json('content').notNullable()

      /** 版本号：链内从 1 起递增，更新即新增下一版（旧版本保留可回退）。 */
      table.integer('version').notNullable().defaultTo(1)
      table.check('version >= 1')

      // ── 审计与软删 ────────────────────────────────────────────────────
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')

      table
        .bigInteger('updated_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 库层唯一约束：同一「项目 + 类型 + 版本」只允许一行（版本可辨、可回退寻址）。
      table.unique(
        ['project_id', 'artifact_type', 'version'],
        'uq_triz_gallery_artifacts_proj_type_version',
      )

      table.index(
        ['organization_id', 'project_id', 'artifact_type'],
        'idx_triz_gallery_artifacts_org_proj_type',
      )
      table.index(
        ['organization_id', 'project_id', 'deleted_at'],
        'idx_triz_gallery_artifacts_org_proj_deleted',
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
