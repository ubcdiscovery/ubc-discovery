# ghcr.io/astral-sh/uv:0.11.16-python3.14-trixie-slim
FROM ghcr.io/astral-sh/uv@sha256:14fbf3734501e0d9179b68c952445c03fe46787ed8d6a5bb3143dcf59fef2093

# Copy the project into the image
COPY . /app

# Disable development dependencies
ENV UV_NO_DEV=1

# Sync the project into a new environment, asserting the lockfile is up to date
WORKDIR /app
RUN uv sync --locked

EXPOSE 8000

CMD ["sh", "-c", "uv run alembic upgrade head && exec uv run fastapi run main.py --host 0.0.0.0 --port 8000"]
