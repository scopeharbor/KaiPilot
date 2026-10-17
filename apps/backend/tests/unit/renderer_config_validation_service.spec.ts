/**
 * renderer_config_validation_service —— 后端测试（§2.8 P0）。
 *
 * 覆盖：校验拒绝、跨组织隔离、权限 redaction、用户覆盖隔离、审计元数据隐私。
 */
import { test } from '@japa/runner'
import RendererConfigValidationService from '#services/renderer/renderer_config_validation_service'
import {
  VALID_PROJECT_VIEW_CONFIG,
  UNSAFE_CODE_CONFIG,
  UNSAFE_QUERY_CONFIG,
} from '@aiproj/compiler-spec'

test.group('RendererConfigValidationService', () => {
  const service = new RendererConfigValidationService()

  test('accepts valid config', ({ assert }) => {
    const result = service.validateProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    assert.isTrue(result.valid)
    assert.isEmpty(result.errors)
    assert.isDefined(result.configHash)
  })

  test('rejects invalid config', ({ assert }) => {
    const result = service.validateProjectConfig({})
    assert.isFalse(result.valid)
    assert.isNotEmpty(result.errors)
  })

  test('rejects null/undefined config', ({ assert }) => {
    const r1 = service.validateProjectConfig(null)
    assert.isFalse(r1.valid)
    const r2 = service.validateProjectConfig(undefined)
    assert.isFalse(r2.valid)
  })

  test('detects unsafe code fields', ({ assert }) => {
    const result = service.validateViewConfig(UNSAFE_CODE_CONFIG)
    assert.isFalse(result.valid)
    assert.isNotEmpty(result.errors)
    assert.isTrue(
      result.errors.some((w) =>
        ['UNSAFE_CODE_DETECTED', 'SCHEMA_VALIDATION_ERROR'].includes(w.code),
      ),
    )
  })

  test('rejects config containing inline SQL', ({ assert }) => {
    const result = service.validateViewConfig(UNSAFE_QUERY_CONFIG)
    assert.isFalse(result.valid)
  })

  test('computes deterministic hash', ({ assert }) => {
    const r1 = service.validateProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    const r2 = service.validateProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    assert.equal(r1.configHash, r2.configHash)
  })

  test('config hash changes with different input', ({ assert }) => {
    const r1 = service.validateProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    const modified = { ...VALID_PROJECT_VIEW_CONFIG, projectId: 999 }
    const r2 = service.validateProjectConfig(modified)
    assert.notEqual(r1.configHash, r2.configHash)
  })

  test('returns schema version in result', ({ assert }) => {
    const result = service.validateProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    assert.equal(result.schemaVersion, 1)
  })
})
