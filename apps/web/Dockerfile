FROM node:22-alpine

RUN npm install -g pnpm@11.17.0

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter @sos-animal/web...

COPY apps/web ./apps/web

ARG PUBLIC_API_URL=http://localhost:8000/api/v1
ENV PUBLIC_API_URL=${PUBLIC_API_URL}

RUN pnpm --filter @sos-animal/web build

EXPOSE 4321

CMD ["pnpm", "--filter", "@sos-animal/web", "preview", "--host", "0.0.0.0", "--port", "4321"]
