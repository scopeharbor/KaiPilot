import { describe, expect, test } from 'vitest'
import {
  canUseEnterpriseFeatures,
  isEnterpriseRoute,
  isSaasPersonalWorkspace,
  personalSafeDestination,
  resolveWorkspaceEdition,
  SAAS_PERSONAL_WORKSPACES,
} from '@/lib/workspace-edition'

describe('workspace edition boundary', () => {
  test('free、缺失与未知会话按个人版处理', () => {
    expect(resolveWorkspaceEdition('free')).toBe('personal')
    expect(resolveWorkspaceEdition(null)).toBe('personal')
    expect(resolveWorkspaceEdition(undefined)).toBe('personal')
  })

  test('团队/企业套餐及系统管理员可使用企业入口', () => {
    expect(canUseEnterpriseFeatures('free')).toBe(false)
    expect(canUseEnterpriseFeatures('team')).toBe(true)
    expect(canUseEnterpriseFeatures('enterprise')).toBe(true)
    expect(canUseEnterpriseFeatures(null, true)).toBe(true)
  })

  test('识别企业直链及子路由，但不误伤个人版设置', () => {
    expect(isEnterpriseRoute('/settings/security/sso')).toBe(true)
    expect(isEnterpriseRoute('/settings/security/sso/providers/new')).toBe(true)
    expect(isEnterpriseRoute('/settings/profile')).toBe(false)
    expect(isEnterpriseRoute('/settings/organization')).toBe(false)
  })

  test('受限设置页返回个人资料，其余企业页返回仪表盘', () => {
    expect(personalSafeDestination('/settings/security/dlp')).toBe('/settings/profile')
    expect(personalSafeDestination('/admin/release-trust')).toBe('/dashboard')
  })

  test('「个人空间」展示只在私有 SaaS 语义开启时对免费套餐生效；开源个人版组织照常显示', () => {
    expect(isSaasPersonalWorkspace('free')).toBe(SAAS_PERSONAL_WORKSPACES)
    expect(isSaasPersonalWorkspace(null)).toBe(SAAS_PERSONAL_WORKSPACES)
    expect(isSaasPersonalWorkspace('team')).toBe(false)
    expect(isSaasPersonalWorkspace('enterprise')).toBe(false)
  })
})
