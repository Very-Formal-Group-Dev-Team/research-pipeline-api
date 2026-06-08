FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --no-frozen-lockfile

COPY . .

RUN sed -i 's/\r//' /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh

RUN mkdir -p /app/uploads/avatars && chown -R node:node /app/uploads

EXPOSE 4000

CMD ["pnpm", "start"]
