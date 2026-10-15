FROM node:22-alpine

WORKDIR /opt/nash-racion
COPY server.mjs ./server.mjs

ENV BIND_HOST=0.0.0.0 \
    PORT=8787 \
    HERMES_URL=http://127.0.0.1:8642/v1/chat/completions \
    NODE_ENV=production

EXPOSE 8787
CMD ["node", "server.mjs"]
