/**
 * Adonis logger 服务的 Vitest 桩。
 *
 * `@adonisjs/core/services/logger` 是**容器服务**：模块加载时即去取已 boot 的 app，
 * 裸 node（Vitest）环境下 app 未 boot，任何顶层 import 了它的被测模块都会抛
 * "Cannot read properties of undefined (reading 'booted')"，整个文件的用例全灭。
 *
 * 这里只提供无副作用的同签名替身；日志本身不是被测行为。
 * Japa 侧不受影响——那里跑在真实运行时上，用的是真 logger。
 */
const noop = (): void => {}

const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  silent: noop,
  child: () => logger,
}

export default logger
