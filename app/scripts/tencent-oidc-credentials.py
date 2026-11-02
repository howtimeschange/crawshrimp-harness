#!/usr/bin/env python3
"""Exchange a GitHub Actions OIDC token for one-hour Tencent credentials."""
import json
import os
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request


def fetch_json(url, *, headers, body=None):
    request = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def exchange(env, request_json=fetch_json):
    if env.get("GITHUB_REPOSITORY") != "howtimeschange/crawshrimp-harness":
        raise ValueError("Only the Harness release repository may request this role")
    ref = env.get("GITHUB_REF", "")
    if ref != "refs/heads/main" and not re.fullmatch(r"refs/tags/v[0-9]+\.[0-9]+\.[0-9]+", ref):
        raise ValueError("Only main or stable version tags may request this role")
    audience = "sts.tencentcloudapi.com"
    parsed = urllib.parse.urlsplit(env["ACTIONS_ID_TOKEN_REQUEST_URL"])
    query = urllib.parse.parse_qsl(parsed.query) + [("audience", audience)]
    token_url = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))
    token = request_json(token_url, headers={
        "Authorization": "Bearer " + env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})["value"]
    response = request_json("https://sts.tencentcloudapi.com", headers={
        "Content-Type": "application/json", "Authorization": "SKIP",
        "X-TC-Action": "AssumeRoleWithWebIdentity", "X-TC-Version": "2018-08-13",
        "X-TC-Region": env.get("COS_RELEASE_REGION", "ap-guangzhou"),
        "X-TC-Timestamp": str(int(time.time())),
    }, body=json.dumps({
        "ProviderId": env["COS_OIDC_PROVIDER"], "WebIdentityToken": token,
        "RoleArn": env["COS_ROLE_ARN"], "RoleSessionName": "harness-" + env["GITHUB_RUN_ID"],
        "DurationSeconds": 3600,
    }).encode())["Response"]
    if "Error" in response:
        # Never include request bodies or tokens in errors or workflow logs.
        raise RuntimeError("Tencent role exchange failed: " + response["Error"].get("Code", "unknown"))
    credentials = response["Credentials"]
    return {"TENCENT_SECRET_ID": credentials["TmpSecretId"],
            "TENCENT_SECRET_KEY": credentials["TmpSecretKey"], "TENCENT_TOKEN": credentials["Token"]}


def main():
    values = exchange(os.environ)
    for value in values.values():
        if not value or "\n" in value or "\r" in value:
            raise ValueError("Unexpected temporary credential format")
        print("::add-mask::" + value)
    with Path(os.environ["GITHUB_ENV"]).open("a") as output:
        for key, value in values.items():
            output.write(key + "=" + value + "\n")
    print("Tencent COS temporary credentials ready (one-hour session)")


if __name__ == "__main__":
    main()
