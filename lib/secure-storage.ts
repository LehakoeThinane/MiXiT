import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { StateStorage } from 'zustand/middleware';

/**
 * Zustand storage backed by the iOS Keychain / Android Keystore. Used for the
 * session (access + refresh tokens), which must not sit in plain AsyncStorage.
 *
 * Web has no secure store, so it falls back to AsyncStorage (localStorage).
 * On native, a value left in AsyncStorage by an older app version is moved into
 * SecureStore on first read, so existing users stay signed in after updating.
 */
export const secureStorage: StateStorage = {
  async getItem(name) {
    if (Platform.OS === 'web') return AsyncStorage.getItem(name);

    const value = await SecureStore.getItemAsync(name);
    if (value !== null) return value;

    const legacy = await AsyncStorage.getItem(name);
    if (legacy !== null) {
      await SecureStore.setItemAsync(name, legacy);
      await AsyncStorage.removeItem(name);
    }
    return legacy;
  },
  async setItem(name, value) {
    if (Platform.OS === 'web') return AsyncStorage.setItem(name, value);
    await SecureStore.setItemAsync(name, value);
  },
  async removeItem(name) {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(name);
    await SecureStore.deleteItemAsync(name);
    await AsyncStorage.removeItem(name);
  },
};
