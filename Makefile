.PHONY: install dev backend frontend test test-backend test-frontend build

install:
	cd backend && uv sync
	cd frontend && npm install

dev:
	$(MAKE) -j2 backend frontend

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

test: test-backend test-frontend

test-backend:
	cd backend && uv run pytest -q

test-frontend:
	cd frontend && npx tsc -b --noEmit && npx vitest run

build:
	cd frontend && npm run build
