FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json tsconfig.base.json
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/api apps/api
COPY packages/shared packages/shared
RUN npm run postinstall --workspace=@tglobal/api

EXPOSE 3001
CMD ["sh", "-c", "npm run db:migrate --workspace=@tglobal/api && npm run db:seed --workspace=@tglobal/api && npm run start --workspace=@tglobal/api"]
