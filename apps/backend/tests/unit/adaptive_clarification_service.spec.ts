import { test } from '@japa/runner'
import {
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  ADAPTIVE_CLARIFICATION_LIMITS,
  type AdaptiveClarificationSession,
  type InformationNeed,
  type ProjectUnderstanding,
} from '@aiproj/types'
import type { GenerateOptions, GenerateResult } from '../../app/services/ai_m0/gateway.js'
import AdaptiveClarificationService from '../../app/services/ai_intent/adaptive_clarification_service.js'

function need(index: number, overrides: Partial<InformationNeed> = {}): InformationNeed {
  return {
    id: `need:${index}`,
    topic: `project.decision.${index}`,
    missingInformation: `第 ${index} 个会改变计划的资料`,
    decisionImpact: ['scope', 'schedule'],
    whyItMatters: '这个答案会改变工作安排和完成时间。',
    priority: 'high',
    answerKind: 'short_text',
    confidence: 0.9,
    uncertainty: 0.8,
    userEffort: 'low',
    sensitivity: 'none',
    ...overrides,
  }
}

function understanding(needs: InformationNeed[], overrides: Partial<ProjectUnderstanding> = {}) {
  return {
    schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
    summaryForUser: '这是一个需要逐步确认关键决定的项目。',
    inferredDomainLabel: '用户描述的项目',
    intendedOutcome: '完成用户需要的结果',
    likelyDeliverables: ['可执行计划'],
    knownFacts: [],
    informationNeeds: needs,
    sufficientForPreliminaryDraft: needs.length === 0,
    ...overrides,
  } satisfies ProjectUnderstanding
}

/** 「检查回答是否对题」的调用：假模型统一回「已答到」，不占按顺序返回的理解结果。 */
function answerCheck(options?: { promptName?: string }): GenerateResult | null {
  if (options?.promptName !== 'intent.answer_check') return null
  return {
    rawText: JSON.stringify({ verdict: 'answered', normalized: '', notice: '' }),
    triggeredErrors: [],
    outputTokens: 10,
    firstTokenMs: 1,
    totalMs: 2,
    usingRealAdapter: false,
  }
}

function generated(value: ProjectUnderstanding): GenerateResult {
  return {
    rawText: JSON.stringify(value),
    triggeredErrors: [],
    outputTokens: 200,
    firstTokenMs: 5,
    totalMs: 20,
    usingRealAdapter: false,
  }
}

test.group('AdaptiveClarificationService', () => {
  test('自然表达可分类为回答、原因、含义、建议、背景、未知与修改，多意图可并存', ({ assert }) => {
    const service = new AdaptiveClarificationService()
    assert.includeMembers(
      service
        .classifyResponse('大约 500 人。为什么这个会影响计划？')
        .intents.map((item) => item.intent),
      ['answer', 'ask_why'],
    )
    assert.include(
      service.classifyResponse('我不明白这句话是什么意思').intents.map((item) => item.intent),
      'ask_meaning',
    )
    assert.include(
      service.classifyResponse('你建议我怎么选？').intents.map((item) => item.intent),
      'request_recommendation',
    )
    assert.include(
      service.classifyResponse('场地还没定，但礼堂最多 800 人').intents.map((item) => item.intent),
      'add_context',
    )
    assert.include(
      service.classifyResponse('目前还不确定').intents.map((item) => item.intent),
      'unknown',
    )
    const edit = service.classifyResponse('我刚才说错了，人数应该是 800 人')
    assert.include(
      edit.intents.map((item) => item.intent),
      'edit_answer',
    )
    assert.equal(
      edit.intents.find((item) => item.intent === 'edit_answer')?.extractedValue,
      '800 人',
    )
  })

  test('已知事实不会再次成为 active need，模型输入包含答案与 known unknown 摘要', async ({
    assert,
  }) => {
    let captured: GenerateOptions | null = null
    const gateway = {
      async generate(options: GenerateOptions) {
        captured = options
        return generated(
          understanding(
            [
              need(1, { topic: '参加人数', missingInformation: '大约有多少人参加' }),
              need(2, { topic: '可用场地', missingInformation: '目前可使用什么场地' }),
            ],
            {
              knownFacts: [
                {
                  id: 'fact:people',
                  topic: '参加人数',
                  value: '500 人',
                  evidence: '用户明确说约 500 人',
                  confidence: 1,
                  source: 'initial_intent',
                },
              ],
            },
          ),
        )
      },
    }
    const session = await new AdaptiveClarificationService().start({
      gateway,
      rawInput:
        '我要安排一个大约 500 人参与的项目，并产出完整计划。下周一开工，工期 2 个月，筹备团队 6 人。',
    })
    assert.equal(session.conversation?.activeNeedId, 'need:2')
    assert.include(
      (captured as GenerateOptions | null)?.promptSet?.systemPrompt ?? '',
      '不要使用固定行业问卷',
    )
  })

  test('自然追问原因与建议不会推进问题或把建议当答案', async ({ assert }) => {
    let calls = 0
    const gateway = {
      async generate() {
        calls += 1
        return generated(
          understanding([
            need(1, {
              suggestedOptions: [{ id: 'small', label: '先从小范围开始', value: 'small' }],
            }),
          ]),
        )
      },
    }
    const service = new AdaptiveClarificationService()
    let session = await service.start({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    session = await service.continue({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '为什么要问这个？你建议怎么选？',
    })
    assert.equal(calls, 1)
    assert.equal(session.conversation?.activeNeedId, 'need:1')
    assert.equal(session.ledger.entries.length, 0)
    assert.includeMembers(session.conversation?.turns.map((item) => item.kind) ?? [], [
      'explanation',
      'recommendation',
    ])
  })

  test('explicit unknown 写入 known unknown，并且下一轮不会无限重问', async ({ assert }) => {
    let calls = 0
    const gateway = {
      async generate() {
        calls += 1
        return generated(
          calls === 1
            ? understanding([need(1), need(2)])
            : understanding([need(1), need(2)], { sufficientForPreliminaryDraft: false }),
        )
      },
    }
    const service = new AdaptiveClarificationService()
    let session = await service.start({
      gateway,
      rawInput: '请规划一个资料不足的新项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    session = await service.continue({
      gateway,
      rawInput: '请规划一个资料不足的新项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '这件事现在还不确定，先列为待决定事项',
    })
    assert.equal(session.knownUnknowns[0]?.needId, 'need:1')
    assert.equal(session.conversation?.activeNeedId, 'need:2')
    assert.equal(session.ledger.entries[0]?.status, 'known_unknown')
  })

  test('混合回答和追问可推进；修改旧答案会修订 ledger 后重新规划', async ({ assert }) => {
    let calls = 0
    const gateway = {
      async generate(options?: { promptName?: string }) {
        const check = answerCheck(options)
        if (check) return check
        calls += 1
        if (calls === 1) return generated(understanding([need(1)]))
        if (calls === 2) return generated(understanding([need(2)]))
        return generated(understanding([], { sufficientForPreliminaryDraft: true }))
      },
    }
    const service = new AdaptiveClarificationService()
    let session = await service.start({
      gateway,
      rawInput: '请规划一个需要逐步确认的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    session = await service.continue({
      gateway,
      rawInput: '请规划一个需要逐步确认的项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '大约 500 人。为什么这个会影响计划？',
    })
    assert.equal(session.ledger.entries[0]?.answer, '大约 500 人')
    assert.include(session.conversation?.turns.map((item) => item.kind) ?? [], 'explanation')

    session = await service.continue({
      gateway,
      rawInput: '请规划一个需要逐步确认的项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '我刚才说错了，应该是 800 人',
    })
    assert.equal(
      session.ledger.entries.find((entry) => entry.needId === 'need:1')?.answer,
      '800 人',
    )
    assert.equal(session.ledger.revision, 2)
  })

  test('正常流程可超过五轮，并以信息充分而不是固定次数完成', async ({ assert }) => {
    let calls = 0
    const gateway = {
      async generate(options?: { promptName?: string }) {
        const check = answerCheck(options)
        if (check) return check
        calls += 1
        const nextIndex = calls
        return generated(
          calls <= 7
            ? understanding([need(nextIndex)])
            : understanding([], { sufficientForPreliminaryDraft: true }),
        )
      },
    }
    const service = new AdaptiveClarificationService()
    let session = await service.start({
      gateway,
      rawInput: '请规划一个需要多轮确认的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    for (let index = 1; index <= 7; index += 1) {
      session = await service.continue({
        gateway,
        rawInput: '请规划一个需要多轮确认的项目。下周一开工，工期 3 个月，团队 5 人。',
        session,
        responseText: `第 ${index} 项已经确认`,
      })
    }
    assert.equal(calls, 8)
    assert.equal(session.status, 'ready')
    assert.equal(session.ledger.entries.length, 7)
    assert.isAbove(session.round, 5)
  })

  test('安全轮次 guard 保留全部答案并进入 needs_human_review', async ({ assert }) => {
    const gateway = {
      async generate() {
        return generated(understanding([need(1)]))
      },
    }
    const service = new AdaptiveClarificationService()
    const started = await service.start({
      gateway,
      rawInput: '请规划一个需要检查的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    const guarded = await service.continue({
      gateway,
      rawInput: '请规划一个需要检查的项目。下周一开工，工期 3 个月，团队 5 人。',
      session: {
        ...started,
        round: ADAPTIVE_CLARIFICATION_LIMITS.maxSessionRounds,
        ledger: {
          ...started.ledger,
          revision: 1,
          entries: [
            {
              needId: 'old',
              topic: '旧答案',
              status: 'answered',
              questionSummary: '之前的问题',
              answer: '已回答',
              revision: 1,
              updatedAt: '2026-08-31T00:00:00.000Z',
            },
          ],
        },
      } as AdaptiveClarificationSession,
      responseText: '继续',
    })
    assert.equal(guarded.status, 'needs_human_review')
    assert.lengthOf(guarded.ledger.entries, 1)
  })

  test('初步草案只在 blocking/high 均已回答或 known unknown 后开放', async ({ assert }) => {
    const gateway = {
      async generate() {
        return generated(understanding([need(1)]))
      },
    }
    const service = new AdaptiveClarificationService()
    const blocked = await service.start({
      gateway,
      rawInput: '请规划一个还缺关键资料的新项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    assert.equal(service.requestPreliminaryDraft(blocked).status, 'needs_human_review')

    const usefulOnly: AdaptiveClarificationSession = {
      ...blocked,
      status: 'clarifying',
      understanding: {
        ...blocked.understanding,
        informationNeeds: [need(2, { priority: 'useful' })],
      },
      conversation: blocked.conversation
        ? { ...blocked.conversation, canGeneratePreliminaryDraft: true }
        : null,
    }
    assert.equal(service.requestPreliminaryDraft(usefulOnly).status, 'ready')
  })

  test('要选项与向 AI 提问都不会被记成答案，简繁输入一致', ({ assert }) => {
    const service = new AdaptiveClarificationService()
    for (const text of ['请给我几个选项', '請你給我選項', '有哪些可选的', '给我选择题']) {
      const intents = service.classifyResponse(text).intents.map((item) => item.intent)
      assert.include(intents, 'request_options', text)
      // 关键：不能同时被兜底成 answer，否则这句话会被写进 ledger
      assert.notInclude(intents, 'answer', text)
    }
    // 首句是问句时一律改走解释路径，而不是记成答案
    assert.deepEqual(
      service.classifyResponse('这题要怎么办？').intents.map((item) => item.intent),
      ['ask_meaning'],
    )
    // 繁体的既有意图同样要识别
    assert.include(
      service.classifyResponse('請給我建議').intents.map((item) => item.intent),
      'request_recommendation',
    )
    assert.include(
      service.classifyResponse('還不確定').intents.map((item) => item.intent),
      'unknown',
    )
    // 正常作答不受影响
    assert.include(
      service.classifyResponse('先按公司现在的做法办').intents.map((item) => item.intent),
      'answer',
    )
  })

  test('要选项会为当前问题补候选项，不推进到下一题也不代替作答', async ({ assert }) => {
    const optionPayload = {
      options: [
        { id: 'keep', label: '沿用现有做法', value: '沿用现有做法', description: '先不改流程' },
        { id: 'configurable', label: '需要在系统里可配置', value: '需要在系统里可配置' },
        { id: 'fabricated', label: '每人每天 200 元上限', value: '每人每天 200 元上限' },
      ],
    }
    const gateway = {
      async generate(options: GenerateOptions): Promise<GenerateResult> {
        if (options.sentence === '为当前澄清问题补充候选项') {
          return { ...generated(understanding([])), rawText: JSON.stringify(optionPayload) }
        }
        return generated(understanding([need(1, { answerKind: 'single_choice' })]))
      },
    }
    const service = new AdaptiveClarificationService()
    const started = await service.start({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    const activeNeedId = started.conversation?.activeNeedId
    assert.isEmpty(started.conversation?.activeQuestion.options ?? [])

    const next = await service.continue({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
      session: started,
      responseText: '请给我几个选项',
    })

    // 仍停在同一题，ledger 没有被写入
    assert.equal(next.conversation?.activeNeedId, activeNeedId)
    assert.isEmpty(next.ledger.entries)
    // 候选项已补上；含具体档次（金额/人数）的候选项同样保留——它们要用户点选才生效，
    // 配合恒开的「其他」比抽象说法更好选。
    const labels = (next.conversation?.activeQuestion.options ?? []).map((item) => item.label)
    assert.deepEqual(labels, ['沿用现有做法', '需要在系统里可配置', '每人每天 200 元上限'])
    assert.isTrue(next.conversation?.activeQuestion.allowOther)
  })

  test('金额类问题同样会补参考档次，不再整类跳过', async ({ assert }) => {
    let optionCalls = 0
    const gateway = {
      async generate(options: GenerateOptions): Promise<GenerateResult> {
        if (options.sentence === '为当前澄清问题补充候选项') {
          optionCalls += 1
          return {
            ...generated(understanding([])),
            rawText: JSON.stringify({
              options: [
                { id: 'low', label: '10 万以内', value: '10 万以内' },
                { id: 'mid', label: '10 万到 50 万', value: '10 万到 50 万' },
              ],
            }),
          }
        }
        return generated(understanding([need(1, { answerKind: 'money' })]))
      },
    }
    const service = new AdaptiveClarificationService()
    const started = await service.start({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    const next = await service.continue({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
      session: started,
      responseText: '请给我几个选项',
    })

    assert.equal(optionCalls, 1, '金额类问题也应该向模型索取参考档次')
    assert.deepEqual(
      (next.conversation?.activeQuestion.options ?? []).map((item) => item.label),
      ['10 万以内', '10 万到 50 万'],
    )
    assert.isTrue(next.conversation?.activeQuestion.allowOther)
  })

  test('每一道题都开放「其他」自由输入，无论模型有没有给选项', async ({ assert }) => {
    const gateway = {
      async generate(): Promise<GenerateResult> {
        return generated(
          understanding([need(1, { answerKind: 'short_text', priority: 'blocking' })]),
        )
      },
    }
    const session = await new AdaptiveClarificationService().start({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    assert.isEmpty(session.conversation?.activeQuestion.options ?? [])
    // 没有选项恰恰是最需要自由输入的情况，不能反而关掉「其他」
    assert.isTrue(session.conversation?.activeQuestion.allowOther)
  })

  test('解释当前问题只流式输出、不碰 ledger 也不推进题目', async ({ assert }) => {
    let streamedPrompt = ''
    const gateway = {
      async generate(): Promise<GenerateResult> {
        return generated(understanding([need(1)]))
      },
      async *stream(options: GenerateOptions) {
        streamedPrompt = options.promptSet?.systemPrompt ?? ''
        yield { kind: 'text' as const, text: '这题想确认的是' }
        yield { kind: 'text' as const, text: '你现在的做法。' }
        yield { kind: 'done' as const }
      },
    }
    const service = new AdaptiveClarificationService()
    const session = await service.start({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    const activeNeed = session.understanding.informationNeeds.find(
      (item) => item.id === session.conversation?.activeNeedId,
    )!

    let text = ''
    for await (const delta of service.explainQuestion({
      gateway: gateway as never,
      need: activeNeed,
      question: session.conversation!.activeQuestion,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
      ledger: session.ledger,
      history: [],
      userQuestion: '',
    })) {
      text += delta
    }

    assert.equal(text, '这题想确认的是你现在的做法。')
    assert.include(streamedPrompt, '不要替用户作答')
    // 只读：会话与 ledger 都没有被动过
    assert.isEmpty(session.ledger.entries)
    assert.equal(session.conversation?.activeNeedId, activeNeed.id)
  })

  test('守卫态可以重跑这一步，已确认的答案不会丢', async ({ assert }) => {
    let calls = 0
    const gateway = {
      async generate(options?: { promptName?: string }): Promise<GenerateResult> {
        const check = answerCheck(options)
        if (check) return check
        calls += 1
        // 第二轮（回答之后）连同两次修复重试全部报错，把会话打进守卫态
        if (calls >= 2 && calls <= 2 + ADAPTIVE_CLARIFICATION_LIMITS.maxRepairAttempts) {
          return {
            rawText: '',
            triggeredErrors: ['malformed_json'],
            triggeredErrorMessages: ['Connection error.'],
            outputTokens: 0,
            firstTokenMs: 1,
            totalMs: 2,
            usingRealAdapter: false,
          }
        }
        return generated(understanding([need(calls === 1 ? 1 : 3)]))
      },
    }
    const service = new AdaptiveClarificationService()
    let session = await service.start({
      gateway,
      rawInput: '请规划一个需要多轮确认的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    session = await service.continue({
      gateway,
      rawInput: '请规划一个需要多轮确认的项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '先按公司现在的做法办',
    })

    assert.equal(session.status, 'needs_human_review')
    assert.equal(session.ledger.entries.length, 1, '答案必须先被保留下来')
    // 报错要说人话，同时保留技术原因
    assert.include(session.guardReason ?? '', '重试一次通常就能过')
    assert.include(session.guardReason ?? '', 'Connection error.')

    // continue() 在守卫态下原样返回——这正是原来的死胡同
    const stuck = await service.continue({
      gateway,
      rawInput: '请规划一个需要多轮确认的项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '再试一次',
    })
    assert.equal(stuck.status, 'needs_human_review')

    const recovered = await service.retryGuarded({
      gateway,
      rawInput: '请规划一个需要多轮确认的项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
    })
    assert.equal(recovered.status, 'clarifying')
    assert.equal(recovered.ledger.entries.length, 1, '重试不能清掉已确认的答案')
    assert.isNotNull(recovered.conversation)
  })

  test('选项答案落库时换回用户看到的 label，自由输入保持原文', async ({ assert }) => {
    const gateway = {
      async generate(): Promise<GenerateResult> {
        return generated(
          understanding([
            need(1, {
              answerKind: 'multi_choice',
              suggestedOptions: [
                { id: 'a', label: '差旅费用', value: 'travel' },
                { id: 'b', label: '日常办公与交通', value: 'daily_office_transport' },
              ],
            }),
          ]),
        )
      },
    }
    const service = new AdaptiveClarificationService()
    const started = await service.start({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
    })

    // 多选按钮提交的是模型定的机器键
    const picked = await service.continue({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
      session: started,
      responseText: 'travel、daily_office_transport',
    })
    assert.equal(
      picked.ledger.entries.find((entry) => entry.needId === 'need:1')?.answer,
      '差旅费用、日常办公与交通',
      '已确认列表里不能出现 travel 这种机器键',
    )

    // 「其他」里自己写的话必须原样保留，不能被顿号重组或改写
    const typed = await service.continue({
      gateway,
      rawInput: '请帮我规划一个新项目。下周一开工，工期 3 个月，团队 5 人。',
      session: started,
      responseText: '先按公司现行做法办，细节以后再补',
    })
    assert.equal(
      typed.ledger.entries.find((entry) => entry.needId === 'need:1')?.answer,
      '先按公司现行做法办，细节以后再补',
    )
  })

  /* ------------------------------------------------------------------ *
   * 以下为用户实测反馈的缺陷回归：答案错配、不收敛、自由文本漏读、
   * 模型失败恢复、进度不一致、选项覆盖不全。
   * ------------------------------------------------------------------ */

  test('P0 普通答案里的「应该是」不再被当成修改指令，答案落在当前这道题上', async ({ assert }) => {
    let calls = 0
    const gateway = {
      async generate() {
        calls += 1
        return generated(
          understanding([
            need(1, { topic: '预算', missingInformation: '这个项目预算大概多少' }),
            need(2, { topic: '到岗统计', missingInformation: '到岗人数怎么统计' }),
          ]),
        )
      },
    }
    const service = new AdaptiveClarificationService()
    let session = await service.start({
      gateway,
      rawInput: '请规划一个需要排期的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    session = await service.continue({
      gateway,
      rawInput: '请规划一个需要排期的项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '大概 30 万',
    })
    const first = session.conversation?.activeNeedId
    assert.equal(session.ledger.entries[0]?.needId, 'need:1')

    // 关键：这句话含「应该是」，旧实现会判成 edit_answer 并覆盖上一条 ledger 条目，
    // 于是「到岗统计」的答案显示在「预算」问题下面，当前这题还永远没关闭。
    session = await service.continue({
      gateway,
      rawInput: '请规划一个需要排期的项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '到岗统计应该是按打卡记录算',
    })
    const cycle = session.ledger.entries.find((entry) => entry.needId === 'need:1')
    assert.equal(cycle?.answer, '大概 30 万', '预算的答案不能被后一题的回答覆盖')
    assert.equal(
      session.ledger.entries.find((entry) => entry.needId === first)?.answer,
      '到岗统计应该是按打卡记录算',
    )
    assert.isAtLeast(calls, 2)
  })

  test('P0 未点名的「刚才说错了」改最近一条，但必须明确告知落点', async ({ assert }) => {
    const gateway = {
      async generate() {
        return generated(understanding([need(1), need(2)]))
      },
    }
    const service = new AdaptiveClarificationService()
    let session = await service.start({
      gateway,
      rawInput: '请规划一个需要修订答案的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    session = await service.continue({
      gateway,
      rawInput: '请规划一个需要修订答案的项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '大约 500 人',
    })
    session = await service.continue({
      gateway,
      rawInput: '请规划一个需要修订答案的项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '我刚才说错了，应该是 800 人',
    })
    assert.equal(
      session.ledger.entries.find((entry) => entry.needId === 'need:1')?.answer,
      '800 人',
    )
    const texts = (session.conversation?.turns ?? []).map((item) => item.text).join('\n')
    assert.include(texts, '你没有指明要改哪一题', '猜的落点必须说出来，用户才能发现猜错了')
  })

  test('P0 同一主题换个 id 重问会被丢弃，不再重复追问', async ({ assert }) => {
    const gateway = {
      async generate() {
        return generated(
          understanding([
            need(9, {
              id: 'need:renamed',
              topic: '到岗统计口径',
              missingInformation: '到岗人数按什么口径统计',
            }),
          ]),
        )
      },
    }
    const service = new AdaptiveClarificationService()
    let session = await service.start({
      gateway,
      rawInput: '请规划一个统计口径待定的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    assert.equal(session.conversation?.activeNeedId, 'need:renamed')
    session = await service.continue({
      gateway,
      rawInput: '请规划一个统计口径待定的项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '按考勤打卡记录统计',
    })
    // 模型下一轮返回的是同一件事、只是换了 id；旧实现只按 needId 去重，会原样再问一遍。
    assert.isNull(session.conversation, '同一个主题不能换个 id 再问一次')
    assert.equal(session.status, 'ready')
  })

  test('P0 模型判定资料已足够时，即使还有 high 需求也开放生成入口', async ({ assert }) => {
    const gateway = {
      async generate() {
        return generated(
          understanding([need(1, { priority: 'high' }), need(2, { priority: 'high' })], {
            sufficientForPreliminaryDraft: true,
          }),
        )
      },
    }
    const service = new AdaptiveClarificationService()
    const session = await service.start({
      gateway,
      rawInput: '请规划一个资料已经比较全的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    assert.isTrue(
      session.conversation?.canGeneratePreliminaryDraft,
      '模型说了资料够用，就必须给出口，不能只说不放行',
    )
    const drafted = service.requestPreliminaryDraft(session)
    assert.equal(drafted.status, 'ready')
    assert.isNotEmpty(drafted.knownUnknowns, '未确认项要转成待决定事项，随草案标为假设与风险')
  })

  test('P1 同一段话里的多个字段会被一并吸收，不再事后重问', async ({ assert }) => {
    const gateway = {
      async generate() {
        return generated(
          understanding([
            need(1, {
              topic: '培训日期',
              missingInformation: '用户培训安排在哪一天',
              answerKind: 'date',
            }),
            need(2, {
              topic: '预算',
              missingInformation: '预算大概多少万',
              answerKind: 'number',
            }),
            need(3, {
              topic: '验收标准',
              missingInformation: '怎样才算这次做完了',
            }),
          ]),
        )
      },
    }
    const service = new AdaptiveClarificationService()
    let session = await service.start({
      gateway,
      rawInput: '请规划一个要上线的系统项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    session = await service.continue({
      gateway,
      rawInput: '请规划一个要上线的系统项目。下周一开工，工期 3 个月，团队 5 人。',
      session,
      responseText: '培训安排在 12 月 20 日，预算大概 30 万',
    })
    const absorbed = session.ledger.entries.find((entry) => entry.source === 'absorbed')
    assert.isDefined(absorbed, '第二个字段必须被吸收，而不是丢掉后重新追问')
    assert.include(String(absorbed?.answer), '30')
    assert.include(
      (session.conversation?.turns ?? []).map((item) => item.text).join('\n'),
      '你这段话里还回答了',
      '额外吸收的内容必须告知用户，便于当场纠正',
    )
  })

  test('P1 「不确定」只在首句成立，带具体值的回答不会整条被记成待决定', ({ assert }) => {
    const service = new AdaptiveClarificationService()
    const mixed = service.classifyResponse('大概 5 个人，具体分工还不确定')
    assert.include(
      mixed.intents.map((item) => item.intent),
      'answer',
    )
    assert.notInclude(
      mixed.intents.map((item) => item.intent),
      'unknown',
    )
    // 整句就是「不知道」时仍然要记成待决定
    assert.include(
      service.classifyResponse('这件事现在还不确定').intents.map((item) => item.intent),
      'unknown',
    )
  })

  test('P1 缺字段与 null 占位在本地修好，不再为此多跑一轮模型', async ({ assert }) => {
    let calls = 0
    const gateway = {
      async generate(): Promise<GenerateResult> {
        calls += 1
        return {
          rawText: JSON.stringify({
            schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
            summaryForUser: '一个需要确认若干决定的项目。',
            inferredDomainLabel: '用户描述的项目',
            likelyDeliverables: ['计划'],
            knownFacts: [],
            informationNeeds: [
              {
                id: 'need:1',
                topic: '范围',
                missingInformation: '这次一定要做的事情有哪些',
                // decisionImpact 写成字符串、缺 confidence/uncertainty/sensitivity、
                // 可选字段用 null 占位——全是模型最常犯的机械性错误。
                decisionImpact: 'scope,timeline',
                whyItMatters: '范围会直接决定工期和人力。',
                priority: 'high',
                answerKind: 'short_text',
                suggestedOptions: null,
                dependsOn: null,
              },
            ],
            sufficientForPreliminaryDraft: false,
          }),
          triggeredErrors: [],
          outputTokens: 120,
          firstTokenMs: 4,
          totalMs: 10,
          usingRealAdapter: false,
        }
      },
    }
    const session = await new AdaptiveClarificationService().start({
      gateway,
      rawInput: '请规划一个范围待定的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    assert.equal(calls, 1, '本地修得好的形状问题不该再问模型一次')
    assert.equal(session.status, 'clarifying')
    assert.equal(session.conversation?.activeNeedId, 'need:1')
  })

  test('P1 INVALID_ROOT 只让模型重写结构外壳，不重新分析项目', async ({ assert }) => {
    const seen: GenerateOptions[] = []
    const gateway = {
      async generate(options: GenerateOptions): Promise<GenerateResult> {
        seen.push(options)
        if (seen.length === 1) {
          return {
            rawText: '[1, 2, 3]',
            triggeredErrors: [],
            outputTokens: 5,
            firstTokenMs: 1,
            totalMs: 2,
            usingRealAdapter: false,
          }
        }
        return generated(understanding([need(1)]))
      },
    }
    const session = await new AdaptiveClarificationService().start({
      gateway,
      rawInput: '请规划一个结构会出错的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    assert.equal(session.status, 'clarifying')
    assert.lengthOf(seen, 2)
    const repairPrompt = seen[1]?.promptSet?.userPrompt ?? ''
    assert.include(repairPrompt, '只重写最外层的结构外壳')
    assert.notInclude(repairPrompt, '完整重写 JSON')
  })

  test('P1 敏感度取值非法时说清是哪一条、收到的是什么值', async ({ assert }) => {
    const gateway = {
      async generate(): Promise<GenerateResult> {
        const payload = understanding([need(1)]) as unknown as Record<string, unknown>
        const needs = payload.informationNeeds as Record<string, unknown>[]
        needs[0]!.sensitivity = 'medium'
        return {
          rawText: JSON.stringify(payload),
          triggeredErrors: [],
          outputTokens: 60,
          firstTokenMs: 1,
          totalMs: 2,
          usingRealAdapter: false,
        }
      },
    }
    const service = new AdaptiveClarificationService()
    // 本地修复会把非法枚举值收敛回 none，所以这条正常通过——
    // 这正是「自动恢复」的目的：不要为一个枚举值把整轮作废。
    const session = await service.start({
      gateway,
      rawInput: '请规划一个敏感度标注有误的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    assert.equal(session.status, 'clarifying')
    assert.equal(session.understanding.informationNeeds[0]?.sensitivity, 'none')
  })

  test('P1 澄清进度分档之和恒等于剩余总数', async ({ assert }) => {
    const gateway = {
      async generate() {
        return generated(
          understanding([
            need(1, { priority: 'high' }),
            need(2, { priority: 'useful' }),
            need(3, { priority: 'optional' }),
          ]),
        )
      },
    }
    const session = await new AdaptiveClarificationService().start({
      gateway,
      rawInput: '请规划一个有多档缺口的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    const breakdown = session.conversation?.remainingBreakdown
    assert.isDefined(breakdown)
    assert.equal(
      (breakdown?.critical ?? 0) + (breakdown?.recommended ?? 0) + (breakdown?.optional ?? 0),
      session.conversation?.remainingEstimate,
      '左侧三档之和必须等于右侧剩余数，两边不能各算各的',
    )
    assert.isNotEmpty(session.conversation?.coverage ?? [])
  })

  test('P2 日期/人数题在模型没给选项时也有可点的档位', async ({ assert }) => {
    const gateway = {
      async generate() {
        return generated(
          understanding([
            need(1, {
              answerKind: 'date',
              topic: '培训日期',
              missingInformation: '用户培训安排在哪一天',
            }),
          ]),
        )
      },
    }
    const session = await new AdaptiveClarificationService().start({
      gateway,
      rawInput: '请规划一个需要定上线时间的项目。下周一开工，工期 3 个月，团队 5 人。',
    })
    const options = session.conversation?.activeQuestion.options ?? []
    assert.isAtLeast(options.length, 2, '没有候选项就只能靠「其他」手写，这正是用户报的问题')
    assert.isTrue(session.conversation?.activeQuestion.allowOther)
  })
})
