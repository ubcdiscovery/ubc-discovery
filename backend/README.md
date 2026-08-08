# Backend

## Local setup

From the repository root:

```bash
cd backend
uv sync
cp .env.example .env
```

### AWS credentials

The backend uses boto3 for AWS services. Install AWS CLI v2 and authenticate before running code that accesses AWS:

```bash
aws login
```

### Git hooks

Installation:

```bash
uv run --locked pre-commit install
```

After installation, each commit runs the backend Ruff and ty checks automatically.

## Run the backend

```bash
uv run fastapi dev main.py
```

The API is available at http://localhost:8000 and its Swagger documentation is at http://localhost:8000/docs.
