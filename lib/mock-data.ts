export type DiscoverProfile = {
  id: string;
  name: string;
  age: number;
  distance: string;
  city: string;
  tags: string[];
  bio: string;
  initial: string;
  voiceDuration: string;
  online: boolean;
};

export const discoverProfiles: DiscoverProfile[] = [
  {
    id: 'thandi',
    name: 'Thandi',
    age: 24,
    distance: '3.2km away',
    city: 'Johannesburg',
    tags: ['Amapiano', 'Design', 'Coffee', 'Hustle'],
    bio: 'Graphic designer, live music lover. Looking for someone to explore JHB with.',
    initial: 'T',
    voiceDuration: '0:23',
    online: true,
  },
  {
    id: 'lerato',
    name: 'Lerato',
    age: 27,
    distance: '5.1km away',
    city: 'Pretoria',
    tags: ['Travel', 'Faith', 'Food', 'Nature'],
    bio: 'Weekend road trips, good food, and deep conversations.',
    initial: 'L',
    voiceDuration: '0:18',
    online: false,
  },
];

export type ChatMessage = {
  id: string;
  sender: 'me' | 'them';
  type: 'text' | 'voice';
  content: string;
  time: string;
};

export const chatMessagesByProfileId: Record<string, ChatMessage[]> = {
  thandi: [
    {
      id: 'm1',
      sender: 'them',
      type: 'text',
      content: "Sawubona! How's your day? 👋",
      time: '14:32',
    },
    {
      id: 'm2',
      sender: 'me',
      type: 'text',
      content: 'Pretty good, just got off work 😅',
      time: '14:45',
    },
    {
      id: 'm3',
      sender: 'me',
      type: 'text',
      content: 'You design for which agency?',
      time: '14:46',
    },
    {
      id: 'm4',
      sender: 'them',
      type: 'voice',
      content: '0:18',
      time: '14:47',
    },
    {
      id: 'm5',
      sender: 'them',
      type: 'text',
      content: 'Haha I actually freelance 😄 easier that way',
      time: '14:48',
    },
  ],
  lerato: [
    {
      id: 'm1',
      sender: 'them',
      type: 'text',
      content: 'Hey! Any plans this weekend?',
      time: '12:10',
    },
  ],
};
