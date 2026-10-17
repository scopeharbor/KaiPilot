import { test } from '@japa/runner'
import ace from '@adonisjs/core/services/ace'
import UserCreate from '#start/commands/user_create'
import User from '#models/user'
import OrganizationMember from '#models/organization_member'
import { createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'

/**
 * user:create（个人版导出 7.2 冒烟发现）：个人版没有注册页，组织「邀请成员」又要求对方已有账号；
 * 实例管理员用这个命令给成员建普通账号，之后按邮箱邀请进组织。
 */
const PASSWORD_PREFIX = '生成的登录密码（仅显示一次）：'

async function run(args: string[]) {
  const captured: string[] = []
  const originalLog = console.log
  console.log = (...parts: unknown[]) => captured.push(parts.join(' '))
  try {
    const command = await ace.create(UserCreate, args)
    await command.exec()
    return { exitCode: command.exitCode ?? 0, captured }
  } finally {
    console.log = originalLog
  }
}

test.group('user:create', (group) => {
  useAuthDatabase(group)

  test('建立普通账号：不是超级管理员、不加入组织、可登录', async ({ assert, client }) => {
    const email = uniqueEmail('member')
    const { exitCode, captured } = await run(['--email', email, '--generate-password'])
    assert.equal(exitCode, 0)
    const line = captured.find((l) => l.startsWith(PASSWORD_PREFIX))
    assert.exists(line)
    const password = line!.slice(PASSWORD_PREFIX.length).trim()

    const user = await User.findByOrFail('email', email)
    assert.isFalse(user.isSuperAdmin)
    assert.isTrue(user.createdAt.isValid)
    const memberships = await OrganizationMember.query().where('userId', user.id)
    assert.lengthOf(memberships, 0)

    const login = await client.post('/api/v1/auth/login').json({ email, password })
    assert.equal(login.status(), 200)
  })

  test('账号已存在时失败，不修改原账号', async ({ assert }) => {
    const email = uniqueEmail('existing')
    const existing = await createUser({ email })
    const before = existing.password
    const { exitCode, captured } = await run(['--email', email, '--generate-password'])
    assert.equal(exitCode, 1)
    assert.isFalse(captured.some((l) => l.startsWith(PASSWORD_PREFIX)))
    const after = await User.findByOrFail('email', email)
    assert.equal(after.password, before)
  })
})
