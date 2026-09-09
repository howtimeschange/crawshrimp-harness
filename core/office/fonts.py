"""Normalize bundled font aliases in a working copy, preserving all other OOXML."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree

ALIASES = {"Source Han Sans SC": "思源黑体", "Source Han Serif SC": "思源宋体"}


def normalize_office_fonts(path: Path) -> None:
    replacement = path.with_suffix(path.suffix + ".fonts-tmp")
    try:
        with ZipFile(path) as source, ZipFile(replacement, "w") as dest:
            for entry in source.infolist():
                data = source.read(entry)
                if entry.filename.endswith(".xml") and any(alias.encode() in data for alias in ALIASES):
                    tree = etree.fromstring(data, parser=etree.XMLParser(resolve_entities=False, no_network=True))
                    changed = False
                    for node in tree.iter():
                        if etree.QName(node).localname not in ("rFonts", "latin", "ea", "cs", "name"):
                            continue
                        for key, value in list(node.attrib.items()):
                            if value in ALIASES and etree.QName(key).localname in ("typeface", "ascii", "hAnsi", "eastAsia", "cs", "val"):
                                node.set(key, ALIASES[value])
                                changed = True
                                if etree.QName(node).localname == "rFonts":
                                    for old in list(node.attrib):
                                        if "theme" in old.lower():
                                            del node.attrib[old]
                    if changed:
                        data = etree.tostring(tree, xml_declaration=True, encoding="UTF-8", standalone=True)
                dest.writestr(entry, data)
        replacement.replace(path)
    finally:
        replacement.unlink(missing_ok=True)
