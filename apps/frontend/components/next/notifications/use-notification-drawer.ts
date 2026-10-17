'use client'

import { create } from 'zustand'
import type { NotificationTypeGroup } from '@/lib/api/notifications'

export type NotificationDrawerTab = NotificationTypeGroup

export interface NotificationDrawerState {
  isOpen: boolean
  activeTab: NotificationDrawerTab
  openDrawer: (tab?: NotificationDrawerTab) => void
  closeDrawer: () => void
  toggleDrawer: () => void
  setActiveTab: (tab: NotificationDrawerTab) => void
}

export const useNotificationDrawerStore = create<NotificationDrawerState>((set) => ({
  isOpen: false,
  activeTab: 'all',
  openDrawer: (tab) =>
    set((state) => ({
      isOpen: true,
      activeTab: tab ?? state.activeTab,
    })),
  closeDrawer: () => set({ isOpen: false }),
  toggleDrawer: () => set((state) => ({ isOpen: !state.isOpen })),
  setActiveTab: (tab) => set({ activeTab: tab }),
}))
