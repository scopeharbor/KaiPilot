import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 两步验证（TOTP 2FA）持久化三表。
 *
 * 设计要点：
 * - 凭据与用户 1:1（`uq_u2f_credentials_user`）；`status` 区分 `pending`（已生成密钥、
 *   尚未用一次性验证码确认）与 `active`（已生效，登录必须过第二因子）。
 * - 密钥以 `CryptoService`（AES-256-GCM）密文落库，明文只在注册向导那一次响应里出现。
 * - `last_used_step` 记录最近一次成功验证的 TOTP 时间步，用于**同步口令重放防护**：
 *   同一时间步的验证码只能用一次。
 * - 恢复码单独一张表，逐条 sha256 哈希存储 + 一次性消费（`used_at`），
 *   便于「剩余可用条数」查询与整批重置。
 * - 登录挑战独立成表而非无状态 JWT：可撤销、可计失败次数、可随登出/禁用即时作废；
 *   只存 token 的 sha256，明文仅在响应里返回一次。`purpose` 区分两种登录中断：
 *   `verify`（已绑定，输认证器验证码）与 `enroll`（未绑定，登录中扫码完成首次绑定，
 *   即 Auth0/Okta 的 enrollment-at-login）。
 *
 * 全部标识符显式命名并控制在 PG 63 字节内（见 tests/unit/pg_identifier_audit.spec.ts），
 * 不使用 json 列，规避 PG json 无默认 btree opclass 问题。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('user_two_factor_credentials', (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 'pending' | 'active'
      table.string('status', 16).notNullable().defaultTo('pending')

      // AES-256-GCM 密文（`v1.<iv>.<tag>.<enc>` 格式）
      table.text('secret_encrypted').notNullable()

      // 「更换认证器」在途密钥：已生效的绑定期间用户扫新二维码时，新密钥先存在这里，
      // 确认成功才提升为 secret_encrypted。这样中途放弃/输错不会把用户锁在门外。
      table.text('pending_secret_encrypted').nullable()
      table.timestamp('pending_started_at').nullable()

      // TOTP 参数（RFC 6238）——固定写入便于未来放宽而无需再迁移
      table.string('algorithm', 16).notNullable().defaultTo('SHA1')
      table.integer('digits').unsigned().notNullable().defaultTo(6)
      table.integer('period').unsigned().notNullable().defaultTo(30)

      // 认证器标签（用户自填，纯展示）
      table.string('label', 64).nullable()

      table.timestamp('confirmed_at').nullable()
      table.timestamp('last_used_at').nullable()
      // 最近一次成功验证的时间步：同一步内的验证码不可重放
      table.bigInteger('last_used_step').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.unique(['user_id'], { indexName: 'uq_u2f_credentials_user' })
      table.index(['status'], 'idx_u2f_credentials_status')
    })

    this.schema.createTable('user_two_factor_recovery_codes', (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // sha256(规范化恢复码) 的十六进制串——恢复码本身高熵，无需慢哈希
      table.string('code_hash', 64).notNullable()
      table.timestamp('used_at').nullable()
      table.timestamp('created_at').notNullable()

      table.unique(['user_id', 'code_hash'], { indexName: 'uq_u2f_recovery_user_code' })
      table.index(['user_id'], 'idx_u2f_recovery_user')
    })

    this.schema.createTable('user_two_factor_challenges', (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // sha256(挑战令牌)；明文只在密码校验通过那一次响应里返回
      table.string('token_hash', 64).notNullable()

      // 'verify'（已绑定，校验一次性口令/恢复码）| 'enroll'（未绑定，登录中扫码绑定）
      table.string('purpose', 16).notNullable().defaultTo('verify')

      table.integer('attempts').unsigned().notNullable().defaultTo(0)
      table.timestamp('expires_at').notNullable()
      table.timestamp('consumed_at').nullable()
      table.timestamp('created_at').notNullable()

      table.unique(['token_hash'], { indexName: 'uq_u2f_challenges_token' })
      table.index(['user_id'], 'idx_u2f_challenges_user')
      table.index(['expires_at'], 'idx_u2f_challenges_expires')
    })
  }

  async down() {
    this.schema.dropTableIfExists('user_two_factor_challenges')
    this.schema.dropTableIfExists('user_two_factor_recovery_codes')
    this.schema.dropTableIfExists('user_two_factor_credentials')
  }
}
