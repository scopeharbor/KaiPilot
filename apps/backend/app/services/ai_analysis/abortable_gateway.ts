import type { GenerateOptions, GenerateResult } from '#services/ai_m0/gateway'

/** 把任务硬上限传到每一次模型调用，避免界面停止等待后模型仍无界运行。 */
export function abortableGateway<
  G extends { generate(options: GenerateOptions): Promise<GenerateResult> },
>(gateway: G, signal?: AbortSignal): G {
  if (!signal) return gateway
  return new Proxy(gateway, {
    get(target, property) {
      if (property === 'generate')
        return (options: GenerateOptions) => {
          signal.throwIfAborted()
          return target.generate({
            ...options,
            signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
          })
        }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
