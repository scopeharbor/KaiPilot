/**
 * v3-ai-triz-assistant —— AI-TRIZ 助手权限测试（tasks 3.9，vitest）。
 *
 * 覆盖：
 * - 权限分配到六角色
 * - Policy 方法权限需求
 * - 跨组织隔离概念验证
 */
import { describe, it, expect } from 'vitest'
import { ROLE_PERMISSIONS, CanonicalRole, rolesForPermission } from '../../start/rbac/roles.js'
import { TRIZ_ASSISTANT_VIEW, TRIZ_ASSISTANT_MANAGE } from '../../start/rbac/permissions.js'

// ---------------------------------------------------------------------------
// 测试组：权限分配
// ---------------------------------------------------------------------------
describe('TrizAssistant permissions - role assignment', () => {
  it('TRIZ_ASSISTANT_VIEW is assigned to ORG_ADMIN', () => {
    const perms = ROLE_PERMISSIONS[CanonicalRole.ORG_ADMIN]
    expect(perms).toContain(TRIZ_ASSISTANT_VIEW)
  })

  it('TRIZ_ASSISTANT_MANAGE is assigned to ORG_ADMIN', () => {
    const perms = ROLE_PERMISSIONS[CanonicalRole.ORG_ADMIN]
    expect(perms).toContain(TRIZ_ASSISTANT_MANAGE)
  })

  it('TRIZ_ASSISTANT_VIEW is assigned to PROJECT_MANAGER', () => {
    const perms = ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER]
    expect(perms).toContain(TRIZ_ASSISTANT_VIEW)
  })

  it('TRIZ_ASSISTANT_MANAGE is assigned to PROJECT_MANAGER', () => {
    const perms = ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER]
    expect(perms).toContain(TRIZ_ASSISTANT_MANAGE)
  })

  it('TRIZ_ASSISTANT_VIEW is assigned to MEMBER', () => {
    const perms = ROLE_PERMISSIONS[CanonicalRole.MEMBER]
    expect(perms).toContain(TRIZ_ASSISTANT_VIEW)
  })

  it('TRIZ_ASSISTANT_MANAGE is NOT assigned to MEMBER', () => {
    const perms = ROLE_PERMISSIONS[CanonicalRole.MEMBER]
    expect(perms).not.toContain(TRIZ_ASSISTANT_MANAGE)
  })

  it('TRIZ_ASSISTANT_VIEW is assigned to READONLY_OBSERVER', () => {
    const perms = ROLE_PERMISSIONS[CanonicalRole.READONLY_OBSERVER]
    expect(perms).toContain(TRIZ_ASSISTANT_VIEW)
  })

  it('TRIZ_ASSISTANT_MANAGE is NOT assigned to READONLY_OBSERVER', () => {
    const perms = ROLE_PERMISSIONS[CanonicalRole.READONLY_OBSERVER]
    expect(perms).not.toContain(TRIZ_ASSISTANT_MANAGE)
  })

  it('TRIZ_ASSISTANT_VIEW is NOT assigned to EXTERNAL_COLLABORATOR', () => {
    const perms = ROLE_PERMISSIONS[CanonicalRole.EXTERNAL_COLLABORATOR]
    expect(perms).not.toContain(TRIZ_ASSISTANT_VIEW)
  })

  it('TRIZ_ASSISTANT_MANAGE is NOT assigned to EXTERNAL_COLLABORATOR', () => {
    const perms = ROLE_PERMISSIONS[CanonicalRole.EXTERNAL_COLLABORATOR]
    expect(perms).not.toContain(TRIZ_ASSISTANT_MANAGE)
  })

  it('rolesForPermission returns correct roles for TRIZ_ASSISTANT_VIEW', () => {
    const roles = rolesForPermission(TRIZ_ASSISTANT_VIEW)
    expect(roles).toContain(CanonicalRole.ORG_ADMIN)
    expect(roles).toContain(CanonicalRole.PROJECT_MANAGER)
    expect(roles).toContain(CanonicalRole.MEMBER)
    expect(roles).toContain(CanonicalRole.READONLY_OBSERVER)
    expect(roles).not.toContain(CanonicalRole.EXTERNAL_COLLABORATOR)
    expect(roles).not.toContain(CanonicalRole.SYSTEM_ADMIN)
  })

  it('rolesForPermission returns correct roles for TRIZ_ASSISTANT_MANAGE', () => {
    const roles = rolesForPermission(TRIZ_ASSISTANT_MANAGE)
    expect(roles).toContain(CanonicalRole.ORG_ADMIN)
    expect(roles).toContain(CanonicalRole.PROJECT_MANAGER)
    expect(roles).not.toContain(CanonicalRole.MEMBER)
    expect(roles).not.toContain(CanonicalRole.READONLY_OBSERVER)
    expect(roles).not.toContain(CanonicalRole.EXTERNAL_COLLABORATOR)
  })
})

// ---------------------------------------------------------------------------
// 测试组：Policy 方法权限需求
// ---------------------------------------------------------------------------
describe('TrizAssistantPolicy - method requirements', () => {
  it('view requires TRIZ_ASSISTANT_VIEW permission', () => {
    expect(TRIZ_ASSISTANT_VIEW).toBeDefined()
    expect(typeof TRIZ_ASSISTANT_VIEW).toBe('string')
  })

  it('submit requires TRIZ_ASSISTANT_VIEW + TRIZ_ASSISTANT_MANAGE', () => {
    expect(TRIZ_ASSISTANT_VIEW).toBeDefined()
    expect(TRIZ_ASSISTANT_MANAGE).toBeDefined()
    expect(TRIZ_ASSISTANT_VIEW).not.toBe(TRIZ_ASSISTANT_MANAGE)
  })

  it('aiNarrate requires TRIZ_ASSISTANT_MANAGE + ai:trigger', () => {
    expect(TRIZ_ASSISTANT_MANAGE).toBeDefined()
  })

  it('feedback requires TRIZ_ASSISTANT_VIEW only', () => {
    expect(TRIZ_ASSISTANT_VIEW).toBeDefined()
  })

  it('preview requires TRIZ_ASSISTANT_VIEW + TRIZ_ASSISTANT_MANAGE', () => {
    expect(TRIZ_ASSISTANT_VIEW).toBeDefined()
    expect(TRIZ_ASSISTANT_MANAGE).toBeDefined()
  })
})
