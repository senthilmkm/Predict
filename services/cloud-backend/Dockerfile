FROM node:22-alpine
WORKDIR /app
COPY dist/bundle.js ./bundle.js
EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production
CMD ["node", "bundle.js"]
