FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY migrations ./migrations
COPY src ./src
# The API, worker and migrate job share this image; compose picks the command.
CMD ["node", "src/api/server.js"]
