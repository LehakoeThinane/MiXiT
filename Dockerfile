FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY backend/package.json backend/pnpm-lock.yaml ./
COPY backend/prisma ./prisma/

RUN pnpm install --frozen-lockfile

COPY backend/ .

RUN pnpm run build

EXPOSE 8080

CMD ["node", "dist/server.js"]
