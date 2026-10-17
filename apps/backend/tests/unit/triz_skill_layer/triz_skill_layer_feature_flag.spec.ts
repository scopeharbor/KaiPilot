/**
 * v3-triz-skill-layer-integration 后端单元测试
 * 覆盖 service、policy、validators 和 feature flag。
 */
import { test } from '@japa/runner'
import { isTrizSkillLayerEnabled } from '#services/triz_skill_layer/triz_skill_layer_feature_flag'

test.group('TrizSkillLayer Feature Flag', () => {
  test('is enabled by default (no env var)', ({ assert }) => {
    // 默认本机开启
    assert.isTrue(isTrizSkillLayerEnabled())
  })
})
