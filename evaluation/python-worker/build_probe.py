"""Generate probe fixtures/SDK and trim runtime packages, without changing the API."""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
subprocess.run(["pywrangler", "sync"], cwd=root, check=True)
target = root / ".generated-sdk"
if target.exists():
    shutil.rmtree(target)
subprocess.run(
    [
        "uv",
        "pip",
        "install",
        "--no-deps",
        "--target",
        str(target),
        "--require-hashes",
        "-r",
        str(root / "firebase-auth-fixture.txt"),
    ],
    cwd=root,
    check=True,
)
package = root / "src/firebase_admin"
if package.exists():
    shutil.rmtree(package)
shutil.copytree(target / "firebase_admin", package)
# Upstream package stays intact. Only unrelated AWS service model directories are omitted.
for model in (root / "python_modules/botocore/data").iterdir():
    if model.is_dir() and model.name not in {"s3", "sesv2", "bedrock-runtime"}:
        shutil.rmtree(model)
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
pem = key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
).decode()
backend = root.parents[1] / "backend"
sources = {
    str(p.relative_to(backend)): p.read_text()
    for p in backend.rglob("*.py")
    if not any(part.startswith(".") for part in p.relative_to(backend).parts)
}
(root / "src/fixtures.py").write_text(
    "# GENERATED fixture key, not a real credential. Do not commit.\nSOURCES = "
    + repr(sources)
    + "\nPRIVATE_KEY = "
    + repr(pem)
    + "\n"
)
manifest = {}
for path in sorted(package.rglob("*.py")):
    manifest[str(path.relative_to(package))] = hashlib.sha256(
        path.read_bytes()
    ).hexdigest()
(root / ".generated-sdk/manifest.json").write_text(
    json.dumps(
        {
            "package": "firebase-admin",
            "version": "7.5.0",
            "source": "https://pypi.org/project/firebase-admin/7.5.0/",
            "license": "Apache-2.0",
            "sha256": manifest,
        },
        indent=2,
    )
)
print(
    "Prepared fixture-only Worker. Deploy using Wrangler directly so pywrangler does not restore unneeded AWS models."
)
