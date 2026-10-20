/**
 * 开项 Kaiplan —— frontend 容器内健康探针（v3-docker-compose-runtime-foundation, design D8）
 *
 * 请求 standalone server 的根页面：200/3xx → exit 0，其余/超时 → exit 1。
 * 只用 Node 自带 fetch，不为探针引入 curl/wget。输出仅状态行（低敏）。
 */

/* global process, console, fetch, AbortSignal */

const url = `http://127.0.0.1:${process.env.PORT || 3000}/`
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 5000)

try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'manual',
  })
  if (response.status >= 200 && response.status < 400) {
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
