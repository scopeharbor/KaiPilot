import AuditLog from '#models/audit_log'
import Project from '#models/project'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import AuditService from '#services/audit_service'
import WbsTreeService from '#services/wbs_tree_service'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'

test.group('WbsTreeService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('wbs-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return {
      owner,
      org,
      project,
      service: new WbsTreeService(new AuditService()),
    }
  }

  test('整树查询懒建唯一根节点并回填项目', async ({ assert }) => {
    const { org, project, service } = await setup()

    const first = await service.getTree(org.id, project.id)
    const second = await service.getTree(org.id, project.id)
    await project.refresh()

    assert.lengthOf(first, 1)
    assert.lengthOf(second, 1)
    assert.equal(project.wbsRootId, first[0]!.id)
    assert.equal(first[0]!.path, `/${first[0]!.id}/`)
    assert.equal(first[0]!.depth, 0)
  })

  test('创建节点维护 path/depth/leaf/order/code 并写事务审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const [root] = await service.getTree(org.id, project.id)
    const a = await service.createNode(org.id, project.id, { name: 'A' }, owner.id)
    const b = await service.createNode(org.id, project.id, { name: 'B' }, owner.id)
    const child = await service.createNode(
      org.id,
      project.id,
      { name: 'A-1', parentId: a.id },
      owner.id,
    )

    await root!.refresh()
    await a.refresh()
    assert.equal(a.code, '1.1')
    assert.equal(b.code, '1.2')
    assert.equal(child.code, '1.1.1')
    assert.equal(child.depth, 2)
    assert.equal(child.path, `${a.path}${child.id}/`)
    assert.isFalse(a.isLeaf)
    assert.isFalse(root!.isLeaf)

    const audit = await AuditLog.query()
      .where('entity_type', 'wbs_node')
      .where('entity_id', child.id)
      .first()
    assert.equal((audit?.metadata as { event?: string })?.event, 'WBS_NODE_CREATED')
  })

  test('父节点跨项目与已占用 task_id 均拒绝', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const other = await createProjectWithMember(org, owner, owner, ProjectRoleName.PROJECT_MANAGER)
    const [otherRoot] = await service.getTree(org.id, other.project.id)
    const task = await Task.create({
      projectId: project.id,
      name: '关联任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })

    await assert.rejects(
      () =>
        service.createNode(
          org.id,
          project.id,
          { name: '跨项目', parentId: otherRoot!.id },
          owner.id,
        ),
      'WBS 节点不存在',
    )
    await service.createNode(org.id, project.id, { name: '已关联', taskId: task.id }, owner.id)
    await assert.rejects(
      () => service.createNode(org.id, project.id, { name: '重复', taskId: task.id }, owner.id),
      '该任务已关联 WBS 节点',
    )
  })

  test('软删节点不占用 task_id，删除后可重建关联', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const task = await Task.create({
      projectId: project.id,
      name: '重建关联任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })

    const node = await service.createNode(
      org.id,
      project.id,
      { name: '关联', taskId: task.id },
      owner.id,
    )
    await service.deleteNode(org.id, project.id, node.id, owner.id)
    assert.isNull(await WbsNode.find(node.id))

    // 删除（软删）后为同一任务重建节点：不再被旧行占用 task_id 拦截
    const recreated = await service.createNode(
      org.id,
      project.id,
      { name: '重建', taskId: task.id },
      owner.id,
    )
    assert.equal(Number(recreated.taskId), task.id)
    // 旧行保留为软删墓碑（不硬删），仅不再参与占用检查与唯一约束
    const tombstone = await db.from('wbs_nodes').where('id', node.id).first()
    assert.isNotNull(tombstone?.deleted_at)
    assert.equal(Number(tombstone?.task_id), task.id)
  })

  test('允许 20 层并拒绝第 21 层', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    let [parent] = await service.getTree(org.id, project.id)
    for (let level = 2; level <= 20; level++) {
      parent = await service.createNode(
        org.id,
        project.id,
        { name: `L${level}`, parentId: parent!.id },
        owner.id,
      )
    }
    assert.equal(parent!.depth, 19)
    await assert.rejects(
      () => service.createNode(org.id, project.id, { name: 'L21', parentId: parent!.id }, owner.id),
      'WBS 最多支持 20 层',
    )
  })

  test('移动子树重算路径编码并拒绝移动到自身后代', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const a = await service.createNode(org.id, project.id, { name: 'A' }, owner.id)
    const b = await service.createNode(org.id, project.id, { name: 'B' }, owner.id)
    const child = await service.createNode(
      org.id,
      project.id,
      { name: 'child', parentId: a.id },
      owner.id,
    )
    const grandchild = await service.createNode(
      org.id,
      project.id,
      { name: 'grandchild', parentId: child.id },
      owner.id,
    )

    const moved = await service.moveNode(
      org.id,
      project.id,
      child.id,
      { parentId: b.id, displayOrder: 0 },
      owner.id,
    )
    await grandchild.refresh()
    assert.equal(moved.parentId, b.id)
    assert.equal(moved.code, `${b.code}.1`)
    assert.isTrue(grandchild.path!.startsWith(moved.path!))

    await assert.rejects(
      () => service.moveNode(org.id, project.id, moved.id, { parentId: grandchild.id }, owner.id),
      '不能将节点移动到自身或其后代下',
    )
  })

  test('删除非叶节点提升子节点，项目根拒绝删除', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const [root] = await service.getTree(org.id, project.id)
    const parent = await service.createNode(org.id, project.id, { name: '父' }, owner.id)
    const child = await service.createNode(
      org.id,
      project.id,
      { name: '子', parentId: parent.id },
      owner.id,
    )

    await service.deleteNode(org.id, project.id, parent.id, owner.id)
    await child.refresh()
    assert.isNull(child.parentId)
    assert.equal(child.depth, 0)
    assert.isNull(await WbsNode.find(parent.id))
    await assert.rejects(
      () => service.deleteNode(org.id, project.id, root!.id, owner.id),
      '项目根节点不能删除',
    )
  })

  test('名称与折叠状态可持久化', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const node = await service.createNode(org.id, project.id, { name: '旧名' }, owner.id)
    await service.updateNode(
      org.id,
      project.id,
      node.id,
      { name: '新名', collapsed: true },
      owner.id,
    )
    const fresh = await WbsNode.findOrFail(node.id)
    assert.equal(fresh.name, '新名')
    assert.isTrue(fresh.collapsed)
  })

  test('跨组织项目查询返回资源不存在', async ({ assert }) => {
    const { project, service } = await setup()
    await assert.rejects(() => service.getTree(999999, project.id), '项目不存在')
    assert.equal(
      await Project.query()
        .where('id', project.id)
        .count('*', 'total')
        .then((r) => Number(r[0]?.$extras.total)),
      1,
    )
  })
})
