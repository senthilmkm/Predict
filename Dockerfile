FROM node:22-alpine

WORKDIR /app

# Copy trading-core package and build it
COPY packages/trading-core ./packages/trading-core
WORKDIR /app/packages/trading-core
RUN npm install && npm run build

# Copy cloud-backend service and build it
WORKDIR /app
COPY services/cloud-backend ./services/cloud-backend
WORKDIR /app/services/cloud-backend
RUN npm install && npm run build

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

CMD ["npm", "start"]
