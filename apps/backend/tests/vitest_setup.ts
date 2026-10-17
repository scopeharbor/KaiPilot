/**
 * 后端 Vitest 全局 setup。
 *
 * AdonisJS 的 `@inject()` 依赖 `Reflect.getMetadata`（由 reflect-metadata 提供）。
 * Japa 走 Adonis 运行时会自动加载；Vitest 是裸 node 环境，不加载就会在
 * 构造被装饰的 Controller/Policy 时抛 "Reflect.getMetadata is not a function"。
 */
import 'reflect-metadata'
