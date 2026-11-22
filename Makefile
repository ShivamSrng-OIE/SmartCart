.PHONY: install dev api web test test-backend test-frontend build

install:
	uv sync
	cd ../frontend && npm install

# both servers: API on :8000, web app on :5173
dev:
	$(MAKE) -j2 api web

api:
	uv run uvicorn app.main:app --reload --port 8000

web:
	cd ../frontend && npm run dev

test: test-backend test-frontend

test-backend:
	uv run pytest -q

test-frontend:
	cd ../frontend && npx tsc -b --noEmit && npx vitest run

build:
	cd ../frontend && npm run build
