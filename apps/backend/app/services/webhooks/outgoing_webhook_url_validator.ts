/**
 * v2-5-outgoing-webhook-subscription-foundation -- 目标 URL 保守校验与规范化（design D4）。
 *
 * 本 change 不投递请求，但unsafe URL 不应进入未来投递队列，故持久化前先校验：
 * 仅 HTTPS、必须有 host、拒绝非支持 scheme、拒绝 URL 内嵌凭据、拒绝 loopback/私有目标
 * （除非显式 test/dev 配置允许）、拒绝 malformed。规范化后返回（小写 host + 标准端口剥离）。
 */

export interface NormalizedTargetUrl {
  normalized: string
  host: string
}

export class OutgoingWebhookUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutgoingWebhookUrlError'
  }
}

/** 显式 test/dev 允许私网目标（生产默认 false）。运行时读 env 避免启动缓存。 */
function devAllowPrivate(): boolean {
  const raw = process.env.OUTGOING_WEBHOOK_DEV_ALLOW_PRIVATE
  return raw === 'true' || raw === '1'
}

/** 判定 host 是否为 loopback / 私有 / 链路本地地址。 */
function isPrivateOrLoopbackHost(host: string): boolean {
  // URL.hostname 对 IPv6 字面量返回带方括号形式（如 [::1]），去括号统一判定
  const raw = host.toLowerCase()
  const lower = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw
  if (lower === 'localhost') return true
  // IPv4
  const v4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])].map((n) => n)
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  }
  // IPv6（含 ::1 loopback、私有 fc00::/7、链路本地 fe80::/10、IPv4 映射 ::ffff:）
  if (lower === '::1') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  )
    return true
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length)
    return isPrivateOrLoopbackHost(mapped)
  }
  return false
}

/**
 * 校验并规范化目标 URL。
 * @throws OutgoingWebhookUrlError 当 scheme 非 https、缺 host、含凭据、私网目标或 malformed。
 */
export function normalizeAndValidateTargetUrl(raw: string): NormalizedTargetUrl {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new OutgoingWebhookUrlError('目标 URL 不能为空')
  }
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new OutgoingWebhookUrlError('目标 URL 格式不合法')
  }
  if (parsed.protocol !== 'https:') {
    throw new OutgoingWebhookUrlError('目标 URL 必须使用 HTTPS')
  }
  const host = parsed.hostname
  if (!host) {
    throw new OutgoingWebhookUrlError('目标 URL 缺少 host')
  }
  // 拒绝 URL 内嵌凭据（user:pass@host）
  if (parsed.username || parsed.password) {
    throw new OutgoingWebhookUrlError('目标 URL 不得内嵌凭据')
  }
  if (!devAllowPrivate() && isPrivateOrLoopbackHost(host)) {
    throw new OutgoingWebhookUrlError('目标 URL 不得指向 loopback 或私有网络地址')
  }
  // 规范化：小写 host，标准端口剥离（https 默认 443）
  const port = parsed.port && parsed.port !== '443' ? `:${parsed.port}` : ''
  const path = parsed.pathname || '/'
  const search = parsed.search || ''
  const normalized = `https://${host.toLowerCase()}${port}${path}${search}`
  return { normalized, host: host.toLowerCase() }
}
