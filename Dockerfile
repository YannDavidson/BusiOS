FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json eslint.config.js vitest.config.ts ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S busios && adduser -S busios -G busios
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER busios
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
