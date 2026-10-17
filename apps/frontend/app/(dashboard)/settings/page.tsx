import { redirect } from 'next/navigation'

/**
 * 设置入口保持为稳定的父级路由；默认落到所有版本均可使用的个人资料页。
 * 后续若交付设置总览，只需用真实页面替换此重定向，无需改动全局导航配置。
 */
export default function SettingsPage() {
  redirect('/settings/profile')
}
