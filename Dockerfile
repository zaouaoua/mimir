# syntax=docker/dockerfile:1

FROM node:20-alpine
WORKDIR /app

# Default SQLite location inside container (overridable via compose/env)
ENV DATABASE_URL=file:/data/dev.db

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production

RUN mkdir -p /data /app/uploads

EXPOSE 3000

# Ensure DB schema exists (SQLite) before starting
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
