/**
 * AI 同事意图规则分发单测——设置空间 / 管理后台 / 项目设置（W9 · tasks 9.7）。
 *
 * 测试全域设置规则（lens=settings + target 分派）、管理后台规则（lens=admin + target）、
 * 项目设置规则（lens=project_settings + projectId 注入）的命中、参数产出、次序守卫
 * （项目设置先于设置、admin 审计先于组织审计）与既有规则回归。
 */
import { describe, expect, it } from 'vitest'
import {
  ContextMissingError,
  parseColleagueIntent,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'

const PROJECT_CONTEXT: ColleagueContext = {
  contextType: 'project_space',
  currentProjectId: 42,
  pathname: '/next/projects/42',
}

const GLOBAL_CONTEXT: ColleagueContext = {
  contextType: 'role_home',
  currentProjectId: null,
  pathname: '/next',
}

// ---------------------------------------------------------------------------
// 设置空间规则（tasks 9.5）
// ---------------------------------------------------------------------------
describe('settings 系规则命中', () => {
  it('「打开设置中心」→ lens=settings', () => {
    const result = parseColleagueIntent('打开设置中心', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings',
      confidence: 1,
    })
    expect(result.parameters).toMatchObject({ lens: 'settings' })
  })

  it('「去个人资料」→ settings + target=profile', () => {
    const result = parseColleagueIntent('去个人资料', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_profile',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'profile' })
  })

  it('「管理组织成员」→ settings + target=organization', () => {
    const result = parseColleagueIntent('管理组织成员管理', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_organization',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'organization' })
  })

  it('「打开两步验证」→ settings + target=security/two-factor', () => {
    const result = parseColleagueIntent('打开两步验证', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_two_factor',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'security/two-factor' })
  })

  it('「配置单点登录」→ settings + target=security/sso', () => {
    const result = parseColleagueIntent('配置单点登录', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_sso',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'security/sso' })
  })

  it('「查看 kms 密钥」→ settings + target=security/kms', () => {
    const result = parseColleagueIntent('查看 kms 密钥', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_kms',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'security/kms' })
  })

  it('「查看 dlp 防泄漏」→ settings + target=security/dlp', () => {
    const result = parseColleagueIntent('查看 dlp 防泄漏', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_dlp',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'security/dlp' })
  })

  it('「查看合规准备度」→ settings + target=security/compliance', () => {
    const result = parseColleagueIntent('查看合规准备度', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_compliance',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'security/compliance' })
  })

  it('「ai 用量」→ settings + target=ai-usage', () => {
    const result = parseColleagueIntent('查看 ai 用量', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_ai',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'ai-usage' })
  })

  it('「编译器技能注册」→ settings + target=compiler-skills', () => {
    const result = parseColleagueIntent('查看编译器技能', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_ai',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'compiler-skills' })
  })

  it('「ai 连接」→ settings + target=ai-connections', () => {
    const result = parseColleagueIntent('配置 ai 连接', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_ai',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'ai-connections' })
  })

  it('「第三方集成」→ settings + target=integrations', () => {
    const result = parseColleagueIntent('打开第三方集成', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_integrations',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'integrations' })
  })
})

// ---------------------------------------------------------------------------
// 管理后台规则（tasks 9.6）
// ---------------------------------------------------------------------------
describe('admin 系规则命中', () => {
  it.each([
    '打开 Google 登录账号管理设置',
    '查看 Google 登录用户的 AI 使用',
    '管理 Google 登入帳號',
    '打开 Google login accounts',
    '查看用户的 Google 登录',
  ])('%s → admin/users', (input) => {
    const result = parseColleagueIntent(input, GLOBAL_CONTEXT)
    expect(result.parameters).toMatchObject({ lens: 'admin', target: 'users' })
  })

  it.each(['配置 Google Calendar 第三方集成', '打开 OAuth 连接'])('%s 保持集成入口', (input) => {
    expect(parseColleagueIntent(input, GLOBAL_CONTEXT).parameters).toMatchObject({
      lens: 'settings',
      target: 'integrations',
    })
  })

  it('「打开管理后台」→ lens=admin', () => {
    const result = parseColleagueIntent('打开管理后台', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_admin',
      confidence: 1,
    })
    expect(result.parameters).toMatchObject({ lens: 'admin' })
  })

  it('「用户管理」→ admin + target=users', () => {
    const result = parseColleagueIntent('打开用户管理', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_admin_users',
    })
    expect(result.parameters).toMatchObject({ lens: 'admin', target: 'users' })
  })

  it('「平台审计日志」→ admin + target=audit-logs', () => {
    const result = parseColleagueIntent('打开平台审计日志', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_admin_audit',
    })
    expect(result.parameters).toMatchObject({ lens: 'admin', target: 'audit-logs' })
  })

  it('「全局多租户」→ admin + target=multitenancy', () => {
    const result = parseColleagueIntent('查看全局多租户', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_admin_tenancy',
    })
    expect(result.parameters).toMatchObject({ lens: 'admin', target: 'multitenancy' })
  })

  it('「ai 质量成本控制台」→ admin + target=ai-quality-cost', () => {
    const result = parseColleagueIntent('查看成本控制台', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_admin_quality_cost',
    })
    expect(result.parameters).toMatchObject({ lens: 'admin', target: 'ai-quality-cost' })
  })

  it('「编译器路由规则」→ admin + target=compiler-routing', () => {
    const result = parseColleagueIntent('配置编译器路由', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_admin_routing',
    })
    expect(result.parameters).toMatchObject({ lens: 'admin', target: 'compiler-routing' })
  })

  it('「发布信任中心」→ admin + target=release-trust', () => {
    const result = parseColleagueIntent('查看发布信任', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_admin_release_trust',
    })
    expect(result.parameters).toMatchObject({ lens: 'admin', target: 'release-trust' })
  })
})

// ---------------------------------------------------------------------------
// 审计日志歧义词分派
// ---------------------------------------------------------------------------
describe('审计日志歧义词分派', () => {
  it('「查看审计日志」（无前缀）→ settings/audit-logs（组织审计）', () => {
    const result = parseColleagueIntent('查看审计日志', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings_audit',
    })
    expect(result.parameters).toMatchObject({ lens: 'settings', target: 'audit-logs' })
  })

  it('「全局审计日志」→ admin/audit-logs', () => {
    const result = parseColleagueIntent('查看全局审计', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_admin_audit',
    })
    expect(result.parameters).toMatchObject({ lens: 'admin', target: 'audit-logs' })
  })

  it('「系统审计」→ admin/audit-logs', () => {
    const result = parseColleagueIntent('打开系统审计', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      matchedRuleId: 'rule_nav_admin_audit',
    })
  })
})

// ---------------------------------------------------------------------------
// 项目设置（tasks 9.5 第一条规则）
// ---------------------------------------------------------------------------
describe('项目设置规则', () => {
  it('「项目设置」→ project_settings + projectId', () => {
    const result = parseColleagueIntent('打开项目设置', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_project_settings',
      confidence: 1,
    })
    expect(result.parameters).toMatchObject({
      lens: 'project_settings',
      projectId: 42,
    })
  })

  it('「改工作日历」→ project_settings + projectId', () => {
    const result = parseColleagueIntent('修改工作日历', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_project_settings',
    })
    expect(result.parameters).toMatchObject({
      lens: 'project_settings',
      projectId: 42,
    })
  })

  it('全局视图「项目设置」→ ContextMissingError', () => {
    expect(() => parseColleagueIntent('打开项目设置', GLOBAL_CONTEXT)).toThrow(ContextMissingError)
  })

  it('「配置节假日设置」→ project_settings', () => {
    const result = parseColleagueIntent('配置节假日设置', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      matchedRuleId: 'rule_nav_project_settings',
    })
  })
})

// ---------------------------------------------------------------------------
// 规则次序守卫与既有规则回归
// ---------------------------------------------------------------------------
describe('规则次序与回归', () => {
  it('「项目设置」先于「设置」（rule_nav_project_settings 先于 rule_nav_settings）', () => {
    const result = parseColleagueIntent('打开项目设置', PROJECT_CONTEXT)
    expect(result.matchedRuleId).toBe('rule_nav_project_settings')
  })

  it('「去首页」仍命中 rule_nav_home', () => {
    const result = parseColleagueIntent('去首页', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_home',
    })
    expect(result.parameters).toMatchObject({ lens: 'overview' })
  })

  it('「回工作台」仍命中 rule_nav_home', () => {
    const result = parseColleagueIntent('回工作台', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      matchedRuleId: 'rule_nav_home',
    })
  })

  it('「去甘特图」仍命中 rule_nav_gantt', () => {
    const result = parseColleagueIntent('去甘特图', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_gantt',
    })
  })

  it('「组织概览」命中 rule_nav_org_overview（不被 settings_organization 抢）', () => {
    const result = parseColleagueIntent('查看组织概览', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      matchedRuleId: 'rule_nav_org_overview',
    })
  })

  it('「组织总览」命中 rule_nav_org_overview', () => {
    const result = parseColleagueIntent('打开组织总览', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      matchedRuleId: 'rule_nav_org_overview',
    })
  })

  it('「项目概况」仍命中 rule_query_summary', () => {
    const result = parseColleagueIntent('项目概况', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      toolName: 'get_project_summary',
      matchedRuleId: 'rule_query_summary',
    })
  })

  it('设置规则不吞 PMO 规则（「组合仪表盘」→ pmo）', () => {
    const result = parseColleagueIntent('打开组合仪表盘', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      matchedRuleId: 'rule_nav_pmo_overview',
    })
  })

  it('设置规则不吞帮助规则（「帮助中心」→ help）', () => {
    const result = parseColleagueIntent('打开帮助中心', PROJECT_CONTEXT)
    expect(result).toMatchObject({
      matchedRuleId: 'rule_nav_help',
    })
  })
})
