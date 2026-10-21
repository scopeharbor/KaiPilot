/**
 * 开项 KaiPilot —— backend 容器内健康探针（v3-docker-compose-runtime-foundation, design D8）
 *
 * 在容器内部请求就绪端点 `/api/v1/health/ready`：
 * - 200 → exit 0（DB 探活通过；Redis 为可选可见性字段，见 health_controller D6）
 * - 其他/超时 → exit 1
 *
 * 只使用 Node 自带 fetch，镜像不因此引入 curl/wget。
 * 输出仅状态行（低敏），不打印响应正文（避免泄漏 checks 里的环境细节到日志）。
 */

const url = `http://127.0.0.1:${process.env.PORT || 3333}/api/v1/health/ready`
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 5000)

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (response.ok) {
    console.log(`healthcheck ok status=${response.status}`)
    process.exit(0)
  }
  console.log(`healthcheck failed status=${response.status}`)
  process.exit(1)
} catch (error) {
  const reason = error instanceof Error ? error.name : 'unknown'
  console.log(`healthcheck error=${reason}`)
  process.exit(1)
}
