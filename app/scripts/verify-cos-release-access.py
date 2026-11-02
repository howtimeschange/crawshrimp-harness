#!/usr/bin/env python3
"""Verify release-directory list permission and its boundaries without writing COS."""
import os


RELEASE_PREFIX = "harness/releases/"
# None omits Prefix altogether. The others catch accidental wildcard/boundary grants.
DENIED_PREFIXES = (None, "harness/", "harness/latest/", "harness/releases", "harness/releases-private/")


def verify_access(client, bucket):
    client.list_objects(Bucket=bucket, Prefix=RELEASE_PREFIX, MaxKeys=1)
    for prefix in DENIED_PREFIXES:
        request = {"Bucket": bucket, "MaxKeys": 1}
        if prefix is not None:
            request["Prefix"] = prefix
        try:
            client.list_objects(**request)
        except Exception as error:
            status = getattr(error, "get_status_code", lambda: None)()
            code = getattr(error, "get_error_code", lambda: None)()
            if str(status) != "403" or code != "AccessDenied":
                raise
        else:
            # Never log returned object names, even if a boundary was misconfigured.
            raise RuntimeError("COS list access exceeds the release-directory boundary")


def main():
    from qcloud_cos import CosConfig, CosS3Client
    client = CosS3Client(CosConfig(
        Region=os.environ["COS_RELEASE_REGION"],
        SecretId=os.environ["TENCENT_SECRET_ID"],
        SecretKey=os.environ["TENCENT_SECRET_KEY"],
        Token=os.environ["TENCENT_TOKEN"], Scheme="https"))
    verify_access(client, os.environ["COS_RELEASE_BUCKET"])
    print("OIDC and scoped COS list verified; root and unrelated prefixes denied; no objects modified")


if __name__ == "__main__":
    main()
