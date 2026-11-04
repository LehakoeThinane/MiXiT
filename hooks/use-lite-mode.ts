import * as Device from 'expo-device';
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useSettingsStore } from '@/stores/settings-store';

// Phones with less RAM than this (e.g. 2–3 GB budget Androids) get the light
// experience automatically: static backgrounds instead of animated ones.
const LOW_MEMORY_BYTES = 3.5 * 1024 * 1024 * 1024;

export const isLowEndDevice = typeof Device.totalMemory === 'number' && Device.totalMemory < LOW_MEMORY_BYTES;

/** True when the app should skip non-essential animation and heavy media. */
export function useLiteMode(): boolean {
  const dataSaver = useSettingsStore((state) => state.dataSaver);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  return dataSaver || isLowEndDevice || reduceMotion;
}
