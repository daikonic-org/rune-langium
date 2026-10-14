// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { create } from 'zustand';

const defaults = { calm: false, readable: false, auxiliary: false, header: false, details: false, path: false };
export type DesignPreviewPreference = keyof typeof defaults;

/** Page-session UI choices; the opt-in development panel is the only writer. */
export const useDesignPreviewStore = create<{
  preferences: typeof defaults;
  gap: string;
  setPreference(key: DesignPreviewPreference, value: boolean): void;
  setGap(value: string): void;
  reset(): void;
}>((set) => ({
  preferences: { ...defaults },
  gap: 'current',
  setPreference: (key, value) => set((state) => ({ preferences: { ...state.preferences, [key]: value } })),
  setGap: (gap) => set({ gap }),
  reset: () => set({ preferences: { ...defaults }, gap: 'current' })
}));
