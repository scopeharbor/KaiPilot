/**
 * ai-structured-output-poc / M0 —— 恢复层与三档判定的单元测试。
 *
 * 覆盖点：
 *  - preClean / tryParseJson：markdown fence、BOM、尾逗号、截断；
 *  - judgeOutcome：strict / repaired / failed 三档分档；
 *  - AIMarker 覆盖率：完整草案 = 1，缺 marker → 失败。
 *
 * 不依赖真实模型；纯字面量输入，seedless。
 */

import { test } from '@japa/runner'
import { closeUnbalancedTail, preClean, tryParseJson } from '#services/ai_m0/recovery'
import { judgeOutcome, computeMissingMarkers } from '#services/ai_m0/judge'
import { AI_M0_INPUT_CASES, hashInputCases } from '#services/ai_m0/inputs'
import { MockAdapter } from '#services/ai_m0/mock_adapter'
import { AIGateway } from '#services/ai_m0/gateway'

test.group('ai_m0 recovery.preClean', () => {
  test('剥掉 ```json 代码块', ({ assert }) => {
    const { cleaned, applied } = preClean('```json\n{"a":1}\n```')
    assert.include(cleaned, '{"a":1}')
    assert.includeMembers(applied, ['strip_code_fence'])
  })

  test('去 BOM', ({ assert }) => {
    const raw = '﻿{"a":1}'
    const { cleaned, applied } = preClean(raw)
    assert.equal(cleaned, '{"a":1}')
    assert.includeMembers(applied, ['strip_bom'])
  })

  test('去尾逗号 `,}`', ({ assert }) => {
    const { cleaned, applied } = preClean('{"a":1,}')
    assert.equal(cleaned, '{"a":1}')
    assert.includeMembers(applied, ['remove_trailing_comma'])
  })
})

test.group('ai_m0 recovery.tryParseJson', () => {
  test('一次通过：无 appliedFixes', ({ assert }) => {
    const r = tryParseJson('{"a":1}')
    assert.isTrue(r.ok)
    assert.deepEqual(r.appliedFixes, [])
  })

  test('清洗后通过：appliedFixes 非空', ({ assert }) => {
    const r = tryParseJson('```json\n{"a":1}\n```')
    assert.isTrue(r.ok)
    assert.isNotEmpty(r.appliedFixes)
  })

  test('说明中的花括号不会污染后续完整 JSON', ({ assert }) => {
    const r = tryParseJson('说明格式 {not-json}，正式结果如下：\n{"a":1,"items":[{"b":2}]}')
    assert.isTrue(r.ok)
    assert.deepEqual(r.value, { a: 1, items: [{ b: 2 }] })
    assert.include(r.appliedFixes, 'extract_balanced_json_object')
  })

  test('修复字符串内部的裸换行，但不改动 JSON 结构', ({ assert }) => {
    const r = tryParseJson('{"description":"第一行\n第二行","ok":true}')
    assert.isTrue(r.ok)
    assert.deepEqual(r.value, { description: '第一行\n第二行', ok: true })
    assert.include(r.appliedFixes, 'escape_raw_string_controls')
  })

  test('无法解析：errorKind = malformed_json 或 truncated', ({ assert }) => {
    const r = tryParseJson('{"a":')
    assert.isFalse(r.ok)
    assert.include(['malformed_json', 'truncated'], r.errorKind!)
  })
})

test.group('ai_m0 judge.judgeOutcome', () => {
  test('failed：非法 JSON', ({ assert }) => {
    const j = judgeOutcome({
      rawText: 'this is not json',
      triggeredErrorsFromAdapter: [],
      expectedRequiredInferredFields: [],
    })
    assert.equal(j.bucket, 'failed')
    assert.equal(j.markerCoverage, 0)
  })

  test('failed：schema 校验失败', ({ assert }) => {
    const j = judgeOutcome({
      rawText: '{"charter":{}}',
      triggeredErrorsFromAdapter: [],
      expectedRequiredInferredFields: [],
    })
    assert.equal(j.bucket, 'failed')
  })

  test('strict：mock 草案 + 完整覆盖清单', async ({ assert }) => {
    // 用 MockAdapter 生成一份结构合法的草案，喂给 judge。
    const adapter = new MockAdapter()
    const gateway = new AIGateway(adapter)
    const result = await gateway.generate({
      sentence: '搭建 OA 审批系统',
      strategy: 'prompt',
    })
    const j = judgeOutcome({
      rawText: result.rawText,
      triggeredErrorsFromAdapter: [],
      expectedRequiredInferredFields: AI_M0_INPUT_CASES[0].expectedRequiredInferredFields,
    })
    assert.equal(
      j.bucket,
      'strict',
      `judge bucket 应为 strict，实际=${j.bucket}, missing=${j.missingMarkerFields.join('|')}`,
    )
    assert.equal(j.markerCoverage, 1)
  })

  test('failed：故意抹掉 charter.title.marker', async ({ assert }) => {
    const adapter = new MockAdapter()
    const gateway = new AIGateway(adapter)
    const result = await gateway.generate({
      sentence: '搭建 OA 审批系统',
      strategy: 'prompt',
    })
    const bad = JSON.parse(result.rawText)
    delete bad.charter.title.marker
    const j = judgeOutcome({
      rawText: JSON.stringify(bad),
      triggeredErrorsFromAdapter: [],
      expectedRequiredInferredFields: ['charter.title'],
    })
    // 抹掉 marker 后 zod 校验就会先失败（marker 是 required），bucket=failed。
    assert.equal(j.bucket, 'failed')
  })
})

test.group('ai_m0 inputs.hashInputCases', () => {
  test('12 条评测输入，4 类各 3 条', ({ assert }) => {
    assert.lengthOf(AI_M0_INPUT_CASES, 12)
    const byCat = new Map<string, number>()
    for (const c of AI_M0_INPUT_CASES) {
      byCat.set(c.category, (byCat.get(c.category) ?? 0) + 1)
    }
    for (const cat of ['software', 'event', 'research', 'product']) {
      assert.equal(byCat.get(cat), 3, `category ${cat} 应为 3 条`)
    }
  })

  test('hashInputCases 确定性', ({ assert }) => {
    const a = hashInputCases()
    const b = hashInputCases()
    assert.equal(a, b, 'hash 必须幂等')
  })
})

test.group('ai_m0 judge.computeMissingMarkers 边界', () => {
  test('空 expected 清单 → 0 missing', ({ assert }) => {
    const missing = computeMissingMarkers({} as any, [])
    assert.deepEqual(missing, [])
  })
})

test.group('ai_m0 recovery · 结尾漏写收尾括号', () => {
  test('内容完整、只漏最后一个 }：补齐后解析成功并记录修复', ({ assert }) => {
    const raw =
      '{"acceptanceCriteria":[{"id":"ac-1"}],"governance":{"releaseWindows":[{"name":"正式投产窗口","endDate":"2027-04-08"}]} '
    const result = tryParseJson(raw)
    assert.isTrue(result.ok)
    assert.include(result.appliedFixes, 'close_unbalanced_tail')
    assert.equal(
      (result as { value: { governance: { releaseWindows: Array<{ name: string }> } } }).value
        .governance.releaseWindows[0].name,
      '正式投产窗口',
    )
  })

  test('像截断的输出不补：停在字符串中间、停在逗号后、缺超过 2 个括号', ({ assert }) => {
    assert.isNull(closeUnbalancedTail('{"a":[{"name":"写到一半'))
    assert.isNull(closeUnbalancedTail('{"a":[{"id":1},'))
    assert.isNull(closeUnbalancedTail('{"a":{"b":{"c":[1'))
    assert.isFalse(tryParseJson('{"a":[{"name":"写到一半').ok)
  })

  test('括号本身错配时不补', ({ assert }) => {
    assert.isNull(closeUnbalancedTail('{"a":[1}'))
  })
})
