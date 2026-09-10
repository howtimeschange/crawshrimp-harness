"""Render document copies with private LibreOffice profiles and bundled fonts."""
from __future__ import annotations

import shutil
import threading
from pathlib import Path

from .executor import execute
from .runtime import OfficeError, assets, file_hash, office_root


def render(document: Path, work: Path, *, recalculate: bool = False,
           cancel: threading.Event | None = None) -> dict:
    import pymupdf as fitz
    from PIL import Image, ImageDraw
    manifest = assets()
    profile = work / "lo-profile"
    profile.mkdir(parents=True, exist_ok=True)
    # A private profile prevents reuse of the user's running GUI instance.
    (profile / "user").mkdir(exist_ok=True)
    (profile / "user/registrymodifications.xcu").write_text(
        '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry">'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
        '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>'
        '<item oor:path="/org.openoffice.Office.Calc/Content/Update">'
        '<prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>', encoding="utf-8")
    command = [str(office_root() / manifest["executable"]["path"]),
               f"-env:UserInstallation={profile.as_uri()}", "--headless", "--nologo", "--nodefault", "--norestore"]
    editable, preview = work / "editable", work / "preview"
    editable.mkdir(exist_ok=True)
    preview.mkdir(exist_ok=True)
    copied = editable / document.name
    shutil.copy2(document, copied)
    if recalculate:
        if copied.suffix.lower() != ".xlsx":
            raise OfficeError("OFFICE_INVALID_INPUT", "重算只适用于 XLSX。")
        recalc = work / "recalculated"
        recalc.mkdir(exist_ok=True)
        execute([*command, "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", str(recalc), str(copied)], work, cancel=cancel)
        recalculated = recalc / copied.name
        if not recalculated.is_file():
            raise OfficeError("OFFICE_RECALC_FAILED", "LibreOffice 未产生重算文件。")
        shutil.copy2(recalculated, copied)
    # Keep editable documents in their native font names. LibreOffice's
    # localized family fallback lists are only needed for PDF rendering.
    render_input_dir = work / "render-input"
    render_input_dir.mkdir(exist_ok=True)
    render_input = render_input_dir / copied.name
    shutil.copy2(copied, render_input)
    from .fonts import normalize_office_fonts
    normalize_office_fonts(render_input)
    filters = {".docx": "writer_pdf_Export", ".pptx": "impress_pdf_Export", ".xlsx": "calc_pdf_Export"}
    filter_name = filters.get(copied.suffix.lower())
    if not filter_name:
        raise OfficeError("OFFICE_FORMAT_UNSUPPORTED", "仅支持 docx、pptx、xlsx。")
    execute([*command, "--convert-to", f"pdf:{filter_name}", "--outdir", str(preview), str(render_input)], work, cancel=cancel)
    pdf = preview / (copied.stem + ".pdf")
    if not pdf.is_file():
        raise OfficeError("OFFICE_RENDER_FAILED", "LibreOffice 未产生 PDF，原件已保留。")
    pages_dir = preview / "pages"
    pages_dir.mkdir(exist_ok=True)
    pages = []
    pdf_fonts = set()
    with fitz.open(pdf) as doc:
        if not doc.page_count:
            raise OfficeError("OFFICE_RENDER_FAILED", "PDF 没有页面。")
        if doc.page_count > 500:
            raise OfficeError("OFFICE_PAGE_LIMIT", "超过单次 500 页限制，请拆分文档或调整打印范围；原件和 PDF 已保留。")
        for i, page in enumerate(doc):
            if cancel and cancel.is_set():
                raise OfficeError("OFFICE_CANCELED", "作业已取消。")
            scale = min(2, (12_000_000 / max(1, page.rect.width * page.rect.height)) ** 0.5)
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            dest = pages_dir / f"page-{i + 1:04d}.png"
            pix.save(dest)
            pages.append({"page": i + 1, "path": str(dest), "sha256": file_hash(dest),
                          "width": pix.width, "height": pix.height, "text_length": len(page.get_text())})
            pdf_fonts.update(font[3] for font in page.get_fonts())
    # Bounded index sheet; per-page images remain the verification source.
    thumbs = pages[:60]
    sheet = Image.new("RGB", (640, ((len(thumbs) + 3) // 4) * 150), "#eeeeee")
    draw = ImageDraw.Draw(sheet)
    for i, item in enumerate(thumbs):
        with Image.open(item["path"]) as img:
            img.thumbnail((150, 125))
            x, y = (i % 4) * 160, (i // 4) * 150
            sheet.paste(img, (x, y))
            draw.text((x + 5, y + 130), str(item["page"]), fill="black")
    contact = preview / "contact-sheet.png"
    sheet.save(contact)
    return {"document": str(copied), "revision": file_hash(copied), "pdf": str(pdf),
            "pages": pages, "contact_sheet": str(contact), "fonts": sorted(pdf_fonts),
            "runtime_version": manifest["libreofficeVersion"], "recalculated": recalculate}
