// AI 同事：成员代号〔成员·XXXXXXXX〕（模型只见代号，界面换回姓名）。
import { test } from '@japa/runner'
import {
  extractAliasCodes,
  memberAliasCode,
  pseudonymizeText,
  resolveAliasesToNames,
  type DirectoryMember,
} from '#services/ai_colleague/member_directory_service'
import MemberDirectoryService from '#services/ai_colleague/member_directory_service'

const ORG = 3
const member = (userId: number, name: string, email: string, projectIds: number[]) => ({
  userId,
  aliasCode: memberAliasCode(ORG, userId, 'test-key'),
  name,
  email,
  projectIds,
})
const members: DirectoryMember[] = [
  member(12, '王小明', 'xm@example.com', [1]),
  member(15, '张建设', 'zjs@example.com', [1]),
  member(21, '李小明', 'lxm@example.com', [2]),
  member(30, 'admin@example.com', 'admin@example.com', [1]),
]
const alias = (userId: number) => `〔成员·${members.find((m) => m.userId === userId)!.aliasCode}〕`

test.group('成员代号格式', () => {
  test('8 位 Crockford Base32：稳定、按组织不同、推不出用户 ID', ({ assert }) => {
    const code = memberAliasCode(ORG, 12, 'test-key')
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{8}$/)
    assert.equal(memberAliasCode(ORG, 12, 'test-key'), code)
    assert.notEqual(memberAliasCode(ORG + 1, 12, 'test-key'), code)
    assert.notEqual(memberAliasCode(ORG, 13, 'test-key'), code)
    assert.notEqual(memberAliasCode(ORG, 12, 'other-key'), code)
    assert.notInclude(code, '12')
  })

  test('不同成员代号不重复', ({ assert }) => {
    const codes = new Set(
      Array.from({ length: 2000 }, (_, i) => memberAliasCode(ORG, i + 1, 'test-key')),
    )
    assert.equal(codes.size, 2000)
  })
})

test.group('成员代号替换与还原', () => {
  test('全名任意位置替换；名字只在称呼词后替换；重名给出候选', ({ assert }) => {
    assert.equal(pseudonymizeText('把登录页指派给王小明', members), `把登录页指派给${alias(12)}`)
    assert.equal(pseudonymizeText('交给小明', members), `交给${alias(12)}或${alias(21)}`)
    assert.equal(pseudonymizeText('项目建设进度', members), '项目建设进度')
    assert.equal(pseudonymizeText('让建设跟进', members), `让${alias(15)}跟进`)
  })

  test('没填姓名的成员用邮箱前缀，按完整单词匹配', ({ assert }) => {
    assert.equal(pseudonymizeText('指派给 admin', members), `指派给 ${alias(30)}`)
    assert.equal(pseudonymizeText('打开 administrator 页面', members), '打开 administrator 页面')
  })

  test('代号换回姓名；不认识的代号显示为「某成员」；按代号找回用户', ({ assert }) => {
    const names = new Map([[members[0]!.aliasCode, '王小明']])
    assert.equal(resolveAliasesToNames(`${alias(12)}和〔成员·ZZZZZZZZ〕`, names), '王小明和某成员')
    assert.deepEqual(extractAliasCodes(`${alias(12)}、${alias(12)}、${alias(15)}`), [
      members[0]!.aliasCode,
      members[1]!.aliasCode,
    ])
    assert.equal(MemberDirectoryService.userIdByAlias(members, alias(21)), 21)
    assert.isNull(MemberDirectoryService.userIdByAlias(members, '〔成员·ZZZZZZZZ〕'))
  })
})
