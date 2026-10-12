"""Isolated probes. Uses fake AWS credentials, no email/model/write calls."""

import asyncio
import importlib
import json
import sys
import time
from urllib.parse import urlparse

from workers import Response, WorkerEntrypoint


def result(call):
    try:
        return {"ok": True, "value": call()}
    except Exception as exc:  # noqa: BLE001 - probes must report arbitrary runtime failures
        return {"ok": False, "error": type(exc).__name__, "detail": str(exc)[:350]}


def aws_client(service):
    import boto3
    from botocore.config import Config

    return boto3.client(
        service,
        region_name="us-west-2",
        aws_access_key_id="EVALUATION_FAKE_KEY",
        aws_secret_access_key="evaluation-not-a-real-secret",
        config=Config(
            signature_version="s3v4",
            connect_timeout=5,
            read_timeout=5,
            retries={"max_attempts": 0},
        ),
    )


def aws_signing():
    s3 = aws_client("s3")
    url = s3.generate_presigned_url(
        "get_object", Params={"Bucket": "evaluation-fixture", "Key": "fixture.jpg"}
    )
    post = s3.generate_presigned_post("evaluation-fixture", "fixture.jpg")
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest
    from botocore.credentials import Credentials

    signed = {}
    for service in ["ses", "bedrock"]:
        req = AWSRequest(method="POST", url="https://example.com/", data=b"{}")
        SigV4Auth(Credentials("fixture", "fixture"), service, "us-west-2").add_auth(req)
        signed[service] = "Authorization" in req.headers
    return {
        "presigned_get": "X-Amz-" in url,
        "presigned_post": bool(post["fields"]["policy"]),
        "other_signatures": signed,
    }


def aws_transport(service):
    from botocore.exceptions import ClientError

    try:
        if service == "s3":
            aws_client("s3").head_object(
                Bucket="evaluation-fixture-does-not-exist", Key="fixture.jpg"
            )
        else:
            aws_client("sesv2").get_account()
    except ClientError as exc:
        # Authentication denial proves signed request reached AWS; fixture has no real credentials.
        return {
            "http_status": exc.response["ResponseMetadata"]["HTTPStatusCode"],
            "aws_error": exc.response["Error"]["Code"],
        }
    raise AssertionError("Fake AWS credentials unexpectedly accepted")


def crypto():
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    key = serialization.load_pem_private_key(
        __import__("fixtures").PRIVATE_KEY.encode(), password=None
    )
    sig = key.sign(b"fixture", padding.PKCS1v15(), hashes.SHA256())
    key.public_key().verify(sig, b"fixture", padding.PKCS1v15(), hashes.SHA256())
    return {"rsa_sign_verify": True}


def database():
    from pgvector.sqlalchemy import Vector
    from sqlalchemy import (
        Column,
        Integer,
        MetaData,
        Table,
        create_engine,
        insert,
        select,
        text,
    )
    from sqlalchemy.pool import NullPool

    engine = create_engine(
        "postgresql+pg8000://evaluation:evaluation-local-only@127.0.0.1:55432/evaluation",
        poolclass=NullPool,
    )
    meta = MetaData()
    items = Table(
        "evaluation_items",
        meta,
        Column("id", Integer, primary_key=True),
        Column("embedding", Vector(3)),
        prefixes=["TEMPORARY"],
    )
    with engine.connect() as conn:
        outer = conn.begin()
        items.create(conn)
        conn.execute(insert(items).values(id=1, embedding=[1, 2, 3]))
        nested = conn.begin_nested()
        conn.execute(insert(items).values(id=2, embedding=[4, 5, 6]))
        nested.rollback()
        rows = conn.execute(select(items.c.id)).scalars().all()
        distance = conn.execute(
            select(items.c.embedding.l2_distance([1, 2, 3]))
        ).scalar_one()
        conn.execute(text("SELECT pg_advisory_xact_lock(70000070)"))
        outer.rollback()
        remaining = conn.execute(
            text("SELECT to_regclass('pg_temp.evaluation_items')")
        ).scalar_one()
    engine.dispose()
    assert rows == [1] and distance == 0 and remaining is None
    return {
        "savepoint_rollback": True,
        "outer_rollback": True,
        "pgvector_distance": distance,
        "direct_advisory_lock": True,
    }


def firebase_fixture():
    from google.auth import crypt, jwt

    import firebase_admin
    from firebase_admin import _token_gen, auth, credentials
    from fixtures import PRIVATE_KEY

    app = firebase_admin.initialize_app(
        credentials.Certificate(
            {
                "type": "service_account",
                "project_id": "evaluation-fixture",
                "private_key_id": "fixture-key",
                "private_key": PRIVATE_KEY,
                "client_email": "fixture@evaluation-fixture.iam.gserviceaccount.com",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        ),
        name="evaluation-" + str(time.time()),
    )
    try:
        custom = auth.create_custom_token("fixture-user", app=app)
        signer = crypt.RSASigner.from_string(PRIVATE_KEY, "fixture-key")
        from cryptography.hazmat.primitives import serialization

        key = serialization.load_pem_private_key(PRIVATE_KEY.encode(), password=None)
        public = (
            key.public_key()
            .public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            .decode()
        )
        now = int(time.time())
        token = jwt.encode(
            signer,
            {
                "iss": "https://securetoken.google.com/evaluation-fixture",
                "aud": "evaluation-fixture",
                "sub": "fixture-user",
                "iat": now,
                "exp": now + 60,
                "auth_time": now,
            },
        )

        class FixtureResponse:
            status = 200
            data = json.dumps({"fixture-key": public}).encode()

        verifier = _token_gen.TokenVerifier(app)
        verifier.request = lambda *args, **kwargs: FixtureResponse()
        verified = verifier.verify_id_token(token)
        try:
            verifier.verify_id_token(token[:-3] + b"bad")
        except auth.InvalidIdTokenError:
            rejects_tampered = True
        else:
            rejects_tampered = False
        return {
            "custom_token_signed": bool(custom),
            "fixture_id_token_verified": verified["sub"] == "fixture-user",
            "tamper_rejected": rejects_tampered,
            "sdk": firebase_admin.__version__,
            "packaging": "SDK installed without unrelated Firestore/gRPC dependencies",
        }
    finally:
        firebase_admin.delete_app(app)


def database_pbkdf2():
    # Evaluation-only compatibility patch; baseline pg8000 SCRAM probe fails without it.
    import hashlib

    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    def derive(name, password, salt, iterations, dklen=None):
        algo = {"sha256": hashes.SHA256, "sha512": hashes.SHA512, "sha1": hashes.SHA1}[
            name
        ]()
        return PBKDF2HMAC(
            algorithm=algo,
            length=dklen or algo.digest_size,
            salt=salt,
            iterations=iterations,
        ).derive(password)

    hashlib.pbkdf2_hmac = derive
    return database()


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        path = urlparse(str(request.url)).path
        if path == "/runtime":
            return Response.json({"python": sys.version})
        probes = {
            "/signing": aws_signing,
            "/crypto": crypto,
            "/firebase": firebase_fixture,
            "/s3-http": lambda: aws_transport("s3"),
            "/ses-http": lambda: aws_transport("sesv2"),
            "/db": database,
            "/db-pbkdf2": database_pbkdf2,
        }
        if path == "/imports":
            return Response.json(
                {
                    name: result(
                        lambda n=name: getattr(
                            importlib.import_module(n), "__version__", "imported"
                        )
                    )
                    for name in [
                        "fastapi",
                        "sqlalchemy",
                        "asyncpg",
                        "pg8000",
                        "pgvector.sqlalchemy",
                        "boto3",
                        "botocore",
                        "httpx",
                        "cryptography",
                        "openai",
                        "pydantic_settings",
                    ]
                }
            )
        if path == "/syntax":
            sources = __import__("fixtures").SOURCES
            failures = {}
            for name, source in sources.items():
                outcome = result(
                    lambda src=source, filename=name: bool(
                        compile(src, filename, "exec")
                    )
                )
                if not outcome["ok"]:
                    failures[name] = outcome
            return Response.json({"files": len(sources), "failures": failures})
        if path == "/thread":
            try:
                import threading

                main_id = threading.get_ident()
                thread_id = await asyncio.to_thread(threading.get_ident)
                outcome = {
                    "ok": True,
                    "main_thread_id": main_id,
                    "callback_thread_id": thread_id,
                    "distinct_thread": main_id != thread_id,
                }
            except Exception as exc:  # noqa: BLE001 - probes must report arbitrary runtime failures
                outcome = {
                    "ok": False,
                    "error": type(exc).__name__,
                    "detail": str(exc)[:200],
                }
            return Response.json(outcome)
        if path not in probes:
            return Response.json({"error": "Unknown probe"}, status=404)
        start = time.perf_counter()
        outcome = result(probes[path])
        outcome["wall_ms"] = round((time.perf_counter() - start) * 1000, 2)
        return Response.json(outcome)
