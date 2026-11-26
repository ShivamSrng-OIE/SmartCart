# Backend API for hosting on its own (the web app in ../frontend is deployed separately).
#   docker build -t tote-api backend
#   docker run -p 8000:8000 --env-file backend/.env -e CORS_ORIGINS=https://your-web-app.example tote-api
FROM python:3.13-slim

# ffmpeg reads video frames and audio tracks (listing video, voice-overs, evidence clips)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app
COPY data/warehouse ./data/warehouse
COPY eval/results ./eval/results
COPY eval/golden ./eval/golden
COPY eval/cases ./eval/cases
COPY eval/__init__.py eval/metrics.py ./eval/
COPY runs/redteam_recorded.jsonl ./runs/redteam_recorded.jsonl

# Runtime state (merchant listings, reputation, saved model choices) lives here: mount a volume to keep it.
VOLUME ["/srv/data/state"]
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uv run --no-dev uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
