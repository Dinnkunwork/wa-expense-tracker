FROM node:22-alpine

# Baileys butuh beberapa native dep dasar (build tools untuk optional deps, tzdata untuk timezone)
RUN apk add --no-cache tzdata

WORKDIR /app

# Install dependencies dulu (layer terpisah) supaya cache Docker efektif
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY scripts ./scripts

# Folder session WhatsApp & data disimpan di luar image (lihat docker-compose.yml volumes)
RUN mkdir -p /app/auth_session

ENV NODE_ENV=production
ENV TZ=Asia/Jakarta

# Health check: membaca file status koneksi WhatsApp yang ditulis oleh WhatsAppChannel
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const fs=require('fs'),os=require('os'),p=require('path').join(os.tmpdir(),'wa-expense-health.json');try{const d=JSON.parse(fs.readFileSync(p,'utf8'));process.exit(d.status==='logged_out'||d.status==='stopped'?1:0)}catch{process.exit(1)}"

CMD ["node", "src/index.js"]
