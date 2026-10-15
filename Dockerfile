FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_REPOSITORY_URL
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATABASE_PATH=/app/data/votes.sqlite
COPY --from=build /app/dist ./dist
COPY --from=build /app/public/data ./public/data
COPY --from=build /app/server ./server
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 3001
CMD ["node", "server/index.mjs"]
