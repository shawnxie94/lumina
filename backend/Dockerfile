FROM python:3.11-slim

WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY . .

RUN pip install --no-cache-dir --no-compile -e .

RUN mkdir -p /app/data

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
