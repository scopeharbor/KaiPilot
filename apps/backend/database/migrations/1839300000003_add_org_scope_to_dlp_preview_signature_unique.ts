/**
 * v3-multitenant-database-isolation —— DLP 预览签名唯一键补齐组织 scope（任务 6.2）。
 *
 * `dlp_previews.signature` = fnv1a(decisionHash + expiresAt)，**不含组织标识**，
 * 却建成全局唯一。两个后果（核准 2026-08-09）：
 * 1. 两个组织在同一秒对相同内容生成预览会撞唯一键，写入失败本身就泄露
 *    「别处已存在相同内容的预览」（内容侧信道）；
 * 2. 配合原先无 scope 的 `DlpPreview.findBySignature`，他租签名可直接查出他租预览行
 *    （policyHash / sourceHash / decisionHash / matchSummary）。查询侧已在
 *    `dlp_preview_service.ts` 改走 `findByOrgAndSignature`，唯一键在此对齐。
 *
 * 改为 (organization_id, signature) 唯一：spec「Preview signature cannot replay
 * across tenants」要求比对与重放校验都必须包含租户命名空间。
 * 既有 `idx_dlp_pr_org_sig` 普通索引保留（唯一索引本身即可支撑该查询，但删掉它
 * 会牵动 down 迁移语义，代价大于收益）。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // 开源个人版没有企业表 dlp_previews：表不存在时跳过。私有库里表存在，行为不变；
    // 已执行过的迁移不会重跑（v3-personal-edition-open-source-export 3.7）。
    if (!(await this.db.schema.hasTable('dlp_previews'))) return
    this.schema.alterTable('dlp_previews', (table) => {
      table.dropUnique(['signature'], 'dlp_previews_signature_unique')
    })
    this.schema.alterTable('dlp_previews', (table) => {
      table.unique(['organization_id', 'signature'], 'uq_dlp_previews_org_signature')
    })
  }

  async down() {
    if (!(await this.db.schema.hasTable('dlp_previews'))) return
    this.schema.alterTable('dlp_previews', (table) => {
      table.dropUnique(['organization_id', 'signature'], 'uq_dlp_previews_org_signature')
    })
    this.schema.alterTable('dlp_previews', (table) => {
      table.unique(['signature'], 'dlp_previews_signature_unique')
    })
  }
}
