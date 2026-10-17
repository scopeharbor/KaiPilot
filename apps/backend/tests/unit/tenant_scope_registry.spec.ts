// v3-multitenant-isolation-architecture §3.3 —— TenantScopeRegistry 校验测试。
// 覆盖：registered 资源必须具备归属字段与父级解析器；degraded/unsupported 必须显式声明；
// 共享契约资源类型全覆盖；默认 scoped-only（global 必须显式声明）；真实模型 introspection。
import { test } from '@japa/runner'
import TenantScopeRegistry from '#services/tenant_scope_registry'
import {
  MULTITENANT_RESOURCE_TYPES,
  type TenantResourceDeclaration,
} from '@aiproj/types/multitenant-isolation-architecture'
// introspection 用真实模型（schema 生成或手写，均带 $columns）
import Project from '#models/project'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import ProjectMember from '#models/project_member'
import Attachment from '#models/attachment'
import Report from '#models/report'
import AuditLog from '#models/audit_log'
import AiProjectDraft from '#models/ai_project_draft'
import CompilerRun from '#models/compiler_run'
import CompilerArtifact from '#models/compiler_artifact'
import KnowledgeItem from '#models/knowledge_item'
import SourceAttribution from '#models/source_attribution'
import {
  assertDeclaredFieldsMatchModels,
  assertModelsExposeDeclaredColumns,
  type ResourceModelPair,
} from './_tenant_scope_model_introspection.js'

function makeDecl(overrides: Partial<TenantResourceDeclaration>): TenantResourceDeclaration {
  return {
    resourceType: 'task',
    organizationField: 'organization_id',
    projectField: 'project_id',
    parentResolver: 'project',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'task',
    ...overrides,
  }
}

test.group('TenantScopeRegistry 完整性', () => {
  test('validate() 全量通过：有组织列者带字段与解析器，无组织列者必须为项目派生', ({ assert }) => {
    assert.doesNotThrow(() => TenantScopeRegistry.validate())
    for (const decl of TenantScopeRegistry.all()) {
      if (decl.registryStatus === 'registered') {
        assert.exists(decl.parentResolver, `${decl.resourceType} 应有父级解析器`)
        if (!decl.organizationField) {
          assert.equal(decl.parentResolver, 'project', `${decl.resourceType} 无组织列须项目派生`)
          assert.exists(decl.projectField, `${decl.resourceType} 派生资源应有项目字段`)
        }
      }
    }
  })

  // 标题不写死数量：资源类型清单随 SSO/SCIM/插件目录等 change 增长，写死会每次都要改标题。
  test('共享契约全部资源类型均已注册且不重复', ({ assert }) => {
    const types = new Set(TenantScopeRegistry.all().map((d) => d.resourceType))
    for (const t of MULTITENANT_RESOURCE_TYPES) {
      assert.isTrue(types.has(t), `资源类型 ${t} 应已注册`)
    }
    assert.equal(TenantScopeRegistry.all().length, MULTITENANT_RESOURCE_TYPES.length)
  })

  test('registered 资源缺少组织列且非项目派生即失败（负例）', ({ assert }) => {
    assert.throws(() =>
      TenantScopeRegistry.validateDeclaration(
        makeDecl({
          registryStatus: 'registered',
          organizationField: null,
          parentResolver: 'organization',
        }),
      ),
    )
    // 派生资源缺少 projectField 同样失败
    assert.throws(() =>
      TenantScopeRegistry.validateDeclaration(
        makeDecl({
          registryStatus: 'registered',
          organizationField: null,
          projectField: null,
        }),
      ),
    )
  })

  test('registered 资源缺少 parentResolver 即失败（负例）', ({ assert }) => {
    assert.throws(() =>
      TenantScopeRegistry.validateDeclaration(
        makeDecl({ registryStatus: 'registered', parentResolver: null }),
      ),
    )
  })

  test('项目派生资源声明（organizationField=null + projectField）可通过', ({ assert }) => {
    assert.doesNotThrow(() =>
      TenantScopeRegistry.validateDeclaration(
        makeDecl({
          registryStatus: 'registered',
          organizationField: null,
          projectField: 'project_id',
          parentResolver: 'project',
        }),
      ),
    )
  })

  test('degraded/unsupported 必须显式声明状态；无归属字段也可通过', ({ assert }) => {
    assert.doesNotThrow(() =>
      TenantScopeRegistry.validateDeclaration(
        makeDecl({
          registryStatus: 'degraded',
          organizationField: 'organization_id',
          parentResolver: 'organization',
        }),
      ),
    )
    assert.doesNotThrow(() =>
      TenantScopeRegistry.validateDeclaration(
        makeDecl({
          registryStatus: 'unsupported',
          organizationField: 'organization_id',
          parentResolver: 'organization',
        }),
      ),
    )
    assert.throws(() =>
      TenantScopeRegistry.validateDeclaration(makeDecl({ registryStatus: 'wild' as never })),
    )
  })

  test('errorSemantics / auditResourceType 非法即失败（负例）', ({ assert }) => {
    assert.throws(() =>
      TenantScopeRegistry.validateDeclaration(makeDecl({ errorSemantics: 'FORBIDDEN' as never })),
    )
    assert.throws(() =>
      TenantScopeRegistry.validateDeclaration(makeDecl({ auditResourceType: '' })),
    )
  })

  test('默认 scoped-only：全量声明均未显式允许 super admin global', ({ assert }) => {
    for (const decl of TenantScopeRegistry.all()) {
      assert.isFalse(decl.allowSuperAdminGlobal, `${decl.resourceType} 默认不允许全局读`)
    }
    assert.throws(() => TenantScopeRegistry.assertGlobalAllowed('project'))
  })
})

test.group('TenantScopeRegistry 模型 introspection（字段漂移防护）', () => {
  // 企业资源（KMS / DLP / 水印 / 合规证据）的同类断言在 tenant_scope_registry_enterprise.spec.ts
  const MODEL_BY_RESOURCE: ResourceModelPair[] = [
    { resourceType: 'project', model: Project },
    { resourceType: 'task', model: Task },
    { resourceType: 'wbs', model: WbsNode },
    { resourceType: 'member', model: ProjectMember },
    { resourceType: 'file', model: Attachment },
    { resourceType: 'report', model: Report },
    { resourceType: 'audit', model: AuditLog },
    { resourceType: 'ai_draft', model: AiProjectDraft },
    { resourceType: 'compiler_run', model: CompilerRun },
    { resourceType: 'compiler_artifact', model: CompilerArtifact },
    { resourceType: 'knowledge_item', model: KnowledgeItem },
    { resourceType: 'source_attribution', model: SourceAttribution },
  ]

  test('注册为 registered 的资源，其模型须暴露声明列（组织列或派生项目列）', ({ assert }) => {
    assertModelsExposeDeclaredColumns(MODEL_BY_RESOURCE, assert)
  })

  test('registry 声明的 snake_case 字段与模型列一致（组织列/项目列分支）', ({ assert }) => {
    assertDeclaredFieldsMatchModels(MODEL_BY_RESOURCE, assert)
  })
})
