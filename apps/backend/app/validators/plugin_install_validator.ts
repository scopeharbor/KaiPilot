/**
 * v3-skill-as-plugin-adapter —— PluginInstall Validator（W2b 安装生命周期校验器）。
 *
 * 格式与枚举校验：
 * 1. 预览入参校验（action、pluginId、releaseId 等）
 * 2. 确认入参校验（previewHandle、previewDigest、permissionConfirmed 等）
 */
import { PLUGIN_INSTALL_ACTIONS, isPluginInstallAction } from '@aiproj/types'

export interface InstallValidationError {
  field: string
  code: string
  message: string
}

export interface InstallValidationResult {
  valid: boolean
  errors: InstallValidationError[]
}

function ok(): InstallValidationResult {
  return { valid: true, errors: [] }
}

function fail(errors: InstallValidationError[]): InstallValidationResult {
  return { valid: false, errors }
}

/**
 * 校验插件 ID 格式（小写命名空间）。
 */
export function validatePluginId(pluginId: unknown): InstallValidationResult {
  if (typeof pluginId !== 'string') {
    return fail([{ field: 'pluginId', code: 'invalid-type', message: 'pluginId must be a string' }])
  }
  const trimmed = pluginId.trim()
  if (trimmed.length === 0 || trimmed.length > 200) {
    return fail([
      { field: 'pluginId', code: 'invalid-length', message: 'pluginId must be 1-200 characters' },
    ])
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(trimmed)) {
    return fail([
      {
        field: 'pluginId',
        code: 'invalid-format',
        message: 'pluginId must be lowercase with dots, hyphens, or underscores',
      },
    ])
  }
  return ok()
}

/**
 * 校验安装命令动作。
 */
export function validateInstallAction(action: unknown): InstallValidationResult {
  if (typeof action !== 'string' || !isPluginInstallAction(action)) {
    return fail([
      {
        field: 'action',
        code: 'invalid-value',
        message: `action must be one of: ${PLUGIN_INSTALL_ACTIONS.join(', ')}`,
      },
    ])
  }
  return ok()
}

/**
 * 校验预览请求入参。
 */
export function validateInstallPreviewInput(input: {
  action?: unknown
  pluginId?: unknown
  releaseId?: unknown
  expectedDigest?: unknown
}): InstallValidationResult {
  const errors: InstallValidationError[] = []

  const actionRes = validateInstallAction(input.action)
  if (!actionRes.valid) errors.push(...actionRes.errors)

  const pluginIdRes = validatePluginId(input.pluginId)
  if (!pluginIdRes.valid) errors.push(...pluginIdRes.errors)

  if (input.releaseId !== undefined && input.releaseId !== null) {
    const rId = Number(input.releaseId)
    if (!Number.isInteger(rId) || rId < 1) {
      errors.push({
        field: 'releaseId',
        code: 'invalid-value',
        message: 'releaseId must be a positive integer',
      })
    }
  }

  if (input.expectedDigest !== undefined && input.expectedDigest !== null) {
    if (typeof input.expectedDigest !== 'string' || !input.expectedDigest.trim()) {
      errors.push({
        field: 'expectedDigest',
        code: 'invalid-value',
        message: 'expectedDigest must be a non-empty string',
      })
    }
  }

  return errors.length === 0 ? ok() : fail(errors)
}

/**
 * 校验确认请求入参。
 */
export function validateInstallConfirmInput(input: {
  previewHandle?: unknown
  previewDigest?: unknown
  permissionConfirmed?: unknown
  permissionDigest?: unknown
}): InstallValidationResult {
  const errors: InstallValidationError[] = []

  if (typeof input.previewHandle !== 'string' || !input.previewHandle.trim()) {
    errors.push({
      field: 'previewHandle',
      code: 'required',
      message: 'previewHandle is required',
    })
  }

  if (typeof input.previewDigest !== 'string' || !input.previewDigest.trim()) {
    errors.push({
      field: 'previewDigest',
      code: 'required',
      message: 'previewDigest is required',
    })
  }

  if (input.permissionConfirmed !== undefined && input.permissionConfirmed !== null) {
    if (typeof input.permissionConfirmed !== 'boolean') {
      errors.push({
        field: 'permissionConfirmed',
        code: 'invalid-type',
        message: 'permissionConfirmed must be a boolean',
      })
    }
  }

  if (input.permissionDigest !== undefined && input.permissionDigest !== null) {
    if (typeof input.permissionDigest !== 'string') {
      errors.push({
        field: 'permissionDigest',
        code: 'invalid-type',
        message: 'permissionDigest must be a string',
      })
    }
  }

  return errors.length === 0 ? ok() : fail(errors)
}
