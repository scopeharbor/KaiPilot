import { test } from '@japa/runner'
import { unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ProjectRoleName } from '#rbac'
import type User from '#models/user'
import type Project from '#models/project'
import type { ApiClient } from '@japa/api-client'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

async function setUpProjectAndUser(): Promise<{ user: User; project: Project }> {
  const user = await createUser({ email: uniqueEmail('files') })
  const org = await createOrganization(user)
  const { project } = await createProjectWithMember(
    org,
    user,
    user,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { user, project }
}

test.group('Files API', (group) => {
  useAuthDatabase(group)

  test('未认证用户不能访问文件库', async ({ client }) => {
    const response = await client.get('/api/v1/projects/1/files')
    response.assertStatus(401)
  })

  test('GET /api/v1/projects/:id/files 返回文件列表', async ({ client, assert }) => {
    const { user, project } = await setUpProjectAndUser()
    const token = await login(client, user)

    const response = await client
      .get(`/api/v1/projects/${project.id}/files`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    const body = response.body() as { data: unknown[]; meta: unknown }
    assert.isArray(body.data)
    assert.exists(body.meta)
  })

  test('POST /api/v1/projects/:id/files 创建文件夹', async ({ client, assert }) => {
    const { user, project } = await setUpProjectAndUser()
    const token = await login(client, user)

    const response = await client
      .post(`/api/v1/projects/${project.id}/files`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '测试文件夹',
        documentType: 'folder',
      })

    response.assertStatus(201)
    const body = response.body() as { data: { name: string; documentType: string } }
    assert.equal(body.data.name, '测试文件夹')
    assert.equal(body.data.documentType, 'folder')
  })

  test('GET /api/v1/projects/:id/attachments 返回附件列表', async ({ client, assert }) => {
    const { user, project } = await setUpProjectAndUser()
    const token = await login(client, user)

    const response = await client
      .get(`/api/v1/projects/${project.id}/attachments`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    const body = response.body() as { data: unknown[]; meta: unknown }
    assert.isArray(body.data)
    assert.exists(body.meta)
  })

  test('POST /api/v1/projects/:id/attachments 上传 png 成功并记录完整 MIME', async ({
    client,
    assert,
  }) => {
    const { user, project } = await setUpProjectAndUser()
    const token = await login(client, user)

    const response = await client
      .post(`/api/v1/projects/${project.id}/attachments`)
      .header('Authorization', `Bearer ${token}`)
      .field('entityType', 'project')
      .field('entityId', project.id)
      // 最小 1x1 透明 PNG（真实文件结构）：bodyparser 对 png 走魔术字节探测，
      // 假内容会导致 type/subtype 解析为空、mimeType 落库为 null
      .file(
        'file',
        Buffer.from(
          '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082',
          'hex',
        ),
        {
          filename: 'screenshot.png',
          contentType: 'image/png',
        },
      )

    response.assertStatus(201)
    const body = response.body() as {
      data: { fileName: string; mimeType: string; filePath: string }
    }
    assert.equal(body.data.fileName, 'screenshot.png')
    // 修复回归：此前用 file.type（主类型 image）比对白名单导致任何上传都 422
    assert.equal(body.data.mimeType, 'image/png')

    // 清理测试写入的物理文件（按响应返回的精确相对路径删除，避免误伤开发目录）
    const uploadRoot = process.env.UPLOAD_ROOT ?? 'storage/uploads'
    await unlink(resolve(uploadRoot, body.data.filePath)).catch(() => undefined)
  })

  test('POST /api/v1/projects/:id/attachments 上传 pdf 成功并记录完整 MIME', async ({
    client,
    assert,
  }) => {
    const { user, project } = await setUpProjectAndUser()
    const token = await login(client, user)

    const response = await client
      .post(`/api/v1/projects/${project.id}/attachments`)
      .header('Authorization', `Bearer ${token}`)
      .field('entityType', 'project')
      .field('entityId', project.id)
      .file('file', Buffer.from('%PDF-1.4 fake pdf bytes'), {
        filename: 'report.pdf',
        contentType: 'application/pdf',
      })

    response.assertStatus(201)
    const body = response.body() as {
      data: { fileName: string; mimeType: string; filePath: string }
    }
    assert.equal(body.data.fileName, 'report.pdf')
    assert.equal(body.data.mimeType, 'application/pdf')

    const uploadRoot = process.env.UPLOAD_ROOT ?? 'storage/uploads'
    await unlink(resolve(uploadRoot, body.data.filePath)).catch(() => undefined)
  })

  test('POST /api/v1/projects/:id/attachments 非法 MIME 类型返回 422', async ({
    client,
    assert,
  }) => {
    const { user, project } = await setUpProjectAndUser()
    const token = await login(client, user)

    const response = await client
      .post(`/api/v1/projects/${project.id}/attachments`)
      .header('Authorization', `Bearer ${token}`)
      .field('entityType', 'project')
      .field('entityId', project.id)
      // 扩展名 txt 在白名单内，但 content-type 主/子类型拼接为 text/html 不在白名单
      .file('file', Buffer.from('<html></html>'), {
        filename: 'evil.txt',
        contentType: 'text/html',
      })

    response.assertStatus(422)
    const body = response.body() as { error: { code: string; message: string } }
    assert.equal(body.error.code, 'VALIDATION_ERROR')
    assert.include(body.error.message, '不支持的文件格式')
  })

  test('跨组织用户不能访问文件库', async ({ client, assert }) => {
    const { project } = await setUpProjectAndUser()
    const otherOrgUser = await createOtherOrgUser()
    const token = await login(client, otherOrgUser)

    const response = await client
      .get(`/api/v1/projects/${project.id}/files`)
      .header('Authorization', `Bearer ${token}`)

    // 应返回 404 或 403
    assert.include([403, 404], response.status())
  })
})

async function createOtherOrgUser() {
  // 创建另一个组织的用户用于跨组织测试
  const user = await createUser({ email: uniqueEmail('other-files'), fullName: '其他用户' })
  await createOrganization(user)
  return user
}
