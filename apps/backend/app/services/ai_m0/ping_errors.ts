type ProviderErrorShape = {
  message?: string
  error?: {
    message?: string
    type?: string
  }
  type?: string
}

function providerMessageFromJson(raw: string): string | null {
  const jsonText = raw.match(/\{[\s\S]*\}$/)?.[0]
  if (!jsonText) return null
  try {
    const parsed = JSON.parse(jsonText) as ProviderErrorShape
    return parsed.error?.message ?? parsed.message ?? null
  } catch {
    return null
  }
}

function providerErrorTypeFromJson(raw: string): string | null {
  const jsonText = raw.match(/\{[\s\S]*\}$/)?.[0]
  if (!jsonText) return null
  try {
    const parsed = JSON.parse(jsonText) as ProviderErrorShape
    return parsed.error?.type ?? parsed.type ?? null
  } catch {
    return null
  }
}

function extractProviderMessage(err: any): string {
  const direct =
    err?.error?.error?.message ??
    err?.error?.message ??
    err?.response?.data?.error?.message ??
    err?.message
  const raw = String(direct ?? 'unknown_error').trim()
  return providerMessageFromJson(raw) ?? raw
}

function extractProviderType(err: any): string {
  const direct =
    err?.error?.error?.type ?? err?.error?.type ?? err?.response?.data?.error?.type ?? err?.type
  const raw = String(err?.message ?? '').trim()
  return String(direct ?? providerErrorTypeFromJson(raw) ?? '').toLowerCase()
}

export function describePingError(err: any): string {
  const status = err?.status ?? err?.response?.status
  const message = extractProviderMessage(err)
  const type = extractProviderType(err)
  const lower = `${message} ${type}`.toLowerCase()

  if (status === 401 || lower.includes('authentication') || lower.includes('api key')) {
    return '认证失败：API key 无效、过期，或没有访问该服务的权限。'
  }
  if (
    lower.includes('currently unavailable for your group') ||
    lower.includes('not available for your group') ||
    lower.includes('model_not_found')
  ) {
    return `模型不可用：${message}。请换用模型列表中的可用模型，或联系供应商为当前 API key/分组开通。`
  }
  if (status === 429 || lower.includes('rate')) {
    return '供应商限流：请求过于频繁或额度不足，请稍后重试或检查账号额度。'
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 529 ||
    lower.includes('service_unavailable') ||
    lower.includes('overload') ||
    lower.includes('unavailable')
  ) {
    return `AI 服务暂时不可用：${message}`
  }
  if (lower.includes('aborted')) {
    return '测试超时：供应商在限定时间内没有完成响应。'
  }
  return `AI 服务返回错误：${message}`
}
