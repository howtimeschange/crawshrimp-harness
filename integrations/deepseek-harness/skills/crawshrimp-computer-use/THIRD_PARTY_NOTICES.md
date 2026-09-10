# Sources and attribution

## Shrimp emoji artwork

`assets/shrimp-emoji.png` is the unmodified U+1F990 artwork from Twemoji v16.0.1,
by Twitter, Inc. and other contributors, licensed under CC BY 4.0.
Source: https://github.com/jdecked/twemoji/blob/v16.0.1/assets/72x72/1f990.png
License: https://creativecommons.org/licenses/by/4.0/ (full text in `assets/LICENSE-twemoji.txt`).
The Windows banner scales this bundled artwork at render time; it requires no font or network download.

Architecture and implementation references:

- huashu-mac-use: https://github.com/alchaincyf/huashu-mac-use , commit `4dda98c`. Layered control, observation receipts, background window capture and Unicode event techniques informed this implementation. Portions of `scripts/native/mac.swift` adapt those MIT-licensed techniques; original license follows.
- WechatAGI: https://github.com/howtimeschange/WechatAGI , commit `059032ea186ab12484663fc91211a4464d61ede5`. Studied platform dispatch, Windows UIA/Win32 use, Chinese input and queue behavior. No WechatAGI source code is bundled; the generic backends are newly implemented, and the WeChat-specific sending workflow is not copied.
- Existing crawshrimp-skill is discovered and invoked as a separate local dependency. Its source, session data and browser engine are not redistributed here.
- pywinauto/pywin32/psutil/Pillow are external Windows dependencies, installed separately under their respective licenses.

## huashu-mac-use license

MIT License

Copyright (c) 2026 Huashu (花叔)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
