/**
 * TenantScopeRegistry 模型 introspection（字段漂移防护）的共用断言。
 *
 * 核心资源在 tenant_scope_registry.spec.ts、企业资源在 tenant_scope_registry_enterprise.spec.ts
 * 各自登记「资源类型 → 模型」清单，共用同一组断言（v3-personal-edition-open-source-export 3.6：
 * 企业资源随企业模型一起从个人版排除）。
 */
import TenantScopeRegistry from '#services/tenant_scope_registry'

export interface ResourceModelPair {
  resourceType: string
  model: unknown
}

type Assert = {
  isTrue(value: unknown, message?: string): void
  equal(actual: unknown, expected: unknown, message?: string): void
  exists(value: unknown, message?: string): void
}

function modelColumns(model: unknown): string[] {
  const raw = (model as { $columns?: readonly string[] }).$columns
  if (raw && raw.length > 0) {
    return Array.from(new Set(raw as string[]))
  }
  const defs = (model as { $columnsDefinitions?: Map<string, unknown> }).$columnsDefinitions
  if (defs && defs.size > 0) {
    return Array.from(defs.keys())
  }
  return []
}

/** 注册为 registered 的资源，其模型须暴露声明列（组织列或派生项目列）。 */
export function assertModelsExposeDeclaredColumns(pairs: ResourceModelPair[], assert: Assert) {
  for (const { resourceType, model } of pairs) {
    const decl = TenantScopeRegistry.get(resourceType as never)
    if (decl.registryStatus !== 'registered') continue
    const cols = modelColumns(model)
    if (cols.length === 0) {
      // 手写模型无静态 $columns（运行时 DB 反射）；真实列校验由
      // functional 的 tenant_isolation.spec 用 db.schema.hasColumn 兜底。
      continue
    }
    if (decl.organizationField) {
      assert.isTrue(
        cols.includes('organizationId'),
        `${resourceType} 应含 organizationId 列（declared organizationField=${decl.organizationField}），实际列: ${cols.join(',')}`,
      )
    } else {
      // 项目派生：模型须暴露 projectId 列（declared projectField）
      assert.equal(decl.parentResolver, 'project', `${resourceType} 派生声明须 project 解析`)
      assert.isTrue(
        cols.includes('projectId'),
        `${resourceType} 派生资源应含 projectId 列（declared projectField=${String(decl.projectField)}），实际列: ${cols.join(',')}`,
      )
    }
  }
}

/** registry 声明的 snake_case 字段与模型列一致（组织列/项目列分支）。 */
export function assertDeclaredFieldsMatchModels(pairs: ResourceModelPair[], assert: Assert) {
  for (const { resourceType, model } of pairs) {
    const decl = TenantScopeRegistry.get(resourceType as never)
    if (decl.registryStatus !== 'registered') continue
    const cols = modelColumns(model)
    if (cols.length === 0) {
      // 手写模型无静态 $columns：由 functional tenant_isolation.spec 兜底。
      continue
    }
    if (decl.organizationField) {
      const camel = cols.find(
        (c) => c.toLowerCase() === decl.organizationField!.replace('_id', 'Id').toLowerCase(),
      )
      assert.exists(
        camel,
        `${resourceType}: organizationField=${decl.organizationField} 应有对应模型列`,
      )
    } else {
      const camel = cols.find(
        (c) => c.toLowerCase() === (decl.projectField ?? '').replace('_id', 'Id').toLowerCase(),
      )
      assert.exists(
        camel,
        `${resourceType}: projectField=${String(decl.projectField)} 应有对应模型列`,
      )
    }
  }
}
