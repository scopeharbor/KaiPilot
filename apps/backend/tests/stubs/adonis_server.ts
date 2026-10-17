/**
 * Adonis HTTP server 服务的 Vitest 桩。
 *
 * 与 logger 桩同因：`@adonisjs/core/services/server` 是容器服务，模块加载即取已 boot 的 app。
 * `providers/socketio_provider.ts` 在顶层 import 它，于是任何间接依赖该 provider 的
 * 被测模块（streaming_ws_service → getSocketIo）在 Vitest 下整文件加载失败。
 *
 * 桩只需保证「能被 import、方法可调用」；Socket.IO 挂载不是这些单测的被测行为。
 */
const server = {
  getNodeServer: () => null,
  use: () => {},
  errorHandler: () => {},
}

export default server
