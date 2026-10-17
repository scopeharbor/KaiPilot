/**
 * v3-plugin-policy-bundles —— 管理 API 校验器（手写封闭校验，返回 {valid, errors[]}）。
 */

const TEMPLATE_IDS = ['admin-managed', 'pm-enabled', 'member-readonly']
const ACTIONS = ['enable', 'disable']

export interface CopyInput {
  templateId: string
}

export interface ActivationInput {
  action: 'enable' | 'disable'
  version: number
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

export async function validateCopyInput(body: unknown): Promise<{
  valid: boolean
  value?: CopyInput
  errors: Array<{ field: string; message: string }>
}> {
  const errors: Array<{ field: string; message: string }> = []
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: [{ field: 'body', message: '必须为对象' }] }
  }
  const templateId = asString((body as Record<string, unknown>).templateId)
  if (!templateId || !TEMPLATE_IDS.includes(templateId)) {
    errors.push({ field: 'templateId', message: `templateId 必须是 ${TEMPLATE_IDS.join('/')}` })
  }
  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, value: { templateId: templateId! }, errors }
}

export async function validateActivationInput(body: unknown): Promise<{
  valid: boolean
  value?: ActivationInput
  errors: Array<{ field: string; message: string }>
}> {
  const errors: Array<{ field: string; message: string }> = []
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: [{ field: 'body', message: '必须为对象' }] }
  }
  const obj = body as Record<string, unknown>
  const action = asString(obj.action)
  if (!action || !ACTIONS.includes(action)) {
    errors.push({ field: 'action', message: `action 必须是 ${ACTIONS.join('/')}` })
  }
  const version = Number(obj.version)
  if (!Number.isInteger(version) || version < 1 || version > 1_000_000) {
    errors.push({ field: 'version', message: 'version 必须是正整数' })
  }
  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, value: { action: action as 'enable' | 'disable', version }, errors }
}
