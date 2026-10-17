/**
 * 运行时文字变体的「可信输出」注册表（DOM 层与程序化转换共用）。
 */
// 可信输出注册表（M1 修复）：OpenCC 对已是繁体的输入非幂等（实测
// twp('儀表板')='儀錶板'、twp('權限')='許可權'，hk 同理）。CC 组件渲染的
// tw/hk 产物与本转换器每次产出的最终繁体值都注册进来；observer 再见到
// 同值时视为最终输出直接跳过，避免二次转换腐蚀（若腐蚀发生，WeakMap
// 又记录下腐蚀值，将永不自愈）。
const MAX_REGISTERED_OUTPUTS = 50000
const convertedOutputs = new Set<string>()

/**
 * 注册一条可信的最终转换输出（幂等，空串忽略）。
 * CC 组件渲染 tw/hk 结果时调用；dom-converter 每次转换产出也顺手注册。
 * 达到上限后丢弃新条目（统计上旧文案不再出现），防无界增长。
 */
export function registerConvertedOutput(text: string): void {
  if (text === '') return
  if (convertedOutputs.size >= MAX_REGISTERED_OUTPUTS) return
  convertedOutputs.add(text)
}

/** 是否为已注册的可信最终输出。 */
export function isConvertedOutput(text: string): boolean {
  return convertedOutputs.has(text)
}
