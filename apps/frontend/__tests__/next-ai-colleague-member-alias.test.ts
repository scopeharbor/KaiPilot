import { describe, expect, test } from 'vitest'
import { resolveMemberAliases } from '@/components/next/ai/AiColleagueLiveAnswer'
import { extractMemberAliasCodes, hasMemberAlias } from '@/hooks/use-member-alias-names'

describe('AI 同事：成员代号换回真实姓名', () => {
  test('名单内换成姓名，名单外显示「某成员」', () => {
    const names = new Map([
      ['7KQ2M9XD', '许文静'],
      ['A1B2C3D4', '陈立峰'],
    ])
    expect(
      resolveMemberAliases(
        '负责人：〔成员·7KQ2M9XD〕；协助：〔成员·A1B2C3D4〕、〔成员·ZZZZZZZZ〕',
        names,
      ),
    ).toBe('负责人：许文静；协助：陈立峰、某成员')
  })

  test('只认新格式代号（8 位 Crockford Base32）', () => {
    expect(hasMemberAlias('交给〔成员·7KQ2M9XD〕')).toBe(true)
    expect(hasMemberAlias('交给〔成员#12〕')).toBe(false)
    expect(hasMemberAlias('〔成员·ILOU1234〕')).toBe(false)
    expect(extractMemberAliasCodes('〔成员·ZZZZZZZZ〕〔成员·7KQ2M9XD〕〔成员·7KQ2M9XD〕')).toEqual([
      '7KQ2M9XD',
      'ZZZZZZZZ',
    ])
  })
})
