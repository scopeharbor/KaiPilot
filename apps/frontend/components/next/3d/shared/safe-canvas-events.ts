import { events as createPointerEvents } from '@react-three/fiber'

/**
 * R3F 事件管理器的空目标保护。
 *
 * `<Canvas>` 的 `configure()` 是异步的：画布在它 resolve 前被卸载（切换镜头、路由跳转、
 * Fast Refresh 重挂）时，`onCreated` 与内部 `Provider` 仍会用已置空的 `divRef.current`
 * 调 `events.connect(null)`，抛出「Cannot read properties of null (reading 'addEventListener')」
 * 并冒泡成整页运行时错误。目标为空时跳过连接即可——画布本身已不在页面上。
 */
export function safeCanvasEvents(store: Parameters<typeof createPointerEvents>[0]) {
  const manager = createPointerEvents(store)
  const connect = manager.connect
  return {
    ...manager,
    connect: (target: HTMLElement) => {
      if (target) connect?.(target)
    },
  }
}
