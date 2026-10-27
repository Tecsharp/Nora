# Servicio de conversión de documentos (LibreOffice headless + Node). Solo accesible desde la red interna.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-liberation fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

# Usuario sin privilegios; LibreOffice necesita un HOME y /tmp escribibles
ENV HOME=/tmp PORT=3100 SOFFICE=soffice
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
