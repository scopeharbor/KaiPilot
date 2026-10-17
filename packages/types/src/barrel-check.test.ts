import { describe, it, expect } from 'vitest'
import * as T from './index.js'

describe('桶入口 star export 冲突消歧', () => {
  it('权威名与域别名都可用（消歧前这些名字会被 ESM 静默剔除）', () => {
    const t = T as unknown as Record<string, unknown>
    expect(typeof t.sortWarningsBySeverity).toBe('function')
    expect(typeof t.isValidLifecycleTransition).toBe('function')
    expect(typeof t.isSourceHashStale).toBe('function')
    expect(typeof t.sortMultiProjectWarningsBySeverity).toBe('function')
    expect(typeof t.isValidDepCrudLifecycleTransition).toBe('function')
    expect(typeof t.isDecisionSourceHashStale).toBe('function')

    // plugin-install-lifecycle & plugin-skill-adapter
    expect(typeof t.isValidInstallTransition).toBe('function')
    expect(typeof t.transitionPluginInstallStatus).toBe('function')
    expect(typeof t.computePermissionDigest).toBe('function')
    expect(typeof t.validatePluginContributionPayload).toBe('function')
    expect(typeof t.validateSkillBundlePayload).toBe('function')
    expect(typeof t.validateCompilerContributionPayload).toBe('function')
    expect(Array.isArray(t.PLUGIN_INSTALLATION_STATUSES)).toBe(true)
    expect(Array.isArray(t.PLUGIN_SKILL_ADAPTER_SUPPORTED_SEAMS)).toBe(true)
  })
})
