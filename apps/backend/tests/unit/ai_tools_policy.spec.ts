/**
 * v3-ai-tools-orchestration-layer —— AiToolsPolicy 单元测试（tasks W1 1.6）。
 *
 * 覆盖：缺少 ai:trigger 抛 403 PERMISSION_DENIED；拥有 ai:trigger 但缺领域权限抛 403；
 * 超级管理员免校验通行；确认接口缺少 ai:confirm 抛 403；
 * RL-05：跨组织 projectId（rbac reason 'cross_org_denied'）必须映射 404 RESOURCE_NOT_FOUND。
 * 纯构造注入（fake RbacService），零数据库。
 */
import { describe, expect, it } from 'vitest'
import {
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../app/exceptions/api_exception.js'
import AiToolsPolicy from '../../app/policies/ai_tools_policy.js'
import type User from '../../app/models/user.js'

type CheckFn = (
  permission: string,
  organizationId: number,
  projectId?: number,
) => {
  allowed: boolean
  reason?: string
}

function makeUser(overrides: Partial<{ id: number; isSuperAdmin: boolean }> = {}): User {
  return {
    id: overrides.id ?? 7,
    isSuperAdmin: overrides.isSuperAdmin ?? false,
  } as unknown as User
}

function makePolicy(checkFn: CheckFn): AiToolsPolicy {
  return new AiToolsPolicy({
    check: async (_user: User, permission: string, organizationId: number, projectId?: number) =>
      checkFn(permission, organizationId, projectId),
  } as never)
}

const PROJECT_VIEW = 'project:view'
const TASK_VIEW = 'task:view'
const TASK_UPDATE = 'task:update'

describe('AiToolsPolicy.authorizeExecute', () => {
  it('超级管理员免校验通行（即使 rbac 全拒）', async () => {
    const policy = makePolicy(() => ({ allowed: false }))
    const admin = makeUser({ id: 1, isSuperAdmin: true })
    await expect(
      policy.authorizeExecute(admin, 1, [PROJECT_VIEW, TASK_UPDATE], 10),
    ).resolves.toBeUndefined()
  })

  it('缺少 ai:trigger 抛 403 PERMISSION_DENIED（连领域权限都不查）', async () => {
    let domainChecked = false
    const policy = makePolicy((permission) => {
      if (permission === 'ai:trigger') return { allowed: false }
      domainChecked = true
      return { allowed: true }
    })
    const user = makeUser()
    try {
      await policy.authorizeExecute(user, 1, [PROJECT_VIEW], 10)
      expect.unreachable('应当抛出 PermissionDeniedException')
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedException)
      expect((error as PermissionDeniedException).status).toBe(403)
      expect((error as PermissionDeniedException).code).toBe('PERMISSION_DENIED')
    }
    expect(domainChecked).toBe(false)
  })

  it('拥有 ai:trigger 但缺领域权限抛 403，并指明缺失权限', async () => {
    const policy = makePolicy((permission) => ({
      allowed: permission === 'ai:trigger' || permission === PROJECT_VIEW,
    }))
    const user = makeUser()
    try {
      await policy.authorizeExecute(user, 1, [PROJECT_VIEW, TASK_VIEW], 10)
      expect.unreachable('应当抛出 PermissionDeniedException')
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedException)
      expect((error as PermissionDeniedException).message).toContain(TASK_VIEW)
      expect((error as PermissionDeniedException).status).toBe(403)
    }
  })

  it('全部权限齐备时放行', async () => {
    const policy = makePolicy(() => ({ allowed: true }))
    const user = makeUser()
    await expect(
      policy.authorizeExecute(user, 1, [PROJECT_VIEW, TASK_VIEW], 10),
    ).resolves.toBeUndefined()
  })

  it('RL-05：跨组织 projectId（cross_org_denied）映射 404 RESOURCE_NOT_FOUND，严禁 403', async () => {
    const policy = makePolicy((permission) => {
      if (permission === 'ai:trigger') return { allowed: true }
      return { allowed: false, reason: 'cross_org_denied' }
    })
    const user = makeUser()
    try {
      await policy.authorizeExecute(user, 1, [PROJECT_VIEW], 999)
      expect.unreachable('应当抛出 ResourceNotFoundException')
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceNotFoundException)
      expect((error as ResourceNotFoundException).status).toBe(404)
      expect((error as ResourceNotFoundException).code).toBe('RESOURCE_NOT_FOUND')
    }
  })

  it('空权限清单只校验 ai:trigger', async () => {
    let domainChecked = false
    const policy = makePolicy((permission) => {
      if (permission === 'ai:trigger') return { allowed: true }
      domainChecked = true
      return { allowed: true }
    })
    const user = makeUser()
    await expect(policy.authorizeExecute(user, 1, [], 10)).resolves.toBeUndefined()
    expect(domainChecked).toBe(false)
  })
})

describe('AiToolsPolicy.authorizeConfirm', () => {
  it('缺少 ai:confirm 抛 403 PERMISSION_DENIED', async () => {
    const policy = makePolicy((permission) => ({
      allowed: permission === 'ai:confirm' ? false : true,
    }))
    try {
      await policy.authorizeConfirm(makeUser(), 1, [TASK_UPDATE], 10)
      expect.unreachable('应当抛出 PermissionDeniedException')
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedException)
      expect((error as PermissionDeniedException).code).toBe('PERMISSION_DENIED')
      expect((error as PermissionDeniedException).message).toContain('ai:confirm')
    }
  })

  it('拥有 ai:confirm 但缺写权限（如 task:update）抛 403', async () => {
    const policy = makePolicy((permission) => ({
      allowed: permission === 'ai:confirm' || permission === PROJECT_VIEW,
    }))
    try {
      await policy.authorizeConfirm(makeUser(), 1, [TASK_UPDATE], 10)
      expect.unreachable('应当抛出 PermissionDeniedException')
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedException)
      expect((error as PermissionDeniedException).message).toContain(TASK_UPDATE)
      expect((error as PermissionDeniedException).status).toBe(403)
    }
  })

  it('超级管理员确认直接放行', async () => {
    const policy = makePolicy(() => ({ allowed: false }))
    await expect(
      policy.authorizeConfirm(makeUser({ isSuperAdmin: true }), 1, [TASK_UPDATE], 10),
    ).resolves.toBeUndefined()
  })

  it('跨组织 projectId 在确认路径同样映射 404', async () => {
    const policy = makePolicy((permission) => {
      if (permission === 'ai:confirm') return { allowed: true }
      return { allowed: false, reason: 'cross_org_denied' }
    })
    try {
      await policy.authorizeConfirm(makeUser(), 1, [TASK_UPDATE], 999)
      expect.unreachable('应当抛出 ResourceNotFoundException')
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceNotFoundException)
      expect((error as ResourceNotFoundException).status).toBe(404)
    }
  })
})
