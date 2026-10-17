'use client'

/**
 * v3-copilot-productized-operating-entry —— 演示能力的**显式声明**（任务 4.4）。
 *
 * 演示态此前是任意错误的 catch-all 回退。现在它必须由宿主构建/运行环境显式声明，
 * 且用户显式选择才能进入（design D7 / spec: Demonstration mode MUST require an
 * explicit host capability declaration for local/test use or an explicit user action）。
 *
 * 声明来源固定为构建期环境变量，不从错误、URL 参数或服务端响应推断：
 * - `NEXT_PUBLIC_COPILOT_DEMO=1` 显式打开（本机开发与受控演示）；
 * - 其余情况一律 false，生产构建默认不具备演示能力。
 */

import { useEffect } from 'react'
import { useCopilotStore } from '@/stores/copilot-store'

/** 显式声明开关的环境变量名。 */
export const COPILOT_DEMO_CAPABILITY_ENV = 'NEXT_PUBLIC_COPILOT_DEMO'

/**
 * 读取宿主是否声明了演示能力。
 *
 * 纯函数：只看显式声明值，不看运行时错误、也不看 `NODE_ENV`——
 * 「开发环境」不等于「用户想看演示」。
 */
export function readCopilotDemoCapability(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): boolean {
  return env[COPILOT_DEMO_CAPABILITY_ENV] === '1'
}

/**
 * 把声明注入 store（应用壳挂载时调用一次）。
 *
 * 注入声明**不会**进入演示——还需用户在入口显式选择。
 */
export function useDeclareCopilotDemoCapability(): void {
  const setDemoCapabilityDeclared = useCopilotStore((state) => state.setDemoCapabilityDeclared)
  useEffect(() => {
    setDemoCapabilityDeclared(readCopilotDemoCapability())
  }, [setDemoCapabilityDeclared])
}
