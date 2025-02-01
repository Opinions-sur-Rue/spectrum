FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run prepare
RUN npm run build
RUN npm prune --production

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache \
  libc6-compat \
  cairo-dev \
  pango-dev \
  jpeg-dev \
  giflib-dev \
  && rm -rf /var/cache/apk/*

COPY --from=builder /app/build build/
COPY --from=builder /app/node_modules node_modules/
COPY package.json .
ENV NODE_ENV=production
ENV PORT=2000
ENV HOST=0.0.0.0
ENV VITE_VERSION=1.0.0
CMD [ "node", "build" ]
