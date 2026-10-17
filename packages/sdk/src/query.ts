// v2-5-typescript-sdk-core —— 确定性 query 序列化。
//
// 覆盖分页、排序、过滤、include、数组、布尔、数字，省略 undefined；与
// apps/frontend/lib/api-client.ts 的 URLSearchParams 构造语义对齐，但扩展为
// 支持数组多值（include=a&include=b）与 boolean 原值。

/** 任意可序列化的查询参数集合。 */
export type QueryValue =
  string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>

/** 确定性序列化：键按对象定义顺序、undefined/null 省略、数组展开为多值、布尔原值。 */
export function toQueryString(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue
        sp.append(key, String(item))
      }
      continue
    }
    sp.set(key, String(value))
  }
  const str = sp.toString()
  return str ? `?${str}` : ''
}
