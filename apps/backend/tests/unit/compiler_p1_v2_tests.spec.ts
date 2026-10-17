/**
 * v2-context-compiler-artifact-store —— P1 测试。
 */
import { test } from '@japa/runner'

test.group('AIGateway metadata', () => {
  test('StageEventLogger interface includes artifact refs but not full payload', async ({
    assert,
  }) => {
    const { fileURLToPath } = await import('node:url')
    const { readFile } = await import('node:fs/promises')
    const loggerPath = fileURLToPath(
      new URL('../../app/services/compiler/stage_event_logger.ts', import.meta.url),
    )
    const source = await readFile(loggerPath, 'utf-8')

    assert.isTrue(source.includes('contextPacketRef'))
    assert.isTrue(source.includes('modelOutputRef'))
    assert.isTrue(source.includes('tokenCostSummary'))
    assert.isFalse(source.includes('contextPayload'))
    assert.isFalse(source.includes('fullPacket'))
    assert.isFalse(source.includes('contextContent'))
  })
})

test.group('Debug context', () => {
  test('DevDebugService exports context summary interface', async ({ assert }) => {
    const { fileURLToPath } = await import('node:url')
    const { readFile } = await import('node:fs/promises')
    const sourcePath = fileURLToPath(
      new URL('../../app/services/compiler/dev_debug_service.ts', import.meta.url),
    )
    const source = await readFile(sourcePath, 'utf-8')

    assert.isTrue(source.includes('getContextPacketSummary'))
    assert.isTrue(source.includes('getRunStageArtifactRefs'))
    assert.isTrue(source.includes('ContextPacketSummary'))
  })
})
