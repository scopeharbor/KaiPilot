import { describe, it, expect } from 'vitest'
import {
  cockpitTargetAriaLabel,
  resolveCockpitTargetHref,
} from '@/lib/strategy-execution-cockpit-nav'

describe('strategy-execution-cockpit-nav safe navigation adapter', () => {
  it('authorized target 返回 href', () => {
    expect(
      resolveCockpitTargetHref({
        kind: 'okr_objective',
        href: '/organizations/1/okrs?objective=1',
        authorized: true,
      }),
    ).toBe('/organizations/1/okrs?objective=1')
  })

  it('unauthorized / null target 返回 #（不发起 mutation）', () => {
    expect(resolveCockpitTargetHref(null)).toBe('#')
    expect(
      resolveCockpitTargetHref({ kind: 'pmo_portfolio', href: '/pmo', authorized: false }),
    ).toBe('#')
  })

  it('aria label 只含 kind 与授权标记，不含敏感实体', () => {
    const label = cockpitTargetAriaLabel({ kind: 'pmo_portfolio', href: '/pmo', authorized: true })
    expect(label).toContain('pmo_portfolio')
    expect(label).toContain('工作台')
    expect(label).not.toContain('token')
    expect(label).not.toContain('Authorization')
  })
})
