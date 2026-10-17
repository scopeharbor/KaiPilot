/**
 * v3-plugin-scoped-storage —— 插件存储 API 校验器（任务 4.1）。
 *
 * 手写校验（与 plugin_install_validator 同风格）：只做形状/类型/枚举校验，
 * 不查库（授权与存在性由 Service 合取门裁决）。authority 字段一律不接受客户端声明：
 * organizationId 来自路由参数与会话，scope/projectId 仅是寻址参数。
 */

export interface ValidationIssue {
  field: string
  message: string
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/** runtime 写入体：PUT /entries/:key */
export function validateStoragePutInput(body: Record<string, unknown>):
  | {
      valid: true
      normalized: {
        scope: 'organization' | 'project'
        projectId: number | null
        value: unknown
        expectedRevision?: number
      }
    }
  | { valid: false; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = []
  const scope = body.scope
  if (scope !== 'organization' && scope !== 'project') {
    errors.push({ field: 'scope', message: '必须为 organization 或 project' })
  }
  let projectId: number | null = null
  if (scope === 'project') {
    const raw = Number(body.projectId)
    if (!isPositiveInt(raw)) {
      errors.push({ field: 'projectId', message: 'project scope 必须提供正整数 projectId' })
    } else {
      projectId = raw
    }
  }
  if (!('value' in body) || body.value === undefined) {
    errors.push({ field: 'value', message: 'value 必填' })
  }
  let expectedRevision: number | undefined
  if (body.expectedRevision !== undefined && body.expectedRevision !== null) {
    const rev = Number(body.expectedRevision)
    if (!isPositiveInt(rev)) {
      errors.push({ field: 'expectedRevision', message: '必须为正整数' })
    } else {
      expectedRevision = rev
    }
  }
  if (errors.length > 0) return { valid: false, errors }
  return {
    valid: true,
    normalized: {
      scope: scope as 'organization' | 'project',
      projectId,
      value: body.value,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    },
  }
}

/** runtime 列表查询参数 */
export function validateStorageListQuery(qs: Record<string, unknown>):
  | {
      valid: true
      normalized: {
        scope: 'organization' | 'project'
        projectId: number | null
        page?: number
        perPage?: number
        prefix?: string
      }
    }
  | { valid: false; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = []
  const scope = qs.scope
  if (scope !== 'organization' && scope !== 'project') {
    errors.push({ field: 'scope', message: '必须为 organization 或 project' })
  }
  let projectId: number | null = null
  if (scope === 'project') {
    const raw = Number(qs.projectId)
    if (!isPositiveInt(raw)) {
      errors.push({ field: 'projectId', message: 'project scope 必须提供正整数 projectId' })
    } else {
      projectId = raw
    }
  }
  let page: number | undefined
  if (qs.page !== undefined && qs.page !== '') {
    const p = Number(qs.page)
    if (!Number.isInteger(p) || p < 1) errors.push({ field: 'page', message: '必须为正整数' })
    else page = p
  }
  let perPage: number | undefined
  if (qs.perPage !== undefined && qs.perPage !== '') {
    const pp = Number(qs.perPage)
    if (!Number.isInteger(pp) || pp < 1) errors.push({ field: 'perPage', message: '必须为正整数' })
    else perPage = pp
  }
  const prefix =
    typeof qs.prefix === 'string' && qs.prefix.trim() !== '' ? qs.prefix.trim() : undefined
  if (errors.length > 0) return { valid: false, errors }
  return {
    valid: true,
    normalized: {
      scope: scope as 'organization' | 'project',
      projectId,
      ...(page !== undefined ? { page } : {}),
      ...(perPage !== undefined ? { perPage } : {}),
      ...(prefix !== undefined ? { prefix } : {}),
    },
  }
}

/** 清理确认请求体 */
export function validateStorageCleanupConfirmInput(body: Record<string, unknown>):
  | {
      valid: true
      normalized: { cleanupHandle: string; cleanupDigest: string }
    }
  | { valid: false; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = []
  if (
    typeof body.cleanupHandle !== 'string' ||
    body.cleanupHandle.length === 0 ||
    body.cleanupHandle.length > 8192
  ) {
    errors.push({ field: 'cleanupHandle', message: '清理句柄必填且长度有界' })
  }
  if (typeof body.cleanupDigest !== 'string' || !/^[0-9a-f]{8,64}$/.test(body.cleanupDigest)) {
    errors.push({ field: 'cleanupDigest', message: '绑定 digest 必填（十六进制）' })
  }
  if (errors.length > 0) return { valid: false, errors }
  return {
    valid: true,
    normalized: {
      cleanupHandle: body.cleanupHandle as string,
      cleanupDigest: body.cleanupDigest as string,
    },
  }
}

/** 导出请求体 */
export function validateStorageExportInput(body: Record<string, unknown>):
  | {
      valid: true
      normalized: {
        pluginId?: string
        scope?: 'organization' | 'project'
        includeOrphaned?: boolean
      }
    }
  | { valid: false; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = []
  const normalized: {
    pluginId?: string
    scope?: 'organization' | 'project'
    includeOrphaned?: boolean
  } = {}
  if (body.pluginId !== undefined && body.pluginId !== null && body.pluginId !== '') {
    if (typeof body.pluginId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,199}$/.test(body.pluginId)) {
      errors.push({ field: 'pluginId', message: '插件标识格式非法' })
    } else {
      normalized.pluginId = body.pluginId
    }
  }
  if (body.scope !== undefined && body.scope !== null && body.scope !== '') {
    if (body.scope !== 'organization' && body.scope !== 'project') {
      errors.push({ field: 'scope', message: '必须为 organization 或 project' })
    } else {
      normalized.scope = body.scope
    }
  }
  if (body.includeOrphaned !== undefined) {
    normalized.includeOrphaned = body.includeOrphaned === true
  }
  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, normalized }
}
