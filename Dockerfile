FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund
COPY tsconfig.json eslint.config.js vitest.config.ts ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S busios && adduser -S busios -G busios
COPY package*.json ./
RUN npm install --legacy-peer-deps --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
USER busios
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
