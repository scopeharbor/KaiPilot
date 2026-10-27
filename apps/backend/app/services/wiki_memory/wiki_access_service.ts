/**
 * v3-llm-wiki-memory-foundation —— 维基访问控制（design D4）。
 *
 * 读：
 * - 组织空间：组织内 `wiki:view`；
 * - 部门空间：组织管理员，或 `wiki:view` 且属于该部门（organization_members.department_id）；
 * - 项目空间：`wiki:view` 的项目 scope 判定（组织管理员或项目成员）；
 * - 个人空间：只有本人；本人逐页授权后，被授权项目的项目经理只读。
 * 审阅（发布/驳回/回滚/撤回/体检/导出）：
 * - 组织空间：`wiki:review`（组织管理员）；部门空间：`wiki:review` 或部门负责人；
 * - 项目空间：项目 scope 的 `wiki:review`（项目经理、组织管理员）；个人空间：只有本人。
 * 提交修订：能读该空间且组织角色不是只读观察者。
 * restricted 页面只对审阅者可见。所有判定先校验组织归属；不可读一律按不存在处理。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'
import type WikiPage from '#models/wiki_page'
import type WikiSpace from '#models/wiki_space'
import RbacService from '#services/rbac_service'
import { WIKI_REVIEW, WIKI_VIEW } from '#start/rbac/permissions'
import { CanonicalRole } from '#start/rbac/roles'

export interface WikiActor {
  user: User
  organizationId: number
}

type SpaceLike = Pick<WikiSpace, 'organizationId' | 'scopeKind' | 'scopeRefId'>

@inject()
export default class WikiAccessService {
  constructor(private readonly rbac: RbacService) {
    this.rbac.enableRequestMemo()
  }

  private async allowed(actor: WikiActor, permission: typeof WIKI_VIEW, projectId?: number) {
    const result = await this.rbac.check(actor.user, permission, actor.organizationId, projectId)
    return result.allowed
  }

  async departmentOf(actor: WikiActor): Promise<number | null> {
    const row = await db
      .from('organization_members')
      .where('organization_id', actor.organizationId)
      .where('user_id', actor.user.id)
      .select('department_id')
      .first()
    return row?.department_id === null || row?.department_id === undefined
      ? null
      : Number(row.department_id)
  }

  private async isDepartmentLeader(actor: WikiActor, departmentId: number): Promise<boolean> {
    const row = await db
      .from('departments')
      .where('organization_id', actor.organizationId)
      .where('id', departmentId)
      .whereNull('deleted_at')
      .select('leader_id')
      .first()
    return !!row && Number(row.leader_id) === Number(actor.user.id)
  }

  async canReadSpace(actor: WikiActor, space: SpaceLike): Promise<boolean> {
    if (Number(space.organizationId) !== Number(actor.organizationId)) return false
    switch (space.scopeKind) {
      case 'organization':
        return this.allowed(actor, WIKI_VIEW)
      case 'department': {
        if (!(await this.allowed(actor, WIKI_VIEW))) return false
        if (await this.rbac.isOrgAdmin(actor.user, actor.organizationId)) return true
        return (await this.departmentOf(actor)) === Number(space.scopeRefId)
      }
      case 'project':
        return this.allowed(actor, WIKI_VIEW, Number(space.scopeRefId))
      case 'user':
        return Number(space.scopeRefId) === Number(actor.user.id)
      default:
        return false
    }
  }

  async canReviewSpace(actor: WikiActor, space: SpaceLike): Promise<boolean> {
    if (Number(space.organizationId) !== Number(actor.organizationId)) return false
    switch (space.scopeKind) {
      case 'organization':
        return this.allowed(actor, WIKI_REVIEW)
      case 'department':
        return (
          (await this.allowed(actor, WIKI_REVIEW)) ||
          ((await this.canReadSpace(actor, space)) &&
            (await this.isDepartmentLeader(actor, Number(space.scopeRefId))))
        )
      case 'project':
        return this.allowed(actor, WIKI_REVIEW, Number(space.scopeRefId))
      case 'user':
        return Number(space.scopeRefId) === Number(actor.user.id)
      default:
        return false
    }
  }

  /** 提交修订（审阅者提交即发布，其余成为待审提议）。 */
  async canProposeInSpace(actor: WikiActor, space: SpaceLike): Promise<boolean> {
    if (!(await this.canReadSpace(actor, space))) return false
    if (space.scopeKind === 'user' || actor.user.isSuperAdmin) return true
    const role = await this.rbac.resolveOrganizationRole(actor.user, actor.organizationId)
    return role !== CanonicalRole.READONLY_OBSERVER && role !== CanonicalRole.EXTERNAL_COLLABORATOR
  }

  async canReadPage(
    actor: WikiActor,
    space: SpaceLike,
    page: Pick<WikiPage, 'organizationId' | 'sensitivity' | 'sharedWithProjectIds'>,
  ): Promise<boolean> {
    if (Number(page.organizationId) !== Number(actor.organizationId)) return false
    if (await this.canReadSpace(actor, space)) {
      return page.sensitivity !== 'restricted' || (await this.canReviewSpace(actor, space))
    }
    if (space.scopeKind !== 'user' || page.sensitivity === 'restricted') return false
    for (const projectId of page.sharedWithProjectIds ?? []) {
      if (
        (await this.rbac.projectExistsInOrg(projectId, actor.organizationId)) &&
        (await this.rbac.isProjectManager(actor.user, projectId))
      ) {
        return true
      }
    }
    return false
  }
}
