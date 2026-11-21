from fastapi import FastAPI

app = FastAPI(title="CartTrap")


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
