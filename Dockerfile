FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-aiohttp \
    && ln -sf python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3123 8123

ENTRYPOINT ["/app/docker-entrypoint.sh"]
