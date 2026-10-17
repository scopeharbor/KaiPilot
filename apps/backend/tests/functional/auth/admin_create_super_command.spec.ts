import { test } from '@japa/runner'
import ace from '@adonisjs/core/services/ace'
import AdminCreateSuper from '#start/commands/admin_create_super'
import User from '#models/user'
import OrganizationMember from '#models/organization_member'
import {
  editionHooks,
  registerEditionHooks,
  resetEditionHooksForTests,
} from '#services/edition/edition_registry'
import { uniqueEmail, useAuthDatabase } from './_helpers.js'

/**
 * 回归测试（个人版导出 7.2 冒烟发现，按 README 第 4 步建管理员后无法开始使用）：
 * 1. 命令绕过模型直接写 users，原先把 JS Date 写进 created_at，SQLite 存成毫秒数；模型读回时报
 *    「Invalid value for "User.createdAt". number cannot be formatted」，新管理员一登录就 500。
 * 2. 个人版没有平台统一 AI 配置组织，管理员不属于任何组织，登录后无法添加 AI 连接或建项目；
 *    现在个人版会给还没有组织的管理员建立一个默认组织（再次执行不重复建）。
 */
const PASSWORD_PREFIX = '生成的登录密码（仅显示一次）：'

async function runTwice(email: string): Promise<string> {
  const captured: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => captured.push(args.join(' '))
  try {
    for (let round = 0; round < 2; round += 1) {
      const command = await ace.create(AdminCreateSuper, ['--email', email, '--generate-password'])
      await command.exec()
      if ((command.exitCode ?? 0) !== 0) throw new Error(`第 ${round + 1} 次执行失败`)
    }
  } finally {
    console.log = originalLog
  }
  const lines = captured.filter((l) => l.startsWith(PASSWORD_PREFIX))
  if (lines.length !== 2) throw new Error('没有截到两次生成的密码')
  return lines[1].slice(PASSWORD_PREFIX.length).trim()
}

test.group('admin:create-super', (group) => {
  useAuthDatabase(group)

  test('个人版：账号时间戳可被模型读取、可登录，并恰好拥有一个自建组织', async ({
    assert,
    client,
  }) => {
    const previous = resetEditionHooksForTests()
    try {
      const email = uniqueEmail('super-personal')
      const password = await runTwice(email)

      const user = await User.findByOrFail('email', email)
      assert.isTrue(user.createdAt.isValid)
      assert.isTrue(user.isSuperAdmin)
      const memberships = await OrganizationMember.query().where('userId', user.id)
      assert.lengthOf(memberships, 1, '再次执行不重复建组织')
      assert.equal(memberships[0].role, 'owner')

      const login = await client.post('/api/v1/auth/login').json({ email, password })
      assert.equal(login.status(), 200)
    } finally {
      registerEditionHooks(previous)
    }
  })

  test('当前部署的扩展点下：新建与升级后的时间戳有效且可登录', async ({ assert, client }) => {
    const email = uniqueEmail('super-current')
    const password = await runTwice(email)
    const user = await User.findByOrFail('email', email)
    assert.isTrue(user.createdAt.isValid)
    if (editionHooks().platformAi) {
      // 私有部署走平台统一 AI 配置组织，不额外建个人组织
      const memberships = await OrganizationMember.query().where('userId', user.id)
      assert.isAtMost(memberships.length, 1)
    }
    const login = await client.post('/api/v1/auth/login').json({ email, password })
    assert.equal(login.status(), 200)
  })
})
