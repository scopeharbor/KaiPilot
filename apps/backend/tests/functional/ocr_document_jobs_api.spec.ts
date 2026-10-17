import { test } from '@japa/runner'
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
} from './auth/_helpers.js'

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

async function setUpProjectAndUser(): Promise<{ user: User; project: Project }> {
  const user = await createUser({ email: uniqueEmail('ocrjobs') })
  const org = await createOrganization(user)
  const { project } = await createProjectWithMember(
    org,
    user,
    user,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { user, project }
}

test.group('OCR Document Jobs API', (group) => {
  useAuthDatabase(group)

  test('未认证用户不能访问 OCR 作业列表', async ({ client }) => {
    const response = await client.get('/api/v1/projects/1/ocr/document-jobs')
    response.assertStatus(401)
  })

  // v3-ocr-document-upload-flow 回归：此前 OcrDocumentJobService 的构造参数是
  // 无默认值的普通对象，@adonisjs/fold 无法以无参方式构造它，任何经容器解析该
  // controller 的请求（含本列表）都抛 500 "Cannot inject [class OcrDocumentJobService]"。
  // 构造参数改为带默认值（constructor.length === 0）后，容器可正常 new 出服务。
  test('GET /api/v1/projects/:id/ocr/document-jobs 返回 200 空列表（注入回归）', async ({
    client,
    assert,
  }) => {
    const { user, project } = await setUpProjectAndUser()
    const token = await login(client, user)

    const response = await client
      .get(`/api/v1/projects/${project.id}/ocr/document-jobs`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    const body = response.body() as {
      data: unknown[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }
    assert.isArray(body.data)
    assert.equal(body.data.length, 0)
    assert.equal(body.meta.total, 0)
    assert.equal(body.meta.page, 1)
  })

  test('GET /api/v1/projects/:id/ocr/document-jobs 支持分页参数', async ({ client, assert }) => {
    const { user, project } = await setUpProjectAndUser()
    const token = await login(client, user)

    const response = await client
      .get(`/api/v1/projects/${project.id}/ocr/document-jobs?page=2&perPage=5`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    const body = response.body() as {
      data: unknown[]
      meta: { page: number; perPage: number }
    }
    assert.equal(body.meta.page, 2)
    assert.equal(body.meta.perPage, 5)
  })
})
