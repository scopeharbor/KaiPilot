import vine from '@vinejs/vine'
import {
  PLUGIN_RUNTIME_HEALTH_CIRCUIT_STATES,
  PLUGIN_RUNTIME_HEALTH_REASON_CODES,
  PLUGIN_RUNTIME_HEALTH_STATUSES,
} from '@aiproj/types'

export const listHealthSnapshotsValidator = vine.compile(
  vine.object({
    pluginId: vine.string().optional(),
    contributionKey: vine.string().optional(),
    status: vine.enum(PLUGIN_RUNTIME_HEALTH_STATUSES).optional(),
    reasonCode: vine.enum(PLUGIN_RUNTIME_HEALTH_REASON_CODES).optional(),
    circuitState: vine.enum(PLUGIN_RUNTIME_HEALTH_CIRCUIT_STATES).optional(),
    isStale: vine.boolean().optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    sort: vine.string().optional(),
  }),
)

export const listHealthEventsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

export const healthProbeValidator = vine.compile(
  vine.object({
    outcome: vine
      .enum(['success', 'crash', 'timeout', 'quota_exceeded', 'unknown'] as const)
      .optional(),
  }),
)
