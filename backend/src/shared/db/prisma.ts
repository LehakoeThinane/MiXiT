import { PrismaClient } from '@prisma/client';

let prismaClient: PrismaClient | null = null;

function getPrismaClient() {
  if (!prismaClient) {
    prismaClient = new PrismaClient();
  }

  return prismaClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, client);

    if (typeof value === 'function') {
      return value.bind(client);
    }

    return value;
  },
});
