.PHONY: dev backend frontend test

dev:
	$(MAKE) -j2 backend frontend

backend:
	uv run uvicorn backend.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

test:
	uv run pytest -v
