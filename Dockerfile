# --- build stage: compile TypeScript with dev dependencies ---
FROM node:24.11-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- runtime stage: production deps only, non-root user ---
FROM node:24.11-alpine
LABEL org.opencontainers.image.title="ecommerce-scraper" \
      org.opencontainers.image.description="Scrapes webscraper.io's static e-commerce test site into a JSON report" \
      org.opencontainers.image.source="https://github.com/nikolay-yankov/e-commerce-scraper" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/cli.js"]
