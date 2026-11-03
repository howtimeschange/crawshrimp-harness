"""Office working assets are not document deliveries."""
from pathlib import Path

DOCUMENT_SUFFIXES = {".pptx", ".docx", ".xlsx", ".pdf"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".bmp", ".tif", ".tiff"}


def publication_files(result: dict) -> list:
    # Rendering produces page images/PDFs alongside the reviewed document.
    # Keep them in the job result for inspection, publish only the document.
    if result.get("document"):
        return [result["document"]]
    return [raw for raw in result.get("files", [])
            if isinstance(raw, str) and Path(raw).suffix.lower() in DOCUMENT_SUFFIXES]


def is_office_working_image(item: dict) -> bool:
    """Also recognize legacy events, whose paths may now point at snapshots."""
    office = item.get("office")
    if not isinstance(office, dict) and item.get("source") != "office":
        return False
    # Explicitly delivered images remain visible; ordinary image deliveries
    # from image generation or artifact_present never match this Office rule.
    if isinstance(office, dict) and (office.get("delivery") or {}).get("status") == "final":
        return False
    path = item.get("filename") or item.get("source_path") or item.get("path") or ""
    return Path(path).suffix.lower() in IMAGE_SUFFIXES
