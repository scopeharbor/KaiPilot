/**
 * v3-copilot-optional-web-search-configuration §B —— 设置管理 Policy 单元测试。
 *
 * 覆盖 manage 判定：有 `copilot:web_search:manage` 权限 → allowed；
 * 无权限 → denied（不泄露更多信息）。
 */

import { describe, expect, it, vi } from 'vitest'
import type User from '#models/user'
import type RbacService from '#services/rbac_service'
import CopilotWebSearchPolicy from '#policies/copilot_web_search_policy'
import { COPILOT_WEB_SEARCH_MANAGE } from '#rbac'

function makeRbac(allowed: boolean): RbacService {
  return {
    check: vi.fn(async () => ({ allowed })),
  } as unknown as RbacService
}

const user = { id: 10 } as User

describe('Copilot web search settings policy', () => {
  it('manage allowed when actor holds copilot:web_search:manage', async () => {
    const policy = new CopilotWebSearchPolicy(makeRbac(true))
    const allowed = await policy.manage(user, 1)
    expect(allowed).toBe(true)
  })

  it('manage denied without the permission (non-leaking)', async () => {
    const policy = new CopilotWebSearchPolicy(makeRbac(false))
    const allowed = await policy.manage(user, 1)
    expect(allowed).toBe(false)
  })

  it('check uses the registered permission constant', async () => {
    const rbac = makeRbac(true)
    const policy = new CopilotWebSearchPolicy(rbac)
    await policy.manage(user, 1)
    expect(rbac.check).toHaveBeenCalledWith(user, COPILOT_WEB_SEARCH_MANAGE, 1)
  })
})
