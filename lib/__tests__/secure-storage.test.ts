import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { secureStorage } from '@/lib/secure-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});

const secureMap = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = 'MiXiT-auth';
const session = JSON.stringify({ state: { accessToken: 'a', refreshToken: 'r' }, version: 0 });

beforeEach(async () => {
  secureMap.clear();
  await AsyncStorage.clear();
});

describe('secureStorage (iOS/Android)', () => {
  it('writes the session to the Keychain/Keystore, not AsyncStorage', async () => {
    await secureStorage.setItem(KEY, session);
    expect(secureMap.get(KEY)).toBe(session);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('moves a session saved by an older app version out of AsyncStorage on first read', async () => {
    await AsyncStorage.setItem(KEY, session);

    expect(await secureStorage.getItem(KEY)).toBe(session); // user stays signed in
    expect(secureMap.get(KEY)).toBe(session); // now in secure storage
    expect(await AsyncStorage.getItem(KEY)).toBeNull(); // plaintext copy gone
  });

  it('prefers the secure copy when both exist', async () => {
    secureMap.set(KEY, session);
    await AsyncStorage.setItem(KEY, 'stale');
    expect(await secureStorage.getItem(KEY)).toBe(session);
  });

  it('removes the session from both stores on sign-out', async () => {
    secureMap.set(KEY, session);
    await AsyncStorage.setItem(KEY, session);
    await secureStorage.removeItem(KEY);
    expect(secureMap.has(KEY)).toBe(false);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('returns null when there is no session anywhere', async () => {
    expect(await secureStorage.getItem(KEY)).toBeNull();
  });
});
