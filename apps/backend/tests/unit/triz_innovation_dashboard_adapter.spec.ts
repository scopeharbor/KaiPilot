import TrizInnovationScheme from '#models/triz_innovation_scheme'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import InnovationDashboardAdapter from '#services/triz_innovation/innovation_dashboard_adapter'
import InnovationWorkbenchService from '#services/triz_innovation/innovation_workbench_service'
import { ProjectRoleName } from '#rbac'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import type { InnovationOption } from '@aiproj/types'

test.group('V3 InnovationDashboardAdapter', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('iw-dash-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project: { id: Number(project.id) } }
  }

  function option(over: Partial<InnovationOption> = {}): InnovationOption {
    return {
      optionId: 'opt-dash',
      origin: 'deterministic_mapping',
      sourceRefs: [
        {
          sourceType: 'contradiction',
          ref: 'pc-dash',
          hash: 'sig-dash',
          severity: 'critical',
          stale: true,
          title: '关键路径与资源负载对立',
        },
      ],
      selectedPathId: null,
      principleIds: ['segmentation'],
      name: '分段交付',
      description: '仅用于 Dashboard 摘要',
      applicability: [],
      nonApplicability: [],
      hashes: {
        contradictionSignatures: ['sig-dash'],
        analysisContentHashes: [],
        selectedPathId: null,
      },
      warnings: [{ code: 'STALE_SOURCE_CONTRADICTION', severity: 'warning', message: 'stale' }],
      impact: {
        schedule: 'improves',
        resource_load: 'neutral',
        risk: 'neutral',
        scope_flexibility: 'neutral',
        quality_maintainability: 'neutral',
        change_complexity: 'worsens',
      },
      reviewState: 'pending',
      createdBy: 1,
      ...over,
    }
  }

  test('authorized summary is low-sensitivity and side-effect free', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const workbench = await app.container.make(InnovationWorkbenchService)
    const scheme = await workbench.createScheme({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      name: 'Dashboard 方案',
    })
    await workbench.addOption(
      Number(org.id),
      project.id,
      scheme.schemeId,
      Number(owner.id),
      option(),
    )
    await workbench.saveHandoff(
      Number(org.id),
      project.id,
      scheme.schemeId,
      {
        status: 'candidate_created',
        draftSessionRef: 'draft_iw_dashboard',
        handedOffAt: null,
        blockedReason: null,
      },
      'iw-hof-dashboard',
    )
    await workbench.updateScheme(Number(org.id), project.id, scheme.schemeId, Number(owner.id), {
      reviewState: 'reviewed',
    })

    const adapter = await app.container.make(InnovationDashboardAdapter)
    const result = await adapter.getSummary(owner, Number(org.id), project.id)

    assert.isTrue(result.hasViewPermission)
    assert.equal(result.summary?.openSchemeCount, 1)
    assert.equal(result.summary?.pendingHandoffCount, 1)
    assert.equal(result.summary?.warningCount, 1)
    assert.isTrue(result.summary?.staleMarker)
    assert.isNotNull(result.summary?.latestReviewedAt)

    const rows = await TrizInnovationScheme.query().where('project_id', project.id)
    assert.lengthOf(rows, 1)
  })

  test('missing permission returns masked summary without counts', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const workbench = await app.container.make(InnovationWorkbenchService)
    await workbench.createScheme({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      name: '不可泄露方案',
    })

    const viewer = await createUser({ email: uniqueEmail('iw-dash-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    const role = await ProjectRole.create({
      projectId: project.id,
      name: 'custom-no-workbench-dashboard',
      description: 'no workbench dashboard',
      permissions: [],
      isSystem: false,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: role.id,
      isActive: true,
    })

    const adapter = await app.container.make(InnovationDashboardAdapter)
    const result = await adapter.getSummary(viewer, Number(org.id), project.id)

    assert.isFalse(result.hasViewPermission)
    assert.isNull(result.summary)
  })
})
