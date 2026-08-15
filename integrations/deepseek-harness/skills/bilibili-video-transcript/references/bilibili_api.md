# Bilibili API Notes

Use these public or page-owned endpoints before trying brittle DOM scraping.

## Metadata

```text
GET https://api.bilibili.com/x/web-interface/view?bvid=<bvid>
GET https://api.bilibili.com/x/player/pagelist?bvid=<bvid>
```

`view` returns title, owner, duration, `aid`, and first-page `cid`. `pagelist` is useful for multi-part videos.

## Player, Subtitles, And Chapters

```text
GET https://api.bilibili.com/x/player/v2?bvid=<bvid>&cid=<cid>
GET https://api.bilibili.com/x/player/wbi/v2?bvid=<bvid>&cid=<cid>
```

Relevant fields:

- `data.subtitle.subtitles`: platform subtitles. Empty list means no public subtitle body was exposed to the current session.
- `data.need_login_subtitle`: login requirement signal.
- `data.view_points`: official chapter markers with `from`, `to`, and `content`.

Bilibili subtitle bodies are usually JSON with a `body` array containing `from`, `to`, and `content` fields.

## WBI Signing

Some endpoints require WBI signing. Fetch keys from:

```text
GET https://api.bilibili.com/x/web-interface/nav
```

Build the mixin key from `wbi_img.img_url` and `wbi_img.sub_url`, add `wts`, sort query parameters, and append `w_rid=md5(query + mixin_key)`.

## AI Summary

The AI conclusion endpoint may require both WBI signing and login:

```text
GET https://api.bilibili.com/x/web-interface/view/conclusion/get?bvid=<bvid>&cid=<cid>&up_mid=<mid>&wts=<ts>&w_rid=<md5>
```

Common outcomes:

- `code: -101`, `message: 账号未登录`: signed request is valid enough to reach the auth gate, but the current request has no logged-in account.
- `code: -403`: missing authorization, invalid signing, or access denied.

## Playurl And Media

```text
GET https://api.bilibili.com/x/player/playurl?bvid=<bvid>&cid=<cid>&fnval=4048&fourk=1
GET https://api.bilibili.com/x/player/wbi/playurl?bvid=<bvid>&cid=<cid>&fnval=4048&fourk=1
```

`data.dash.audio` contains audio streams. Signed `baseUrl` and `backupUrl` values expire and should remain in private scratch storage. Save only a sanitized summary in final output.

## yt-dlp 412

Bilibili often returns HTTP 412 to generic downloaders. Prefer page-owned API requests with browser-like `User-Agent`, `Referer: https://www.bilibili.com/video/<bvid>/`, and no persisted cookies or auth secrets.
