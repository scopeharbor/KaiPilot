/**
 * plugin-skill-adapter-fixtures —— skill adapter 契约与阻断测试夹具。
 * 包含合法负载、平行重造负例、敏感信息负例等。
 */

import type {
  PluginCompilerContributionPayload,
  PluginSkillBundleContributionPayload,
} from './plugin-skill-adapter.js'

// 1. 合法 skill-bundle 负载
export const fixtureValidSkillBundlePayload: PluginSkillBundleContributionPayload = {
  skillKey: 'dev-patterns',
  skillVersion: '1.0.0',
  lifecycleRef: 'active',
  description: 'Development methodology patterns',
}

// 2. 合法 compiler-contribution 负载
export const fixtureValidCompilerContributionPayload: PluginCompilerContributionPayload = {
  descriptor: 'development-flow-guidance',
  scope: 'organization',
  targetStages: ['stage_01_intent', 'stage_02_wbs'],
  advisory: true,
  contextScope: 'default',
  description: 'Provides advisory guidance for dev flow',
}

// 3. 负例：平行重造自建状态机 (包含 status/state 等字段)
export const fixtureParallelStateMachinePayload = {
  skillKey: 'dev-patterns',
  skillVersion: '1.0.0',
  lifecycleRef: 'active',
  status: 'custom_active',
  transitions: ['custom_draft', 'custom_active'],
}

// 4. 负例：平行重造自建激活算法 (包含 customActivation / activationRules 等)
export const fixtureParallelActivationPayload = {
  skillKey: 'dev-patterns',
  skillVersion: '1.0.0',
  lifecycleRef: 'active',
  customActivation: {
    rule: 'if tag == dev then activate',
  },
}

// 5. 负例：Stage 语义声明违规 (包含 overrideStageOrder / bypassInvariants 等)
export const fixtureStageInvariantViolationPayload = {
  descriptor: 'dangerous-contribution',
  scope: 'project',
  targetStages: ['stage_01_intent'],
  advisory: true,
  overrideStageOrder: true,
  bypassInvariants: true,
}

// 6. 负例：包含 Secret / Token 材料
export const fixtureSecretDetectedPayload = {
  skillKey: 'dev-patterns',
  skillVersion: '1.0.0',
  lifecycleRef: 'active',
  description: 'Payload with secret: sk_123456789012345678901234567890',
}

export const fixtureSecretKeyPayload = {
  skillKey: 'dev-patterns',
  skillVersion: '1.0.0',
  lifecycleRef: 'active',
  apiKey: 'any-key',
}

// 7. 负例：非 advisory compiler contribution
export const fixtureNonAdvisoryCompilerPayload = {
  descriptor: 'direct-write-contribution',
  scope: 'organization',
  targetStages: ['stage_01_intent'],
  advisory: false,
}
