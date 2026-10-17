import ChangeImpactAnalysis from '#models/change_impact_analysis'
import ChangeRequest from '#models/change_request'
import ChangeImpactReportDataSource from '#services/change_impact/report_data_source'
import { ProjectRoleName } from '#rbac'
import type Organization from '#models/organization'
import type Project from '#models/project'
import type User from '#models/user'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

async function setup(prefix = 'ci-report'): Promise<{
  owner: User
  org: Organization
  project: Project
}> {
  const owner = await createUser({ email: uniqueEmail(prefix) })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

let crSeq = 0
async function makeCr(
  org: Organization,
  project: Project,
  user: User,
  overrides: Partial<ChangeRequest> = {},
): Promise<ChangeRequest> {
  crSeq += 1
  return ChangeRequest.create({
    crCode: `CR-RPT-${process.pid}-${crSeq}`,
    organizationId: org.id,
    projectId: project.id,
    requesterId: user.id,
    requestedBy: user.id,
    title: '报表影响分析变更',
    changeType: 'scope',
    status: 'draft',
    priority: 'medium',
    ...overrides,
  })
}

test.group('ChangeImpactReportDataSource', (group) => {
  useAuthDatabase(group)

  test('输出覆盖率、严重度分布、过期数、审批引用率和关闭率', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const cr1 = await makeCr(org, project, owner)
    await makeCr(org, project, owner, { status: 'closed' })

    const analysis = await ChangeImpactAnalysis.create({
      organizationId: org.id,
      projectId: project.id,
      changeRequestId: cr1.id,
      ruleVersion: '2.0.0',
      inputSignature: 'sig-rpt',
      status: 'stale',
      summary: {
        totalAffected: 3,
        severityDistribution: { critical: 1, high: 1, medium: 1, low: 0, none: 0 },
        dimensionSummaries: [],
        criticalPathAffected: true,
        hasBlockingWarnings: true,
      },
      createdBy: owner.id,
    })
    cr1.currentImpactAnalysisId = analysis.id
    cr1.approveRefAnalysisId = analysis.id
    await cr1.save()

    const stats = await new ChangeImpactReportDataSource().getStats(project.id, org.id)

    assert.equal(stats.totalChangeRequests, 2)
    assert.equal(stats.analyzedCount, 1)
    assert.equal(stats.analysisCoverage, 50)
    assert.equal(stats.severityDistribution.critical, 1)
    assert.equal(stats.severityDistribution.high, 1)
    assert.equal(stats.staleCount, 1)
    assert.equal(stats.approveReferenceRate, 50)
    assert.equal(stats.implementedClosedRate, 50)
    assert.deepEqual(stats.warnings, [])
  })

  test('按 organization_id + project_id 过滤，不把同项目 id 不同组织外的数据计入', async ({
    assert,
  }) => {
    const a = await setup('ci-report-a')
    const b = await setup('ci-report-b')
    await makeCr(a.org, a.project, a.owner)
    await makeCr(b.org, b.project, b.owner)

    const stats = await new ChangeImpactReportDataSource().getStats(a.project.id, a.org.id)

    assert.equal(stats.totalChangeRequests, 1)
    assert.equal(stats.analyzedCount, 0)
  })
})
