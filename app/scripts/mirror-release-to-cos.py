#!/usr/bin/env python3
"""Mirror a verified stable GitHub release; promote update feeds only after assets exist."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request


STABLE_TAG = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
REFERENCE = re.compile(r"^(\s*(?:-\s*)?(?:url|path):\s*)(\S+?)(\s*)$")


def version_tuple(tag):
    match = STABLE_TAG.fullmatch(tag)
    if not match:
        raise ValueError("Only exact stable vX.Y.Z releases may be mirrored")
    return tuple(map(int, match.groups()))


def release_names(tag):
    version_tuple(tag)
    prefix = f"crawshrimp-harness-{tag}"
    return {
        **{f"{prefix}-mac-{arch}.{ext}": "macos" for arch in ("arm64", "x64")
           for ext in ("dmg", "zip", "zip.blockmap")},
        f"{prefix}-win-x64.exe": "windows",
        f"{prefix}-win-x64.exe.blockmap": "windows",
        "latest-mac.yml": "macos", "latest.yml": "windows",
    }


def normalize_base_url(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password
            or parsed.query or parsed.fragment or ".." in parsed.path.split("/")):
        raise ValueError("Public base URL must be HTTPS without credentials, query or traversal")
    return value.rstrip("/")


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rewrite_metadata(source, name, tag, asset_base):
    versions = re.findall(r"^version:\s*['\"]?([^\s'\"]+)['\"]?\s*$", source, re.MULTILINE)
    if versions != [tag[1:]]:
        raise ValueError(f"{name}: update metadata version must match the release")
    suffixes = ("mac-arm64.zip", "mac-x64.zip") if name == "latest-mac.yml" else ("win-x64.exe",)
    expected = {f"crawshrimp-harness-{tag}-{suffix}" for suffix in suffixes}
    seen, lines = set(), []
    for line in source.splitlines():
        match = REFERENCE.fullmatch(line)
        if match:
            asset = match[2].strip("'\"")
            if asset not in expected:
                raise ValueError(f"{name}: unexpected updater reference {asset}")
            seen.add(asset)
            line = f"{match[1]}{asset_base}/{urllib.parse.quote(asset)}"
        lines.append(line)
    if seen != expected:
        raise ValueError(f"{name}: incomplete platform updater references")
    return ("\n".join(lines) + "\n").encode()


def build_plan(release, latest_release, root, base_url, prefix="harness"):
    tag = release.get("tag_name", "")
    version_tuple(tag)
    if release.get("draft") is not False or release.get("prerelease") is not False:
        raise ValueError("Release must be published and stable")
    if not release.get("published_at"):
        raise ValueError("Release must have a publication timestamp")
    latest_tag = latest_release.get("tag_name", "")
    version_tuple(latest_tag)
    if latest_release.get("draft") is not False or latest_release.get("prerelease") is not False:
        raise ValueError("Upstream latest release must be published and stable")
    base_url = normalize_base_url(base_url)
    if not re.fullmatch(r"[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*", prefix):
        raise ValueError("Object prefix must be a relative path without traversal")
    expected = release_names(tag)
    assets = release.get("assets", [])
    if len(assets) != len(expected) or {asset.get("name") for asset in assets} != set(expected):
        raise ValueError("GitHub release asset set differs from the formal desktop manifest")
    root = Path(root).resolve()
    actual = []
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("Release assets must not contain symlinks")
        if path.is_file():
            actual.append(path.relative_to(root).as_posix())
    if set(actual) != {f"{platform}/{name}" for name, platform in expected.items()}:
        raise ValueError("Local artifact set differs from the formal desktop manifest")
    objects = []
    asset_base = f"{base_url}/{prefix}/releases/{tag}"
    mirrored_assets = []
    for asset in sorted(assets, key=lambda item: item["name"]):
        name = asset["name"]
        path = root / expected[name] / name
        digest = digest_file(path)
        if path.stat().st_size <= 0 or path.stat().st_size != asset.get("size") or asset.get("digest") != f"sha256:{digest}":
            raise ValueError(f"{name}: local bytes differ from GitHub size/SHA256")
        objects.append({"name": name, "path": str(path), "key": f"{prefix}/releases/{tag}/{name}",
                        "size": path.stat().st_size, "sha256": digest})
        mirrored_assets.append({"name": name, "size": asset["size"], "digest": asset["digest"],
                                "browser_download_url": f"{asset_base}/{urllib.parse.quote(name)}"})
    metadata = {}
    for name in ("latest.yml", "latest-mac.yml"):
        metadata[name] = rewrite_metadata((root / expected[name] / name).read_text(), name, tag, asset_base)
    manifest = {key: release.get(key, "") for key in ("id", "tag_name", "name", "body", "html_url", "published_at")}
    manifest.update(draft=False, prerelease=False, assets=mirrored_assets, mirror_provider="tencent-cos")
    return {"tag": tag, "prefix": prefix, "base_url": base_url, "objects": objects,
            "metadata": metadata, "manifest": manifest, "upstream_latest": latest_tag,
            "promote": tag == latest_tag}


def same_object(head, size, digest):
    headers = {key.lower(): str(value) for key, value in head.items()}
    return headers.get("content-length") == str(size) and headers.get("x-cos-meta-sha256") == digest


def publish(plan, store, verify_public):
    """One writer (workflow concurrency) serializes promotion across every version."""
    current = store.read_json(f"{plan['prefix']}/latest/release.json")
    promote = plan["promote"] and (not current or version_tuple(current["tag_name"]) <= version_tuple(plan["tag"]))
    uploaded, reused = [], []
    if not promote:
        return {"tag": plan["tag"], "promoted": False, "uploaded": [], "reused": [],
                "assets": [], "skipped": "Only the latest stable release is retained in COS"}
    for item in plan["objects"]:
        head = store.head(item["key"])
        if head:
            if not same_object(head, item["size"], item["sha256"]):
                raise ValueError(f"Immutable COS object conflicts with this release: {item['key']}")
            reused.append(item["key"])
        else:
            store.upload(item)
            if not same_object(store.head(item["key"]) or {}, item["size"], item["sha256"]):
                raise ValueError(f"COS upload verification failed: {item['key']}")
            uploaded.append(item["key"])
        verify_public(f"{plan['base_url']}/{item['key']}", Path(item["path"]))
    # Feed URLs reference immutable versioned files, so each platform can switch independently.
    if promote:
        for name, body in plan["metadata"].items():
            store.put_bytes(f"{plan['prefix']}/latest/{name}", body, "text/yaml; charset=utf-8")
        body = (json.dumps(plan["manifest"], ensure_ascii=False, indent=2) + "\n").encode()
        store.put_bytes(f"{plan['prefix']}/latest/release.json", body, "application/json; charset=utf-8")
    return {"tag": plan["tag"], "promoted": promote, "uploaded": uploaded, "reused": reused,
            "download_manifest": f"{plan['base_url']}/{plan['prefix']}/latest/release.json",
            "update_feed": f"{plan['base_url']}/{plan['prefix']}/latest/", "assets": plan["manifest"]["assets"]}


def verify_upload_path(plan, store, verify_public):
    """Verify one approved immutable blockmap; never promote feeds or prune objects."""
    current = store.read_json(f"{plan['prefix']}/latest/release.json")
    if not plan["promote"] or (current and version_tuple(current["tag_name"]) > version_tuple(plan["tag"])):
        raise ValueError("Upload probe requires the latest stable release")
    item = min((item for item in plan["objects"] if item["name"].endswith(".blockmap")),
               key=lambda item: item["size"])
    head = store.head(item["key"])
    if head:
        if not same_object(head, item["size"], item["sha256"]):
            raise ValueError(f"Immutable COS object conflicts with this release: {item['key']}")
    else:
        # One final part may be smaller than 1MB. Use a real release object, no canary namespace.
        store.upload(item, force_multipart=True)
        if not same_object(store.head(item["key"]) or {}, item["size"], item["sha256"]):
            raise ValueError(f"COS upload verification failed: {item['key']}")
    verify_public(f"{plan['base_url']}/{item['key']}", Path(item["path"]))
    return {"tag": plan["tag"], "key": item["key"], "size": item["size"], "sha256": item["sha256"],
            "multipart_exercised": not bool(head), "reused": bool(head), "promoted": False,
            "deleted_old_objects": []}


def prune_old_releases(plan, store):
    # Called only after all public asset and metadata probes have succeeded.
    current = store.read_json(f"{plan['prefix']}/latest/release.json")
    if current != plan["manifest"]:
        raise ValueError("Latest manifest changed; refusing old-release cleanup")
    prefix = f"{plan['prefix']}/releases/"
    removed = []
    for key in store.list_keys(prefix):
        parts = key[len(prefix):].split("/")
        if len(parts) != 2 or not STABLE_TAG.fullmatch(parts[0]):
            continue
        tag, name = parts
        if version_tuple(tag) >= version_tuple(plan["tag"]) or name not in release_names(tag):
            continue
        store.delete(key)
        if store.head(key):
            raise ValueError(f"Old COS object still exists after cleanup: {key}")
        removed.append(key)
    return removed


class CosStore:
    def __init__(self, client, bucket):
        self.client, self.bucket = client, bucket

    def head(self, key):
        try:
            return self.client.head_object(Bucket=self.bucket, Key=key)
        except Exception as error:
            if getattr(error, "get_status_code", lambda: None)() == 404:
                return None
            raise

    def read_json(self, key):
        if not self.head(key):
            return None
        body = self.client.get_object(Bucket=self.bucket, Key=key)["Body"].get_raw_stream().read()
        return json.loads(body)

    def upload(self, item, force_multipart=False):
        headers = {"StorageClass": "STANDARD", "CacheControl": "public, max-age=31536000, immutable",
                   "ContentDisposition": f'attachment; filename="{item["name"]}"',
                   "Metadata": {"x-cos-meta-sha256": item["sha256"]}}
        path, part_size = Path(item["path"]), 1024 * 1024
        if item["size"] <= part_size and not force_multipart:
            with path.open("rb") as source:
                self.client.put_object(Bucket=self.bucket, Key=item["key"], Body=source, EnableMD5=True, **headers)
            return

        # SDK 1.9.44 upload_file always lists historic uploads before starting.
        # Start our own upload ID so existing object-scoped permissions suffice.
        part_count = (item["size"] + part_size - 1) // part_size
        if part_count > 10000:
            raise ValueError("Release asset exceeds the supported multipart part count")
        upload_id = self.client.create_multipart_upload(Bucket=self.bucket, Key=item["key"], **headers)["UploadId"]

        def upload_part(number):
            offset = (number - 1) * part_size
            expected_size = min(part_size, item["size"] - offset)
            with path.open("rb") as source:
                source.seek(offset)
                body = source.read(expected_size)
            if len(body) != expected_size:
                raise ValueError("Release asset changed during multipart upload")
            response = self.client.upload_part(Bucket=self.bucket, Key=item["key"], UploadId=upload_id,
                                               PartNumber=number, Body=body, EnableMD5=True)
            etag = {key.lower(): value for key, value in response.items()}["etag"]
            return {"PartNumber": number, "ETag": etag}

        try:
            # Workers read their own slices: at most four 1MB chunks are resident.
            with ThreadPoolExecutor(max_workers=4) as pool:
                parts = list(pool.map(upload_part, range(1, part_count + 1)))
            self.client.complete_multipart_upload(Bucket=self.bucket, Key=item["key"], UploadId=upload_id,
                                                  MultipartUpload={"Part": parts})
        except Exception:
            # Abort only this new, uncommitted upload; never delete an object.
            try:
                self.client.abort_multipart_upload(Bucket=self.bucket, Key=item["key"], UploadId=upload_id)
            except Exception:
                pass  # Keep the original failure; no permission expansion or retry.
            raise

    def put_bytes(self, key, body, content_type):
        digest = hashlib.sha256(body).hexdigest()
        self.client.put_object(Bucket=self.bucket, Key=key, Body=body, EnableMD5=True,
                               ContentType=content_type, CacheControl="no-cache, max-age=60",
                               StorageClass="STANDARD", Metadata={"x-cos-meta-sha256": digest})
        if not same_object(self.head(key) or {}, len(body), digest):
            raise ValueError(f"COS metadata verification failed: {key}")

    def list_keys(self, prefix):
        marker = ""
        while True:
            response = self.client.list_objects(Bucket=self.bucket, Prefix=prefix, Marker=marker, MaxKeys=1000)
            for item in response.get("Contents", []):
                yield item["Key"]
            if str(response.get("IsTruncated", "false")).lower() != "true":
                break
            marker = response["NextMarker"]

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)


def verify_public_range(url, path):
    size = path.stat().st_size
    request = urllib.request.Request(url, headers={"Range": f"bytes=0-{min(size, 4096) - 1}"})
    with urllib.request.urlopen(request, timeout=30) as response, path.open("rb") as source:
        actual = response.read(4097)
        expected = source.read(min(size, 4096))
        valid_range = (response.status == 206 and
                       response.headers.get("Content-Range") == f"bytes 0-{len(expected) - 1}/{size}")
        valid_small_file = (response.status == 200 and size <= 4096 and
                            response.headers.get("Content-Length") == str(size))
        if not (valid_range or valid_small_file) or actual != expected:
            raise ValueError(f"Public COS download verification failed: {url}")


def verify_public_file(url, path):
    digest, size = hashlib.sha256(), 0
    with urllib.request.urlopen(url, timeout=30) as response:
        if response.status != 200:
            raise ValueError(f"Public COS download verification failed: {url}")
        for chunk in iter(lambda: response.read(8 * 1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    if size != path.stat().st_size or digest.hexdigest() != digest_file(path):
        raise ValueError(f"Public COS download verification failed: {url}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-json", required=True)
    parser.add_argument("--latest-release-json", required=True)
    parser.add_argument("--assets-root", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--prefix", default="harness")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--upload-probe-only", action="store_true",
                      help="Verify only one immutable blockmap using multipart; do not promote or clean up")
    parser.add_argument("--skip-cleanup", action="store_true", help="Keep all existing COS objects")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    release = json.loads(Path(args.release_json).read_text())
    subprocess.run(["node", str(Path(__file__).with_name("validate-update-artifacts.js")), args.assets_root,
                    "--formal-release", "--version", release.get("tag_name", "")], check=True)
    plan = build_plan(release, json.loads(Path(args.latest_release_json).read_text()),
                      args.assets_root, args.base_url, args.prefix)
    if args.dry_run:
        report = {key: value for key, value in plan.items() if key != "metadata"}
    else:
        from qcloud_cos import CosConfig, CosS3Client
        client = CosS3Client(CosConfig(Region=args.region, SecretId=os.environ["TENCENT_SECRET_ID"],
                                      SecretKey=os.environ["TENCENT_SECRET_KEY"],
                                      Token=os.environ.get("TENCENT_TOKEN"), Scheme="https", Timeout=60))
        store = CosStore(client, args.bucket)
        report = (verify_upload_path(plan, store, verify_public_file) if args.upload_probe_only else
                  publish(plan, store, verify_public_range))
        # Verify that public update metadata agrees with this completed promotion.
        if report["promoted"]:
            for name, expected in plan["metadata"].items():
                with urllib.request.urlopen(report["update_feed"] + name, timeout=30) as response:
                    if response.read() != expected:
                        raise ValueError(f"Public update metadata mismatch: {name}")
            with urllib.request.urlopen(report["download_manifest"], timeout=30) as response:
                if json.load(response) != plan["manifest"]:
                    raise ValueError("Public download manifest mismatch")
            report["cleanup_skipped"] = args.skip_cleanup
            report["deleted_old_objects"] = [] if args.skip_cleanup else prune_old_releases(plan, store)
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"tag": plan["tag"], "dry_run": args.dry_run,
                      "promoted": report.get("promoted", False), "objects": len(plan["objects"])}))


if __name__ == "__main__":
    main()
