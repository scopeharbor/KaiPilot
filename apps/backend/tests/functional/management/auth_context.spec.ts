import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('认证组织与权限上下文', (group) => {
  useAuthDatabase(group)

  test('login/me 含 organizations 与 permissions，refresh 可切换组织', async ({
    client,
    assert,
  }) => {
    const ownerA = await createUser({ email: uniqueEmail('multi-org') })
    const ownerB = await createUser({ email: uniqueEmail('other-owner') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    await addOrgMember(orgB, ownerA, 'viewer')

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: ownerA.email, password: STRONG_PASSWORD })
    login.assertStatus(200)
    assert.lengthOf(login.body().data.user.organizations, 2)

    const me = await client
      .get('/api/v1/auth/me')
      .header('Authorization', `Bearer ${login.body().data.accessToken}`)
    me.assertStatus(200)
    assert.include(me.body().data.permissions, 'org:manage')

    const switched = await client.post('/api/v1/auth/refresh').json({
      refreshToken: login.body().data.refreshToken,
      organizationId: orgB.id,
    })
    switched.assertStatus(200)

    const switchedMe = await client
      .get('/api/v1/auth/me')
      .header('Authorization', `Bearer ${switched.body().data.accessToken}`)
    switchedMe.assertStatus(200)
    assert.notInclude(switchedMe.body().data.permissions, 'org:manage')
    assert.include(switchedMe.body().data.permissions, 'org:view')
    const organizationA = switched
      .body()
      .data.user.organizations.find((org: { id: number }) => org.id === orgA.id)
    assert.exists(organizationA)
    assert.equal(organizationA!.role, 'owner')
  })
})
