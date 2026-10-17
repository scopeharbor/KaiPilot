import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { isNextUiEnabledForOrg } from '@/lib/feature-flags/next-ui-gate'

const FF_NEXT_UI = 'NEXT_PUBLIC_FF_NEXT_UI'
const FF_NEXT_UI_ORGS = 'NEXT_PUBLIC_FF_NEXT_UI_ORGS'

/** 设置/清除门控环境变量（undefined = 删除）。 */
function setEnv(main?: string, orgs?: string) {
  if (main === undefined) delete process.env[FF_NEXT_UI]
  else process.env[FF_NEXT_UI] = main
  if (orgs === undefined) delete process.env[FF_NEXT_UI_ORGS]
  else process.env[FF_NEXT_UI_ORGS] = orgs
}

beforeEach(() => setEnv())
afterEach(() => setEnv())

describe('lib/feature-flags/next-ui-gate（v3-ui-next-track-foundation D-c）', () => {
  test('缺省未配置 → 全局关闭（Fail-Closed）', () => {
    expect(isNextUiEnabledForOrg(1)).toBe(false)
    expect(isNextUiEnabledForOrg(null)).toBe(false)
  })

  test('显式 false / 不可识别值 → 全局关闭', () => {
    setEnv('false')
    expect(isNextUiEnabledForOrg(1)).toBe(false)
    expect(isNextUiEnabledForOrg(42)).toBe(false)

    setEnv('garbage')
    expect(isNextUiEnabledForOrg(1)).toBe(false)

    setEnv('')
    expect(isNextUiEnabledForOrg(1)).toBe(false)
  })

  test('主开关 true 且未配白名单 → 全组织放行', () => {
    setEnv('true')
    expect(isNextUiEnabledForOrg(1)).toBe(true)
    expect(isNextUiEnabledForOrg(42)).toBe(true)
  })

  test('主开关 true 且配白名单 → 按白名单放行', () => {
    setEnv('true', '1, 2 ,5')
    expect(isNextUiEnabledForOrg(1)).toBe(true)
    expect(isNextUiEnabledForOrg(5)).toBe(true)
    expect(isNextUiEnabledForOrg(3)).toBe(false)
  })

  test('主开关 1 / on / * 同 true', () => {
    setEnv('1')
    expect(isNextUiEnabledForOrg(9)).toBe(true)
    setEnv('on')
    expect(isNextUiEnabledForOrg(9)).toBe(true)
    setEnv('*')
    expect(isNextUiEnabledForOrg(9)).toBe(true)
  })

  test('org_allowlist 模式按白名单放行；白名单为空则无人可用', () => {
    setEnv('org_allowlist', '1,2')
    expect(isNextUiEnabledForOrg(1)).toBe(true)
    expect(isNextUiEnabledForOrg(2)).toBe(true)
    expect(isNextUiEnabledForOrg(3)).toBe(false)

    setEnv('org_allowlist')
    expect(isNextUiEnabledForOrg(1)).toBe(false)
  })

  test('组织 ID 为空 / 未定义时一律降级拦截（即使主开关全开）', () => {
    setEnv('true')
    expect(isNextUiEnabledForOrg(null)).toBe(false)
    expect(isNextUiEnabledForOrg(undefined)).toBe(false)

    setEnv('org_allowlist', '1')
    expect(isNextUiEnabledForOrg(null)).toBe(false)

    setEnv('false', '1')
    expect(isNextUiEnabledForOrg(1)).toBe(false)
  })

  test('白名单中的非法条目被忽略，不影响合法条目', () => {
    setEnv('true', '1,abc,,2,   ')
    expect(isNextUiEnabledForOrg(1)).toBe(true)
    expect(isNextUiEnabledForOrg(2)).toBe(true)
    expect(isNextUiEnabledForOrg(3)).toBe(false)
  })
})
