/**
 * Ace 命令：admin:create-super —— 在部署机上建立（或升级）平台超级管理员。
 *
 * 做三件事，全部幂等：
 *   1. 按邮箱建立/更新本地账号：is_super_admin=true、is_active=true、two_factor_exempt=true；
 *   2. 私有部署（注册了平台扩展点时）：确保「平台统一 AI 配置」组织（slug=platform-ai，
 *      enterprise）存在，并把该账号挂为成员——管理员登录后在该组织的「AI 连接」页配置的连接，
 *      即所有个人版（Google 登录）用户的统一 AI 配置。开源个人版没有这一步；
 *   3. 写审计日志（只记录邮箱与动作，不记录密码）。
 *
 * 密码只经交互式隐藏输入读取，不接受命令行参数（避免落入 shell 历史与进程列表），不打印。
 * Docker 目标机：`docker compose -f compose.supabase.yaml run --rm backend admin-create`。
 */
import { randomInt } from 'node:crypto'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import { DateTime } from 'luxon'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** 与 `#validators/user` 的密码策略一致：8–32 位，含大小写字母与数字。 */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,32}$/

export default class AdminCreateSuperCommand extends BaseCommand {
  static commandName = 'admin:create-super'
  static description =
    '建立或升级超级管理员（免两步验证）；私有部署同时确保平台统一 AI 配置组织存在'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  @flags.string({ description: '管理员邮箱（省略则交互输入）' })
  declare email?: string

  @flags.string({ description: '显示名称（默认「平台管理员」）' })
  declare name?: string

  @flags.boolean({
    description: '非交互：随机生成强密码并只在终端打印一次（无 TTY 环境使用，登录后请自行修改）',
  })
  declare generatePassword?: boolean

  async run(): Promise<void> {
    const email = String(this.email ?? (await this.prompt.ask('管理员邮箱')) ?? '')
      .trim()
      .toLowerCase()
    if (!EMAIL_PATTERN.test(email)) {
      this.logger.error('邮箱格式不正确')
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

    const fullName = this.name?.trim() || '平台管理员'

    // 必须在 app 启动后再加载：ace 先加载命令模块再启动 app，若顶层导入 User，
    // `withAuthFinder(hash)` 会拿到尚未注册的 hash 服务（undefined.use）。
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const { default: AuditService, AuditEvent } = await import('#services/audit_service')
    const { editionHooks } = await import('#services/edition/edition_registry')
    const { insertReturningId } = await import('#database/support/insert_returning_id')
    // 平台统一 AI 配置组织只存在于私有部署（版本扩展点）；个人版只建立实例管理员账号
    const platformAi = editionHooks().platformAi
    // 不走 User 模型保存：console 环境下 `withAuthFinder(hash)` 的 hash 服务未就绪
    // （undefined.use）。直接从容器取 hash 手动哈希，再用查询构造器写 users。
    const hasher = await this.app.container.make('hash')
    const hashedPassword = await hasher.make(password)

    const outcome = await db.transaction(async (trx) => {
      // 按连接方言格式化时间戳：直接写 JS Date 时 SQLite 存成毫秒数，模型读回 createdAt 会报
      // 「number cannot be formatted」（个人版默认 SQLite，登录即 500）；PG 仍是带时区的时间。
      const now = DateTime.utc().toFormat(trx.dialect.dateTimeFormat)
      const existing = await trx.from('users').where('email', email).whereNull('deleted_at').first()
      const created = !existing
      let userId: number
      if (!existing) {
        userId = Number(
          await insertReturningId(trx, 'users', {
            email,
            full_name: fullName,
            password: hashedPassword,
            auth_provider: 'local',
            is_active: true,
            is_super_admin: true,
            two_factor_exempt: true,
            role_version: 0,
            created_at: now,
            updated_at: now,
          }),
        )
      } else {
        userId = Number(existing.id)
        await trx
          .from('users')
          .where('id', userId)
          .update({
            password: hashedPassword,
            is_active: true,
            is_super_admin: true,
            two_factor_exempt: true,
            // 角色/状态发生变化，旧令牌应即时失效。
            role_version: Number(existing.role_version ?? 0) + 1,
            updated_at: now,
          })
      }
      const organizationId = platformAi
        ? await platformAi.ensureSuperAdminOrganization({ client: trx, userId })
        : null
      return { userId, created, organizationId }
    })

    // 个人版没有平台统一 AI 配置组织：管理员还不属于任何组织时建立一个默认组织并设为所有者，
    // 否则按 README 登录后「设置 → AI 连接」、建项目都无从开始（个人版导出 7.2 冒烟发现）。
    let personalOrganization: { id: number; name: string } | null = null
    if (!platformAi) {
      const membership = await db
        .from('organization_members')
        .where('user_id', outcome.userId)
        .first()
      if (!membership) {
        const { default: OrganizationService } = await import('#services/organization_service')
        const organizations = await this.app.container.make(OrganizationService)
        const organization = await organizations.create(
          { name: `${fullName}的组织`, ownerId: outcome.userId },
          outcome.userId,
        )
        personalOrganization = { id: organization.id, name: organization.name }
      }
    }

    const audit = await this.app.container.make(AuditService)
    await audit.log({
      event: outcome.created ? AuditEvent.USER_CREATED : AuditEvent.USER_UPDATED,
      userId: outcome.userId,
      entityType: 'user',
      entityId: outcome.userId,
      metadata: { source: 'ace:admin:create-super', superAdmin: true, twoFactorExempt: true },
    })

    this.logger.success(
      `${outcome.created ? '已建立' : '已升级'}超级管理员 ${email}（免两步验证）` +
        (outcome.organizationId !== null
          ? `，平台统一 AI 配置组织 ID=${outcome.organizationId}`
          : '') +
        (personalOrganization ? `，并建立组织「${personalOrganization.name}」` : ''),
    )
    if (this.generatePassword) {
      // 仅此一次输出，不写日志文件、不入审计；请立即保存并在登录后修改。
      console.log(`生成的登录密码（仅显示一次）：${password}`)
    }
    this.logger.info(
      outcome.organizationId !== null
        ? '登录后切换到「平台统一 AI 配置」组织，在「AI 连接」页配置个人版用户共用的模型与 API key。'
        : '登录后可在「平台管理」里管理实例用户与审计日志；各组织在「设置 → AI 连接」里配置自己的模型与 API key。',
    )
  }
}

/** 24 位随机密码：保证含大写、小写、数字，满足 `#validators/user` 的密码策略。 */
export function generateStrongPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const all = upper + lower + digits
  const pick = (set: string) => set[randomInt(set.length)]
  const chars = [pick(upper), pick(lower), pick(digits)]
  while (chars.length < 24) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
