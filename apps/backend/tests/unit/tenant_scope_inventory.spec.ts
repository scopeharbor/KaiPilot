// v3-multitenant-isolation-architecture §4.5 —— 租户 scope 迁移 inventory 覆盖测试。
//
// 目的不是一次性改造全部长尾路径（design Risk 3 明确按风险分批），而是：
// 1) 对已清零的高风险模式建立回归护栏——新增违规立即失败；
// 2) 把尚未迁移的路径按风险分类列出，让 gap 可见、可排期，避免"隐性未覆盖"。
//
// 扫描的是 controller 源码文本，不依赖运行时，因此可在 unit suite 离线执行。
import { test } from '@japa/runner'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import TenantScopeRegistry from '#services/tenant_scope_registry'

const CONTROLLERS_DIR = join(process.cwd(), 'app', 'controllers')

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full))
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

function relative(file: string): string {
  return file.slice(process.cwd().length + 1).replace(/\\/g, '/')
}

/** 去掉行注释与块注释，避免把说明文字里的示例当成真实代码。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

interface Finding {
  file: string
  line: number
  snippet: string
}

function scan(pattern: RegExp, exclude?: RegExp): Finding[] {
  const findings: Finding[] = []
  for (const file of listSourceFiles(CONTROLLERS_DIR)) {
    const lines = stripComments(readFileSync(file, 'utf-8')).split(/\r?\n/)
    lines.forEach((text, index) => {
      if (!pattern.test(text)) return
      if (exclude && exclude.test(text)) return
      findings.push({ file: relative(file), line: index + 1, snippet: text.trim() })
    })
  }
  return findings
}

function describe(findings: Finding[]): string {
  return findings.map((f) => `${f.file}:${f.line} — ${f.snippet}`).join('\n')
}

/**
 * 已核准的豁免（按文件登记，避免行号漂移）。
 * 每条都必须写明为什么该来源不是客户端可控输入——新增豁免须同步 change 文档。
 */
const CLIENT_ORG_EXEMPTIONS: Record<string, string> = {
  // JWT access payload 由服务端签发并经 auth middleware 校验，不是请求体输入。
  'app/controllers/auth_controller.ts': 'JWT payload（服务端签发）',
  // payload 是 buildForecastAiAdvisoryAuditPayload 的返回值，其 organizationId
  // 来自路由参数解析后的 organizationId，不来自请求体。
  'app/controllers/resource_demand_forecasting_controller.ts': '审计 payload（由已解析组织构造）',
  // 组织选择端点（v3-multitenant-tenant-identification §4）：payload.organizationId 是
  // **切换目标**而非当前 scope 事实源；OrganizationSelectionService.select 会用服务端
  // membership + roleVersion 新鲜度判定该目标是否可选，拒绝时不改动任何组织态。
  // 该端点是租户切换的唯一入口，客户端必须能指定目标组织。
  'app/controllers/organization_selection_controller.ts': '组织切换目标（服务端 membership 校验）',
}

/**
 * 平台级模型查找豁免（按文件登记，避免行号漂移）。
 * 本扫描器守的是「跨租户可达的客户端 ID 必须经 TenantScopeService 界定租户范围」；
 * 登记在此的查找，其目标表在隔离目录中本身就不是组织直挂表（无单一租户 scope 可界定），
 * 跨租户可达是该端点的设计职责而非缺口。新增豁免须同步 change 文档。
 */
const MODEL_FIND_EXEMPTIONS: Record<string, string> = {
  // adminReset（two_factor_controller.ts:136-161，源码真实行号；剥注释后行号漂到 :109）是
  // `system:admin` 平台级 2FA 重置——用户认证器与恢复码全丢时的唯一兜底。目标 users 表在
  // 隔离目录中即 system-global-maintenance（用户可属多组织，无 organization_id），
  // findInScopeOrFail 没有可用 scope 可界定；跨租户可达由 :138-141 的 system:admin 门
  // （明确不接受组织级管理员）+ 强制审计留痕约束。豁免不动 :145-151 的中性
  // ResourceNotFoundException（'用户不存在'）语义：非法/不存在的 id 一律同一响应，
  // 不泄露目标用户是否存在或属于哪个组织（RL-05）。
  'app/controllers/two_factor_controller.ts':
    '平台级 system:admin 2FA 重置（users 在隔离目录中为 system-global-maintenance）',
}

test.group('Tenant scope inventory —— 迁移覆盖与风险分类（§4.5）', () => {
  test('高风险：controller 不得把客户端 body/query 的 organizationId 当作 scope 事实源', ({
    assert,
  }) => {
    // 只匹配「客户端解析出的变量.organizationId」，排除 route param（已由
    // tenant_middleware 的路由一致性校验覆盖）与经 tenantScope 解析的写法。
    const findings = scan(
      /\b(filters|payload|body|input|dto)\.organizationId\b/,
      /ctx\.params|params\.organizationId|tenantScope\.|authPayload|resolveOrganizationId|requireOrganizationId/,
    ).filter((f) => !(f.file in CLIENT_ORG_EXEMPTIONS))
    assert.deepEqual(
      findings.map((f) => `${f.file}:${f.line}`),
      [],
      `客户端 organizationId 必须经 TenantScopeService 解析后使用：\n${describe(findings)}`,
    )
  })

  test('高风险：controller 不得用未界定租户范围的模型 find 解析客户端 ID', ({ assert }) => {
    // 排除 `=>`：那是数组/集合的 Array.prototype.find 回调，不是 Lucid 模型查询。
    const findings = scan(
      /\b[A-Z][A-Za-z0-9_]*\.(find|findOrFail)\(/,
      /findBy|tenantScope\.|findInScopeOrFail|=>/,
    ).filter((f) => !(f.file in MODEL_FIND_EXEMPTIONS))
    assert.deepEqual(
      findings.map((f) => `${f.file}:${f.line}`),
      [],
      `跨租户可达的模型查找必须走 TenantScopeService.findInScopeOrFail：\n${describe(findings)}`,
    )
  })

  test('中风险 gap 清单：registry 中 degraded/unsupported 的资源必须显式登记', ({ assert }) => {
    const notReady = TenantScopeRegistry.all().filter((d) => d.registryStatus !== 'registered')
    // 邻域能力尚未 apply 时以 degraded 注册；此处断言它们是"显式声明"而非遗漏，
    // 且不会被误当作已就绪资源使用（registryStatus 必须是受控枚举值）。
    for (const decl of notReady) {
      assert.oneOf(
        decl.registryStatus,
        ['degraded', 'unsupported'],
        `${decl.resourceType} 的未就绪状态必须显式声明`,
      )
      assert.isNotEmpty(decl.auditResourceType, `${decl.resourceType} 仍须可审计`)
      assert.isFalse(
        decl.allowSuperAdminGlobal,
        `${decl.resourceType} 未就绪期间不得开放 super admin 全局读`,
      )
    }
    // 当前已知 gap：source_attribution（来源归属能力未完整落地）。
    assert.deepEqual(
      notReady.map((d) => d.resourceType).sort(),
      ['source_attribution'],
      '未就绪资源清单变化时须同步更新 change 的 degraded 说明（§4.6）',
    )
  })

  test('覆盖率可见性：registry 已登记的资源类型数量与共享契约枚举一致', ({ assert }) => {
    const declared = TenantScopeRegistry.all().map((d) => d.resourceType)
    assert.equal(new Set(declared).size, declared.length, 'registry 不得重复登记同一 resourceType')
    assert.isAtLeast(declared.length, 17, 'registry 覆盖面不得收缩')
  })
})
