/**
 * v3-llm-wiki-eval-gate —— 维基评测：问答集（命中、泄露、按运行者权限、记录不含原文）、计划回测（只用启动前样本与修订）、
 * 门禁三种结论、确定性、不调用模型不改维基、权限、请求校验与命令。全部 fixture。
 */
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import AuditLog from '#models/audit_log'
import KnowledgeItem from '#models/knowledge_item'
import Task from '#models/task'
import WikiIngestModelProvider, {
  type WikiIngestModelPort,
} from '#services/wiki_memory/ingest/wiki_ingest_model_port'
import { ProjectRoleName } from '#start/rbac/roles'
import { createProjectWithMember, useAuthDatabase } from '../auth/_helpers.js'
import {
  API,
  buildWorld,
  createPage,
  dataOf,
  expectStatus,
  pageBody,
  resolveSpace,
  type WikiWorld,
} from './_wiki_helpers.js'

const rule = (title: string, statement: string, userId: number, extra: string[] = []) =>
  pageBody({
    title,
    lines: [`- ${statement}[^c:r]`, '', `[^c:r]: user_statement#${userId} | kind:rule`],
    extraFrontmatter: extra,
  })

const Q = (question: string, expect: string[], forbid: string[] = []) => ({
  question,
  expect,
  forbid,
})

/** 五道题：两道维基能答、一道旧检索能答、一道都答不了、一道个人页里的禁止内容（运行者读不到）。 */
function questionSet() {
  return [
    Q('上线审批要几个人', ['双人审批']),
    Q('证书申请周期多长', ['三周']),
    Q('知识库里的发布规范', ['发布规范']),
    Q('年会场地在哪里', ['会展中心']),
    Q('薪资怎么调整', ['季度'], ['薪资按季度调整']),
  ]
}

async function seedWiki(client: any, w: WikiWorld) {
  const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
  await expectStatus(
    createPage(
      client,
      w.auth.admin,
      space.id,
      'release',
      rule('发布流程', '上线需双人审批。', w.admin.id),
    ),
    201,
  )
  await expectStatus(
    createPage(
      client,
      w.auth.admin,
      space.id,
      'cert',
      rule('证书申请', '证书申请要预留三周。', w.admin.id),
    ),
    201,
  )
  // 成员的个人页：管理者读不到
  const mine = await dataOf(resolveSpace(client, w.auth.member, 'user', w.member.id))
  await expectStatus(
    createPage(
      client,
      w.auth.member,
      mine.id,
      'pay',
      rule('薪资', '薪资按季度调整。', w.member.id, []),
    ),
    201,
  )
  await KnowledgeItem.create({
    organizationId: w.org.id,
    layer: 'L1',
    layerMeta: {} as never,
    title: '知识库里的发布规范',
    content: '发布规范全文',
    status: 'active',
    domain: '发布',
    purpose: '规范',
    complexity: null,
    provenance: { sources: [] } as never,
    reviewHistory: [] as never,
    isSynthetic: false,
    syntheticMethod: null,
    createdBy: w.admin.id,
    updatedBy: null,
    lastReferencedAt: null,
    retentionDays: null,
  } as never)
  return space
}

/** 一个已完成任务：计划 planned 天，从 start（周一）起实际 actual 个工作日。 */
async function doneTask(projectId: number, start: string, planned: number, actual: number) {
  const s = DateTime.fromISO(start)
  await Task.create({
    projectId,
    name: `任务-${projectId}-${start}`,
    status: 'completed',
    taskType: 'task',
    priority: 'medium',
    durationDays: planned,
    actualStartDate: s,
    actualEndDate: s.plus({ days: actual - 1 }),
  } as never)
}

/** 8 个启动前完成、实际是计划 1.5 倍的历史任务；刷新计划档案得到「现在」发布的参照类页。 */
async function seedHistoryAndDossier(client: any, w: WikiWorld) {
  for (let i = 0; i < 8; i++) await doneTask(w.project.id, '2026-09-07', 2, 3)
  await expectStatus(
    client.post(`${API}/dossier/refresh`).header('authorization', w.auth.admin),
    200,
  )
}

/** 已完成的回测项目：启动日 start，两个实际 3 天、计划 2 天的任务（发生在启动之后）。 */
async function backtestProject(w: WikiWorld, start: string, taskStart: string) {
  const { project } = await createProjectWithMember(
    w.org,
    w.admin,
    w.pm,
    ProjectRoleName.PROJECT_MANAGER,
  )
  await db
    .from('projects')
    .where('id', project.id)
    .update({ status: 'completed', start_date: start })
  await doneTask(project.id, taskStart, 2, 3)
  await doneTask(project.id, taskStart, 2, 3)
  return project
}

function runEval(client: any, bearer: string, questions: unknown) {
  return client.post(`${API}/eval/run`).header('authorization', bearer).json({ questions })
}

class CountingProvider {
  created = 0
  async create(): Promise<WikiIngestModelPort | null> {
    this.created++
    return null
  }
}

test.group('记忆维基评测 · 问答集', (group) => {
  useAuthDatabase(group)

  test('命中与正确率；个人页的禁止内容不出现在管理者的维基上下文；记录不含原文；不调用模型、不改维基', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedWiki(client, w)
    const pagesBefore = await db.from('wiki_pages').where('organization_id', w.org.id)
    const revisionsBefore = await db.from('wiki_revisions').where('organization_id', w.org.id)

    const provider = new CountingProvider()
    app.container.swap(
      WikiIngestModelProvider,
      () => provider as unknown as WikiIngestModelProvider,
    )
    let report: any
    try {
      const res = await runEval(client, w.auth.admin, questionSet())
      res.assertStatus(201)
      report = res.body().data
    } finally {
      app.container.restore(WikiIngestModelProvider)
    }
    assert.equal(provider.created, 0)
    assert.equal(report.qa.questions, 5)
    assert.equal(report.qa.wiki.correct, 2)
    assert.equal(report.qa.wiki.leaks, 0)
    assert.equal(report.qa.legacy.correct, 1)
    assert.equal(report.qa.legacy.leaks, 0)
    assert.isAbove(report.qa.wiki.avgBytes, 0)
    // 回测项目不足 → 数据不足
    assert.equal(report.status, 'insufficient')
    assert.match(report.reasons.join(''), /可回测的已完成项目只有 0 个/)

    assert.lengthOf(
      await db.from('wiki_pages').where('organization_id', w.org.id),
      pagesBefore.length,
    )
    assert.lengthOf(
      await db.from('wiki_revisions').where('organization_id', w.org.id),
      revisionsBefore.length,
    )
    const row = await db.from('wiki_eval_runs').where('id', report.id).first()
    for (const text of ['上线审批要几个人', '双人审批', '会展中心', '薪资按季度调整'])
      assert.notInclude(`${row.qa_json}${row.backtest_json}${row.reasons_json}`, text)
    assert.lengthOf(JSON.parse(row.qa_json).items, 5)

    const audit = await AuditLog.query()
      .where('organization_id', w.org.id)
      .where('entity_type', 'wiki_eval_run')
      .firstOrFail()
    assert.notInclude(JSON.stringify(audit.metadata), '双人审批')
  })

  test('维基路径出现禁止内容即泄露并不通过；结果确定', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedWiki(client, w)
    const questions = [...questionSet().slice(0, 4), Q('上线审批要几个人', ['双人审批'], ['双人'])]
    const first = await dataOf(runEval(client, w.auth.admin, questions))
    assert.equal(first.qa.wiki.leaks, 1)
    assert.equal(first.status, 'failed')
    assert.match(first.reasons[0], /泄露/)
    const second = await dataOf(runEval(client, w.auth.admin, questions))
    assert.deepEqual(
      { qa: second.qa, backtest: second.backtest, status: second.status, reasons: second.reasons },
      { qa: first.qa, backtest: first.backtest, status: first.status, reasons: first.reasons },
    )
    const runs = await dataOf(client.get(`${API}/eval/runs`).header('authorization', w.auth.admin))
    assert.deepEqual(
      runs.map((r: { id: number }) => r.id),
      [second.id, first.id],
    )
  })

  test('权限、请求校验与未开启', async ({ client, assert }) => {
    const w = await buildWorld()
    await expectStatus(runEval(client, w.auth.member, questionSet()), 403)
    await expectStatus(client.get(`${API}/eval/runs`).header('authorization', w.auth.member), 403)
    const bad = await runEval(client, w.auth.admin, [{ question: 'x', expect: [] }])
    bad.assertStatus(400)
    assert.match(bad.body().error.message, /第 1 题的 expect/)
    await expectStatus(runEval(client, w.auth.admin, []), 400)
    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    await expectStatus(runEval(client, w.auth.admin, questionSet()), 503)
  })
})

test.group('记忆维基评测 · 计划回测与门禁', (group) => {
  useAuthDatabase(group)

  test('启动前的样本与参照类版本：三个项目、维基与现场计算都校准到实际，门禁通过', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedWiki(client, w)
    await seedHistoryAndDossier(client, w)
    for (let i = 0; i < 3; i++) await backtestProject(w, '2026-12-01', '2026-12-07')

    const report = await dataOf(runEval(client, w.auth.admin, questionSet()))
    assert.equal(report.backtest.projects, 3)
    assert.equal(report.backtest.tasks, 6)
    assert.deepEqual(report.backtest.methods.baseline, { mape: 0.33, p80Coverage: 0 })
    assert.equal(report.backtest.methods.legacy.mape, 0)
    assert.equal(report.backtest.methods.wiki.mape, 0)
    assert.equal(report.backtest.methods.wiki.p80Coverage, 100)
    assert.equal(report.status, 'passed')
  })

  test('启动后完成的样本与启动后发布的参照类版本都不参与', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedWiki(client, w)
    // 历史任务在 2026-09 完成、参照类页「现在」发布，而回测项目 2026-01-01 就已启动
    await seedHistoryAndDossier(client, w)
    for (let i = 0; i < 3; i++) await backtestProject(w, '2026-01-01', '2026-01-05')
    const report = await dataOf(runEval(client, w.auth.admin, questionSet()))
    assert.equal(report.backtest.projects, 3)
    assert.deepEqual(report.backtest.methods.legacy, report.backtest.methods.baseline)
    assert.deepEqual(report.backtest.methods.wiki, report.backtest.methods.baseline)
    assert.equal(report.status, 'passed')
  })

  test('命令 wiki:eval 输出结论；问答集不合规时退出码 1', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedWiki(client, w)
    const ok = join(tmpdir(), `wiki-eval-${w.org.id}.json`)
    const bad = join(tmpdir(), `wiki-eval-bad-${w.org.id}.json`)
    await writeFile(ok, JSON.stringify(questionSet()))
    await writeFile(bad, JSON.stringify([{ question: '' }]))
    const { default: WikiEval } = await import('../../../commands/wiki_eval.js')
    const ace = await app.container.make('ace')
    const command = await ace.create(WikiEval, [`--org=${w.org.id}`, `--file=${ok}`])
    await command.exec()
    command.assertSucceeded()
    assert.lengthOf(await db.from('wiki_eval_runs').where('organization_id', w.org.id), 1)
    const failing = await ace.create(WikiEval, [`--org=${w.org.id}`, `--file=${bad}`])
    await failing.exec()
    assert.equal(failing.exitCode, 1)
    const missing = await ace.create(WikiEval, ['--org=999999', `--file=${ok}`])
    await missing.exec()
    assert.equal(missing.exitCode, 1)
  })
})
