'use client'

import * as React from 'react'
import { Bell, BellOff, Smartphone, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  usePushCapability,
  usePushSubscription,
  usePushSubscribe,
  usePushUnsubscribe,
  useIsPushSupported,
  useNotificationPermission,
} from '@/hooks/use-push'

/**
 * 推送通知设置面板（v2-5-pwa-web-push-notifications）。
 *
 * 提供：
 * - 浏览器推送能力检测
 * - 显式授权按钮（只在用户点击后请求权限）
 * - 取消订阅控制
 * - 状态展示
 * - 不支持/已拒绝/缺少 service worker/功能禁用等降级状态
 *
 * 设计原则（D6）：
 * - 不在页面加载时请求浏览器权限
 * - 只在用户点击显式操作按钮后请求权限
 */
export function PushNotificationSettings() {
  const { data: capability, isLoading: capLoading } = usePushCapability()
  const { data: subscription, isLoading: subLoading } = usePushSubscription()
  const subscribeMutation = usePushSubscribe()
  const unsubscribeMutation = usePushUnsubscribe()
  const isPushSupported = useIsPushSupported()
  const notificationPermission = useNotificationPermission()

  // 加载态
  if (capLoading || subLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>加载推送设置中…</span>
      </div>
    )
  }

  // 功能未启用
  if (!capability?.enabled) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <BellOff className="h-5 w-5" />
          <span>推送通知功能未启用</span>
        </div>
        <p className="mt-1 text-xs text-gray-400">系统管理员未启用 Web Push 通知功能</p>
      </div>
    )
  }

  // 浏览器不支持推送
  if (!isPushSupported) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Smartphone className="h-5 w-5" />
          <span>当前浏览器不支持推送通知</span>
        </div>
        <p className="mt-1 text-xs text-gray-400">请使用最新版 Chrome、Firefox 或 Edge 浏览器</p>
      </div>
    )
  }

  // 权限被永久拒绝
  if (notificationPermission === 'denied') {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
        <div className="flex items-center gap-2 text-sm text-yellow-700">
          <BellOff className="h-5 w-5" />
          <span>通知权限已被拒绝</span>
        </div>
        <p className="mt-1 text-xs text-yellow-600">
          请在浏览器地址栏左侧的锁图标中修改通知权限设置
        </p>
      </div>
    )
  }

  // 已订阅
  if (subscription?.subscribed) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-green-700">
            <Bell className="h-5 w-5" />
            <span>推送通知已开启</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => unsubscribeMutation.mutate()}
            disabled={unsubscribeMutation.isPending}
          >
            {unsubscribeMutation.isPending ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                关闭中…
              </>
            ) : (
              '关闭推送'
            )}
          </Button>
        </div>
        {subscription.userAgent && (
          <p className="mt-1 text-xs text-green-600">设备: {subscription.userAgent}</p>
        )}
        <p className="mt-1 text-xs text-green-600">
          Web Push 通知将镜像站内通知，关闭推送不影响站内通知接收
        </p>
      </div>
    )
  }

  // 未订阅 - 显示订阅按钮
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <Bell className="h-5 w-5" />
          <span>开启浏览器推送通知</span>
        </div>
        <Button onClick={() => subscribeMutation.mutate()} disabled={subscribeMutation.isPending}>
          {subscribeMutation.isPending ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              请求中…
            </>
          ) : (
            '开启推送'
          )}
        </Button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        开启后，即使离开本页面也能收到重要通知提醒。 Web Push
        通知仅镜像站内通知，关闭推送不影响站内通知。
      </p>
    </div>
  )
}
