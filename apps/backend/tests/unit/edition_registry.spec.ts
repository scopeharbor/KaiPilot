/**
 * v3-personal-edition-open-source-export §1.2 —— 版本扩展点注册表。
 *
 * 覆盖：
 * - 未注册企业实现时返回个人版默认值（DLP 明确放行而非「不可用」、水印不注入、无平台 AI）；
 * - 注册后返回注册的实现；
 * - 部分注册只覆盖对应字段；
 * - resetEditionHooksForTests 回到默认值并返回重置前状态，可据此还原。
 */
import { test } from '@japa/runner'
import {
  editionHooks,
  registerEditionHooks,
  resetEditionHooksForTests,
  type EditionHooks,
} from '#services/edition/edition_registry'
import type { CopilotDlpPort, CopilotWatermarkPort, PlatformAiPort } from '#services/edition/ports'

const dlpInput = {
  organizationId: 1,
  projectId: null,
  actorId: 1,
  sourceHash: 'hash',
  authorizedContextSummary: 'project:1',
  contextPacketRefs: ['project:1'],
}

const fakeDlp: CopilotDlpPort = {
  async preflightContextAssembly() {
    return {
      allowed: false,
      snapshot: null,
      warnings: ['FAKE'],
      adapterAvailable: true,
      maskedContext: null,
    }
  },
}

const fakeWatermark: CopilotWatermarkPort = {
  async prepareContext() {
    return { watermarkRequired: true }
  },
}

const fakePlatformAi = {
  async resolveScope() {
    return { ownAllowed: false, platformOrganizationId: 99 }
  },
} as unknown as PlatformAiPort

test.group('版本扩展点注册表', (group) => {
  let previous: EditionHooks
  group.each.setup(() => {
    previous = resetEditionHooksForTests()
    return () => registerEditionHooks(previous)
  })

  test('未注册时 DLP 默认明确放行（adapterAvailable 为真，不是不可用）', async ({ assert }) => {
    const result = await editionHooks().copilotDlp().preflightContextAssembly(dlpInput)
    assert.deepEqual(result, {
      allowed: true,
      snapshot: null,
      warnings: [],
      adapterAvailable: true,
      maskedContext: null,
    })
  })

  test('未注册时水印不注入、无平台 AI', async ({ assert }) => {
    const watermark = await editionHooks()
      .copilotWatermark()
      .prepareContext({
        ...dlpInput,
        sourceRef: 'project:1',
        format: 'markdown',
        dlpResult: 'allow',
        decisionHash: 'dlp-0-0',
        policyHash: 'policy-0',
      })
    assert.isNull(watermark)
    assert.isNull(editionHooks().platformAi)
  })

  test('注册后返回企业实现', async ({ assert }) => {
    registerEditionHooks({
      copilotDlp: () => fakeDlp,
      copilotWatermark: () => fakeWatermark,
      platformAi: fakePlatformAi,
    })
    const hooks = editionHooks()
    assert.strictEqual(hooks.copilotDlp(), fakeDlp)
    assert.strictEqual(hooks.copilotWatermark(), fakeWatermark)
    assert.strictEqual(hooks.platformAi, fakePlatformAi)
    const result = await hooks.copilotDlp().preflightContextAssembly(dlpInput)
    assert.isFalse(result.allowed)
  })

  test('部分注册只覆盖对应字段', async ({ assert }) => {
    registerEditionHooks({ platformAi: fakePlatformAi })
    const hooks = editionHooks()
    assert.strictEqual(hooks.platformAi, fakePlatformAi)
    const result = await hooks.copilotDlp().preflightContextAssembly(dlpInput)
    assert.isTrue(result.allowed)
    assert.isTrue(result.adapterAvailable)
  })

  test('resetEditionHooksForTests 回到默认值并返回重置前状态', async ({ assert }) => {
    registerEditionHooks({ copilotDlp: () => fakeDlp })
    const before = resetEditionHooksForTests()
    assert.strictEqual(before.copilotDlp(), fakeDlp)
    assert.notStrictEqual(editionHooks().copilotDlp(), fakeDlp)
    assert.isNull(editionHooks().platformAi)
    registerEditionHooks(before)
    assert.strictEqual(editionHooks().copilotDlp(), fakeDlp)
  })
})
