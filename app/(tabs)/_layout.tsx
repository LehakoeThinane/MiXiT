import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getConversations } from '@/lib/messaging-api';
import { getReceivedVibes } from '@/lib/matching-api';
import { registerForPushNotifications } from '@/lib/notifications';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/stores/auth-store';
import { useTypingStore } from '@/stores/typing-store';
import { useUnreadStore } from '@/stores/unread-store';

export default function TabLayout() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const isAuthenticated = Boolean(accessToken);
  const { lastVibesSeenCount, lastChatOpenedAt } = useUnreadStore();

  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: getConversations,
    enabled: isAuthenticated,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const vibesQuery = useQuery({
    queryKey: ['vibes'],
    queryFn: getReceivedVibes,
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const unreadChats = (conversationsQuery.data ?? []).filter((c) => {
    const lastOpened = lastChatOpenedAt[c.id] ?? 0;
    return new Date(c.lastMessageAt).getTime() > lastOpened;
  }).length;

  const currentVibesCount = (vibesQuery.data ?? []).length;
  const unreadVibes = lastVibesSeenCount === -1
    ? currentVibesCount
    : Math.max(0, currentVibesCount - lastVibesSeenCount);

  useEffect(() => {
    if (accessToken) {
      connectSocket(accessToken);
      registerForPushNotifications();
    } else {
      disconnectSocket();
    }
    return () => {
      // only disconnect when layout unmounts (app close / sign-out navigation)
      disconnectSocket();
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket();
    if (!socket) return;

    const setTyping = useTypingStore.getState().setTyping;
    const clearTimers: Record<string, ReturnType<typeof setTimeout>> = {};

    const onTypingStart = ({ senderId }: { senderId: string }) => {
      setTyping(senderId, true);
      clearTimeout(clearTimers[senderId]);
      // typing:stop can be dropped on disconnect — fail safe back to not-typing
      clearTimers[senderId] = setTimeout(() => setTyping(senderId, false), 6000);
    };
    const onTypingStop = ({ senderId }: { senderId: string }) => {
      clearTimeout(clearTimers[senderId]);
      setTyping(senderId, false);
    };

    socket.on('typing:start', onTypingStart);
    socket.on('typing:stop', onTypingStop);
    return () => {
      socket.off('typing:start', onTypingStart);
      socket.off('typing:stop', onTypingStop);
      Object.values(clearTimers).forEach(clearTimeout);
    };
  }, [accessToken]);
  return (
    <Tabs
      initialRouteName="discover"
      screenOptions={{
        tabBarActiveTintColor: '#ff6b35',
        tabBarInactiveTintColor: '#c3c9e0',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'rgba(11, 13, 24, 0.68)',
          borderTopColor: 'rgba(255,255,255,0.18)',
          height: Platform.OS === 'ios' ? 84 : 68,
          paddingBottom: Platform.OS === 'ios' ? 22 : 8,
          paddingTop: 6,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}>
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="magnifyingglass.circle.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="bubble.left.and.bubble.right.fill" color={color} />,
          tabBarBadge: unreadChats > 0 ? unreadChats : undefined,
          tabBarBadgeStyle: { backgroundColor: '#ff6b35', color: '#fff', fontSize: 11 },
        }}
      />
      <Tabs.Screen
        name="rooms"
        options={{
          title: 'Rooms',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="vibes"
        options={{
          title: 'Vibes',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="hand.thumbsup.fill" color={color} />,
          tabBarBadge: unreadVibes > 0 ? unreadVibes : undefined,
          tabBarBadgeStyle: { backgroundColor: '#ff6b35', color: '#fff', fontSize: 11 },
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="person.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
