import Comment from '#models/comment'
import { ProjectRoleName } from '#rbac'
import CommentPolicy from '#policies/comment_policy'
import RbacService from '#services/rbac_service'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('CommentPolicy', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('comment-owner') })
    const org = await createOrganization(owner)
    return { owner, org }
  }

  // ---------------------------------------------------------------------------
  // 查看权限
  // ---------------------------------------------------------------------------

  test('成员可以查看评论', async ({ assert }) => {
    const { owner, org } = await setup()
    const { project } = await createProjectWithMember(org, owner, owner, ProjectRoleName.MEMBER)

    const policy = new CommentPolicy(new RbacService())
    const canView = await policy.view(owner, org.id, project.id)

    assert.isTrue(canView)
  })

  test('只读观察者可以查看评论', async ({ assert }) => {
    const { owner, org } = await setup()
    const viewer = await createUser({ email: uniqueEmail('viewer') })
    const { project } = await createProjectWithMember(
      org,
      owner,
      viewer,
      ProjectRoleName.READONLY_OBSERVER,
    )

    const policy = new CommentPolicy(new RbacService())
    const canView = await policy.view(viewer, org.id, project.id)

    assert.isTrue(canView)
  })

  // ---------------------------------------------------------------------------
  // 创建权限
  // ---------------------------------------------------------------------------

  test('成员可以创建评论', async ({ assert }) => {
    const { owner, org } = await setup()
    const { project } = await createProjectWithMember(org, owner, owner, ProjectRoleName.MEMBER)

    const policy = new CommentPolicy(new RbacService())
    const canCreate = await policy.create(owner, org.id, project.id)

    assert.isTrue(canCreate)
  })

  test('只读观察者不能创建评论', async ({ assert }) => {
    const { owner, org } = await setup()
    const viewer = await createUser({ email: uniqueEmail('viewer') })
    const { project } = await createProjectWithMember(
      org,
      owner,
      viewer,
      ProjectRoleName.READONLY_OBSERVER,
    )

    const policy = new CommentPolicy(new RbacService())
    const canCreate = await policy.create(viewer, org.id, project.id)

    assert.isFalse(canCreate)
  })

  test('外部协作者可以在授权项目创建评论', async ({ assert }) => {
    const { owner, org } = await setup()
    const collaborator = await createUser({ email: uniqueEmail('collab') })
    const { project } = await createProjectWithMember(
      org,
      owner,
      collaborator,
      ProjectRoleName.EXTERNAL_COLLABORATOR,
    )

    const policy = new CommentPolicy(new RbacService())
    const canCreate = await policy.create(collaborator, org.id, project.id)

    assert.isTrue(canCreate)
  })

  // ---------------------------------------------------------------------------
  // 编辑权限（仅本人）
  // ---------------------------------------------------------------------------

  test('作者可以编辑本人评论', async ({ assert }) => {
    const { owner, org } = await setup()
    const { project } = await createProjectWithMember(org, owner, owner, ProjectRoleName.MEMBER)

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '测试评论',
      bodyFormat: 'plain',
    })

    const policy = new CommentPolicy(new RbacService())
    const canUpdate = await policy.canUpdate(owner, org.id, project.id, comment)

    assert.isTrue(canUpdate)
  })

  test('成员不能编辑他人评论', async ({ assert }) => {
    const { owner, org } = await setup()
    const other = await createUser({ email: uniqueEmail('other') })
    const { project } = await createProjectWithMember(org, owner, other, ProjectRoleName.MEMBER)

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '测试评论',
      bodyFormat: 'plain',
    })

    const policy = new CommentPolicy(new RbacService())
    const canUpdate = await policy.canUpdate(other, org.id, project.id, comment)

    assert.isFalse(canUpdate)
  })

  test('管理者不能代改他人正文', async ({ assert }) => {
    const { owner, org } = await setup()
    const manager = await createUser({ email: uniqueEmail('manager') })
    const { project } = await createProjectWithMember(
      org,
      owner,
      manager,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '测试评论',
      bodyFormat: 'plain',
    })

    const policy = new CommentPolicy(new RbacService())
    const canUpdate = await policy.canUpdate(manager, org.id, project.id, comment)

    assert.isFalse(canUpdate)
  })

  // ---------------------------------------------------------------------------
  // 删除权限
  // ---------------------------------------------------------------------------

  test('作者可以删除本人评论', async ({ assert }) => {
    const { owner, org } = await setup()
    const { project } = await createProjectWithMember(org, owner, owner, ProjectRoleName.MEMBER)

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '测试评论',
      bodyFormat: 'plain',
    })

    const policy = new CommentPolicy(new RbacService())
    const canDelete = await policy.canDelete(owner, org.id, project.id, comment)

    assert.isTrue(canDelete)
  })

  test('管理者可以删除他人评论', async ({ assert }) => {
    const { owner, org } = await setup()
    const manager = await createUser({ email: uniqueEmail('manager') })
    const { project } = await createProjectWithMember(
      org,
      owner,
      manager,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '测试评论',
      bodyFormat: 'plain',
    })

    const policy = new CommentPolicy(new RbacService())
    const canDelete = await policy.canDelete(manager, org.id, project.id, comment)

    assert.isTrue(canDelete)
  })

  test('成员不能删除他人评论', async ({ assert }) => {
    const { owner, org } = await setup()
    const other = await createUser({ email: uniqueEmail('other') })
    const { project } = await createProjectWithMember(org, owner, other, ProjectRoleName.MEMBER)

    const comment = await Comment.create({
      organizationId: org.id,
      projectId: project.id,
      taskId: null,
      authorId: owner.id,
      body: '测试评论',
      bodyFormat: 'plain',
    })

    const policy = new CommentPolicy(new RbacService())
    const canDelete = await policy.canDelete(other, org.id, project.id, comment)

    assert.isFalse(canDelete)
  })

  // ---------------------------------------------------------------------------
  // 授权异常
  // ---------------------------------------------------------------------------

  test('authorizeView 无权限时抛出异常', async ({ assert }) => {
    const { owner, org } = await setup()
    // 创建另一个组织的用户
    const otherOrgOwner = await createUser({ email: uniqueEmail('other-org') })
    await createOrganization(otherOrgOwner)

    const { project } = await createProjectWithMember(org, owner, owner, ProjectRoleName.MEMBER)

    const policy = new CommentPolicy(new RbacService())

    // 跨组织用户无权限
    await assert.rejects(
      async () => await policy.authorizeView(otherOrgOwner, org.id, project.id),
      PermissionDeniedException,
    )
  })
})
