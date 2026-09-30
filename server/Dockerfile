FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY server ./server
COPY shared ./shared
COPY schema.sql ./schema.sql
EXPOSE 4000
CMD ["node", "--import", "tsx", "server/index.ts"]
