"""Negative control: exact production Boto import during snapshot."""

import boto3
from workers import Response, WorkerEntrypoint


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return Response.json({"boto3": boto3.__version__})
