/**
 * Ace 命令：user:create —— 在部署机上为团队成员建立普通账号。
 *
 * 个人版没有自助注册页，Google 登录也要先配置凭据；组织管理员「邀请成员」又要求对方已有账号。
 * 这个命令让实例管理员直接建账号，之后在「设置 → 组织」里按邮箱邀请进组织（个人版导出 7.2 冒烟发现）。
 *
 * - 只新建，不修改已存在的账号（避免借命令改别人的密码或权限）；
 * - 普通账号：非超级管理员、需按组织策略设置两步验证，不自动加入任何组织；
 * - 密码与 admin:create-super 相同：交互式隐藏输入，或 --generate-password 随机生成并只打印一次；
 * - 写审计日志（只记录邮箱与动作，不记录密码）。
 */
import { BaseCommand, flags } from '@adonisjs/core/ace'
import { DateTime } from 'luxon'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { EMAIL_PATTERN, PASSWORD_PATTERN, generateStrongPassword } from './admin_create_super.js'

export default class UserCreateCommand extends BaseCommand {
  static commandName = 'user:create'
  static description = '为团队成员建立普通账号（不加入组织；之后由组织管理员按邮箱邀请）'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  @flags.string({ description: '成员邮箱（省略则交互输入）' })
  declare email?: string

  @flags.string({ description: '显示名称（默认取邮箱 @ 前的部分）' })
  declare name?: string

  @flags.boolean({
    description: '非交互：随机生成强密码并只在终端打印一次（请交给成员，登录后自行修改）',
  })
  declare generatePassword?: boolean

  async run(): Promise<void> {
    const email = String(this.email ?? (await this.prompt.ask('成员邮箱')) ?? '')
      .trim()
      .toLowerCase()
    if (!EMAIL_PATTERN.test(email)) {
      this.logger.error('邮箱格式不正确')
      this.exitCode = 1
      return
    }

    const { default: db } = await import('@adonisjs/lucid/services/db')
    const existing = await db.from('users').where('email', email).whereNull('deleted_at').first()
    if (existing) {
      this.logger.error(`账号 ${email} 已存在；本命令不修改已有账号`)
      this.exitCode = 1
      return
    }

    let password: string
    if (this.generatePassword) {
      password = generateStrongPassword()
    } else {
      password = await this.prompt.secure('登录密码（8–32 位，含大小写字母与数字）')
      if (!PASSWORD_PATTERN.test(password)) {
        this.logger.error('密码不符合策略：8–32 位，且须包含大写字母、小写字母与数字')
        this.exitCode = 1
        return
      }
      const confirmation = await this.prompt.secure('再次输入密码')
      if (confirmation !== password) {
        this.logger.error('两次输入的密码不一致')
        this.exitCode = 1
        return
      }
    }

    const fullName = this.name?.trim() || email.split('@')[0]
    // 与 admin:create-super 相同：console 环境下 User 模型的 hash 服务未就绪，手动哈希后写表
    const { default: AuditService, AuditEvent } = await import('#services/audit_service')
    const { insertReturningId } = await import('#database/support/insert_returning_id')
    const hasher = await this.app.container.make('hash')
    const hashedPassword = await hasher.make(password)

    const userId = await db.transaction(async (trx) => {
      const now = DateTime.utc().toFormat(trx.dialect.dateTimeFormat)
      return Number(
        await insertReturningId(trx, 'users', {
          email,
          full_name: fullName,
          password: hashedPassword,
          auth_provider: 'local',
          is_active: true,
          is_super_admin: false,
          two_factor_exempt: false,
          role_version: 0,
          created_at: now,
          updated_at: now,
        }),
      )
    })

    const audit = await this.app.container.make(AuditService)
    await audit.log({
      event: AuditEvent.USER_CREATED,
      userId,
      entityType: 'user',
      entityId: userId,
      metadata: { source: 'ace:user:create' },
    })

    this.logger.success(`已建立账号 ${email}`)
    if (this.generatePassword) {
      // 仅此一次输出，不写日志文件、不入审计
      console.log(`生成的登录密码（仅显示一次）：${password}`)
    }
    this.logger.info('请组织管理员在「设置 → 组织」里按这个邮箱邀请成员加入组织。')
  }
}
