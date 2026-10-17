/**
 * 组织级查询隔离助手。所有带 organization_id 的业务资源查询都通过本助手
 * 附加租户条件，避免 Service 中出现容易遗漏的裸查询。
 */
export default class TenantScope {
  static forOrganization<
    Query extends {
      where(column: string, value: number): Query
    },
  >(query: Query, organizationId: number): Query {
    return query.where('organization_id', organizationId)
  }
}
