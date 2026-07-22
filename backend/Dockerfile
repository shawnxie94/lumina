FROM python:3.11-slim

WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NODE_ENV=production

# Node is required for Defuddle-backed local HTML extraction.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && test -d node_modules/defuddle \
    && node -e "const p=require('./node_modules/defuddle/package.json'); if(!p.version) process.exit(1); console.log('defuddle', p.version)"

COPY . .

RUN pip install --no-build-isolation --no-cache-dir --no-compile -e .

RUN mkdir -p /app/data

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
