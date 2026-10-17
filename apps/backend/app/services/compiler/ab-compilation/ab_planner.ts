/**
 * CompilerAbPlanner —— Compiler A/B compilation planner（§2.1）。
 *
 * 将 typed experiment config 转换为确定性 run matrix。
 * 不接触 production Compiler run lifecycle。
 * 遵循 design D1（离线 evidence framework）。
 */

import type {
  CompilerAbExperimentConfig,
  CompilerAbVariant,
  CompilerAbMetricProfile,
} from '@aiproj/types'

// ── Run Matrix Types ──────────────────────────────────────────

export interface CompilerAbRunMatrixEntry {
  entryId: string
  variantId: string
  sampleId: string
  label: string
  catalogVersion: string | undefined
  routingDecisionRef: string | undefined
  toolHardeningProfile: string | undefined
  modelProfileRef: string | undefined
  featureFlags: string[] | undefined
  fixtureProviderId: string | undefined
}

export interface CompilerAbRunMatrix {
  experimentId: string
  organizationId: number
  actorId: number
  objective: string
  enabled: boolean
  metricProfile: CompilerAbMetricProfile
  entries: CompilerAbRunMatrixEntry[]
  entryCount: number
  note: string
}

// ── Planner ───────────────────────────────────────────────────

export class CompilerAbPlanner {
  /**
   * 生成确定性 run matrix。
   * 如果 config 无效或 disabled，返回 empty matrix with enabled=false。
   */
  plan(config: CompilerAbExperimentConfig, sampleIds: string[]): CompilerAbRunMatrix {
    // 非 fixture 模式且未授权 —— 返回 disabled matrix
    if (config.authorization.mode === 'unauthorized') {
      return {
        experimentId: config.experimentId,
        organizationId: config.organizationId,
        actorId: config.actorId,
        objective: config.objective,
        enabled: false,
        metricProfile: config.metricProfile,
        entries: [],
        entryCount: 0,
        note: 'Experiment is disabled (authorization mode: unauthorized)',
      }
    }

    const entries: CompilerAbRunMatrixEntry[] = []

    for (const variant of config.variants) {
      for (const sampleId of sampleIds) {
        entries.push(this.buildEntry(variant, sampleId))
      }
    }

    return {
      experimentId: config.experimentId,
      organizationId: config.organizationId,
      actorId: config.actorId,
      objective: config.objective,
      enabled: entries.length > 0,
      metricProfile: config.metricProfile,
      entries,
      entryCount: entries.length,
      note: `Planned ${entries.length} entries (${config.variants.length} variants × ${sampleIds.length} samples)`,
    }
  }

  private buildEntry(variant: CompilerAbVariant, sampleId: string): CompilerAbRunMatrixEntry {
    return {
      entryId: `${variant.variantId}:${sampleId}`,
      variantId: variant.variantId,
      sampleId,
      label: variant.label,
      catalogVersion: variant.catalogVersion,
      routingDecisionRef: variant.routingDecisionRef,
      toolHardeningProfile: variant.toolHardeningProfile,
      modelProfileRef: variant.modelProfileRef,
      featureFlags: variant.featureFlags,
      fixtureProviderId: variant.fixtureProviderId,
    }
  }
}
