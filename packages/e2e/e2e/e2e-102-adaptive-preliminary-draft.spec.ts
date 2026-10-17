import { expect, test } from '@playwright/test'
import { loginAsAdmin, setAuthSession } from './_auth-helper.js'

const RAW_INPUT = '筹备一个面向社区居民的公益活动，预计十月举行。'

function parsedIntent() {
  return {
    schemaVersion: '1.0',
    projectType: 'event',
    projectName: '社区公益活动',
    objectives: ['完成一场安全、可执行的公益活动'],
    deliverables: ['活动执行计划'],
    timeline: { startDate: null, deadline: null, durationDays: null },
    constraints: [],
    entities: [],
    overallConfidence: 0.82,
  }
}

function adaptiveSession(status: 'clarifying' | 'ready') {
  const knownUnknown = {
    needId: 'need:attendance',
    topic: '预计参加人数',
    reason: '目前还没有可靠人数',
    impact: '需要在场地、安全和现场人手安排中保留调整空间',
    recordedAt: '2026-08-31T00:00:00.000Z',
  }
  return {
    schemaVersion: '2.0',
    sessionId: 'e2e-adaptive-session',
    round: 3,
    understanding: {
      schemaVersion: '2.0',
      summaryForUser: '你要筹备一场社区公益活动。',
      inferredDomainLabel: '社区公益活动',
      intendedOutcome: '完成一场安全、可执行的公益活动',
      likelyDeliverables: ['活动执行计划'],
      knownFacts: [],
      informationNeeds: [],
      sufficientForPreliminaryDraft: true,
    },
    ledger: {
      schemaVersion: '2.0',
      revision: 2,
      entries: [
        {
          needId: 'need:attendance',
          topic: '预计参加人数',
          status: 'known_unknown',
          questionSummary: '大约有多少人参加？',
          answer: null,
          knownUnknown,
          revision: 2,
          updatedAt: '2026-08-31T00:00:00.000Z',
        },
      ],
    },
    knownUnknowns: [knownUnknown],
    status,
    conversation:
      status === 'ready'
        ? null
        : {
            schemaVersion: '2.0',
            activeNeedId: 'need:format',
            activeQuestion: {
              needId: 'need:format',
              question: '这次活动最希望采用哪一种主要形式？',
              reason: '活动形式会改变场地、流程和物资安排。',
              answerKind: 'short_text',
              options: [],
              allowOther: true,
              allowUnknown: true,
            },
            status: 'awaiting_response',
            turns: [
              {
                id: 'turn-1',
                role: 'assistant',
                kind: 'question',
                text: '这次活动最希望采用哪一种主要形式？',
                createdAt: '2026-08-31T00:00:00.000Z',
              },
            ],
            understandingRevision: 3,
            ledgerRevision: 2,
            completedCount: 2,
            remainingEstimate: 1,
            remainingEstimateReason: '目前只剩一个低优先资料，可先生成初步草案。',
            canGeneratePreliminaryDraft: true,
            currentUnderstanding: '日期已知；参加人数暂时未知，必须保留为待决定事项。',
          },
  }
}

function response(branch: 'clarify' | 'ready') {
  const intent = parsedIntent()
  const session = adaptiveSession(branch === 'ready' ? 'ready' : 'clarifying')
  return {
    parsedIntent: intent,
    cards: [],
    confirmedContext: {
      schemaVersion: '1.0',
      rawInput: RAW_INPUT,
      parsedIntent: intent,
      resolvedFields: {},
      assumptions: {},
      unresolvedCriticalFields: [],
      unansweredOptionalFields: [],
      adaptiveUnderstanding: session.understanding,
      adaptiveLedger: session.ledger,
      knownUnknowns: session.knownUnknowns,
    },
    branch,
    summary: { critical: 0, recommended: 0, optional: 0 },
    phase: branch === 'ready' ? 'ready' : 'agent',
    activeCard: null,
    remainingCount: branch === 'ready' ? 0 : 1,
    completedCount: 2,
    totalCount: 3,
    questionPlanRevision: null,
    coverage: {
      valid: true,
      requiredIds: [],
      coveredIds: [],
      missingIds: [],
      rejectedIds: [],
      reasonCodes: [],
      selectedPackIds: [],
    },
    adaptiveSession: session,
    adaptiveSessionToken: branch === 'ready' ? 'adaptive-token-ready' : 'adaptive-token-1',
  }
}

test('自适应澄清可进入初步草案，UI 列出待确认项并保留人工审查门', async ({ page, request }) => {
  const auth = await loginAsAdmin(request)
  let preliminaryRequested = false
  await page.route('**/api/v1/ai/project-intents/analyze', async (route) => {
    const body = route.request().postDataJSON() as { requestPreliminaryDraft?: boolean }
    preliminaryRequested = body.requestPreliminaryDraft === true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: response(preliminaryRequested ? 'ready' : 'clarify') }),
    })
  })

  await page.goto('/')
  await setAuthSession(page, auth)
  await page.goto('/ai-create')
  const onboarding = page.getByRole('button', { name: '关闭引导' })
  if (await onboarding.isVisible().catch(() => false)) await onboarding.click()

  await page.getByLabel('项目一句话描述').fill(RAW_INPUT)
  await page.getByRole('button', { name: /开始分析/ }).click()
  await expect(
    page.getByRole('heading', { name: '这次活动最希望采用哪一种主要形式？' }),
  ).toBeVisible()
  await expect(page.locator('article')).toHaveCount(1)

  await page.getByRole('button', { name: '先生成初步草案' }).click()
  await expect.poll(() => preliminaryRequested).toBe(true)
  await expect(page.getByRole('heading', { name: '上下文已就绪，准备生成草案' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '初步草案仍有 1 项待确认' })).toBeVisible()
  await expect(page.getByText('预计参加人数')).toBeVisible()
  await expect(page.getByText(/不会自行编造具体答案/)).toBeVisible()
  await expect(page.getByText(/生成结果仍须经过人工审查/)).toBeVisible()
  await expect(page.getByRole('button', { name: '开始生成草案' })).toBeVisible()
})
