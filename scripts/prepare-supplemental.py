"""Import the reviewed PDF/XLSX sources without modifying the originals.

Run with the bundled Python runtime (pdfplumber, pypdfium2, openpyxl,
Pillow). Generated HTML and assets are checked in, so the Node build does
not need Python. Each sidecar pins the rendered view to its source hash.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import zipfile

import openpyxl
import pdfplumber
import pypdfium2 as pdfium


def label(kk, ru):
    return {"kk": kk, "ru": ru}


PDFS = [
    {"id": "program-guidelines", "source": "Zerdeli_avtorlyq_bagdarlamalar_usynystar.pdf", "subject": "resources", "kind": "guide", "grade": None, "title": label("Авторлық бағдарламаларды жүйелеу жөніндегі ұсыныстар", "Рекомендации по систематизации авторских программ")},
    {"id": "digital-education", "source": "ZERDELI_DIGITAL_EDUCATION_tuzhyrymdama_2026.pdf", "subject": "resources", "kind": "concept", "grade": None, "title": label("Zerdeli Digital Education тұжырымдамасы", "Концепция Zerdeli Digital Education")},
    {"id": "component-work-plan", "source": "Zerdeli_komponenti_kelesi_zhumys_zhospary.pdf", "subject": "resources", "kind": "plan", "grade": None, "title": label("Zerdeli компонентін дамыту жоспары", "План развития компонента Zerdeli")},
    {"id": "club-ideas", "source": "Zerdeli_uyirmeler_ideyalar_jinagy_2026.pdf", "subject": "resources", "kind": "collection", "grade": "5–11", "title": label("Үйірмелер мен клубтар идеялары", "Идеи кружков и клубов"), "note": label("8 үйірме идеясы және 4 медиажоба", "8 идей кружков и 4 медиапроекта")},
    {"id": "math-7-teacher-guide", "source": "1-9 мат/7-8 материалдар/Zerdeli_Mathematics_7_mugalim_nusqaulyk_1_2_apta.pdf", "subject": "math", "kind": "guide", "grade": "7", "title": label("7-сынып мұғаліміне арналған нұсқаулық", "Руководство для учителя 7 класса"), "load": label("1–2-апта · 6 сабақ", "1–2 недели · 6 уроков")},
    {"id": "math-7-workbook", "source": "1-9 мат/7-8 материалдар/Zerdeli_Mathematics_7_okuushy_1_2_apta.pdf", "subject": "math", "kind": "appendix", "grade": "7", "title": label("7-сынып оқушысының жұмыс дәптері", "Рабочая тетрадь ученика 7 класса"), "load": label("1–2-апта · 6 сабақ", "1–2 недели · 6 уроков")},
    {"id": "nu-admissions-2027", "source": "NUET/NU_TUSU_2027.pdf", "subject": "nuet", "kind": "guide", "grade": "8–11", "title": label("Назарбаев Университетіне түсу нұсқаулығы", "Руководство по поступлению в Назарбаев Университет"), "note": label("2027–2028 қабылдау науқаны", "Приёмная кампания 2027–2028")},
    {"id": "nuet-exam-guide", "source": "NUET/NUET_PDF.zip/NUET.pdf", "archive": "NUET/NUET_PDF.zip", "archiveMember": "NUET.pdf", "subject": "nuet", "kind": "guide", "grade": "8–11", "title": label("NUET емтиханы туралы толық нұсқаулық", "Полное руководство по экзамену NUET"), "note": label("Емтихан құрылымы және дайындық материалдары", "Структура экзамена и материалы для подготовки")},
    {"id": "mobilography", "source": "мобилография/Zerdeli_Mobilography_7-11_2026_2027.pdf", "subject": "mobilography", "kind": "program", "grade": "7–11", "title": label("Мобильді фото және видео үйірмесінің бағдарламасы", "Программа кружка мобильной фотографии и видео"), "load": label("1 сағат/апта · 34 сағат", "1 час в неделю · 34 часа")},
]

SHEETS = [
    {"id": f"logic-{grade}", "source": f"1-9 мат/{name}", "subject": "logic", "kind": "plan", "grade": str(grade), "title": label(f"{grade}-сынып күнтізбелік-тақырыптық жоспары", f"Календарно-тематический план для {grade} класса"), "load": label("3 сағат/апта · 102 сағат", "3 часа в неделю · 102 часа")}
    for grade, name in [
        (1, "Zerdeli_Logic_1_synyp_102_sagat_KTZH_numaralangan (1).xlsx"),
        (2, "Zerdeli_Logic_2_synyp_102_sagat_KTZH_2026-2027.xlsx"),
        (3, "Zerdeli_Logic_3_synyp_102_sagat_KTZH_2026-2027.xlsx"),
        (4, "Zerdeli_Logic_4_synyp_102_sagat_KTZH_2026-2027.xlsx"),
    ]
]

SUBJECTS = [
    {"id": "logic", "grades": "1–4", "title": label("Зерделі логика", "Логика Zerdeli")},
    {"id": "mobilography", "grades": "7–11", "title": label("Мобилография", "Мобилография")},
    {"id": "resources", "grades": None, "title": label("Әдістемелік материалдар", "Методические материалы")},
]


def extract_pdf(source: Path, doc_id: str, extracted: Path):
    assets = extracted / "assets" / doc_id
    assets.mkdir(parents=True, exist_ok=True)
    output = []
    rendered = pdfium.PdfDocument(source)
    try:
        with pdfplumber.open(source) as pdf:
            for index, page in enumerate(pdf.pages):
                number = index + 1
                text = page.extract_text(layout=True) or ""
                image_name = f"page-{number:02d}.webp"
                image_path = assets / image_name
                pdf_page = rendered[index]
                bitmap = pdf_page.render(scale=1.8)
                image = bitmap.to_pil()
                image.save(image_path, "WEBP", quality=88, method=5)
                width, height = image.size
                image.close()
                bitmap.close()
                pdf_page.close()
                output.append(f'<h2>{number}-бет / Страница {number}</h2>')
                output.append(
                    f'<img class="pdf-page-image" src="content/assets/{doc_id}/{image_name}" '
                    f'alt="{number}-бет / Страница {number}" width="{width}" height="{height}" loading="lazy" />'
                )
                if text.strip():
                    output.append('<details class="pdf-page-text"><summary>Мәтін / Текст</summary>')
                    output.append(f'<pre>{html.escape(text.strip())}</pre></details>')
            return "\n".join(output), {"pages": len(pdf.pages)}
    finally:
        rendered.close()


def cell_value(cell, sheet, cache):
    """Use source caches; calculate only the SUM(range) used by these plans."""
    if cell.data_type != "f":
        return cell.value
    saved = cache[cell.coordinate].value
    if saved is not None:
        return saved
    match = re.fullmatch(r"=SUM\(([A-Z]+\d+):([A-Z]+\d+)\)", cell.value, re.I)
    if not match:
        raise ValueError(f"Uncached unsupported formula: {sheet.title}!{cell.coordinate}: {cell.value}")
    total = 0
    for row in sheet[f"{match[1]}:{match[2]}"]:
        for item in row:
            value = cell_value(item, sheet, cache)
            if isinstance(value, (float, int)) and not isinstance(value, bool):
                total += value
    return total


def display_value(value):
    if value is None:
        return ""
    if isinstance(value, (dt.datetime, dt.date)):
        return value.strftime("%d.%m.%Y")
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def extract_xlsx(source: Path):
    workbook = openpyxl.load_workbook(source, data_only=False)
    cached = openpyxl.load_workbook(source, data_only=True)
    output = []
    stats = []
    try:
        for sheet in workbook:
            spans, skipped = {}, set()
            for merged in sheet.merged_cells.ranges:
                spans[(merged.min_row, merged.min_col)] = (merged.max_row - merged.min_row + 1, merged.max_col - merged.min_col + 1)
                skipped.update((r, c) for r in range(merged.min_row, merged.max_row + 1) for c in range(merged.min_col, merged.max_col + 1) if (r, c) != (merged.min_row, merged.min_col))
            output.append(f'<h2>{html.escape(sheet.title)}</h2>')
            output.append('<table class="worksheet-table"><tbody>')
            filled = 0
            for row in sheet:
                output.append("<tr>")
                for cell in row:
                    if (cell.row, cell.column) in skipped:
                        continue
                    value = display_value(cell_value(cell, sheet, cached[sheet.title]))
                    filled += bool(value)
                    rowspan, colspan = spans.get((cell.row, cell.column), (1, 1))
                    attrs = (f' rowspan="{rowspan}"' if rowspan > 1 else "") + (f' colspan="{colspan}"' if colspan > 1 else "")
                    # Bold source labels remain labels; do not reinterpret data rows as headers.
                    content = html.escape(value).replace("\n", "<br />")
                    if cell.font.bold and content:
                        content = f"<strong>{content}</strong>"
                    output.append(f"<td{attrs}>{content}</td>")
                output.append("</tr>")
            output.append("</tbody></table>")
            stats.append({"name": sheet.title, "rows": sheet.max_row, "columns": sheet.max_column, "filledCells": filled, "mergedRanges": len(spans)})
        return "\n".join(output), {"worksheets": stats}
    finally:
        workbook.close()
        cached.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--content-dir", type=Path, default=Path("content"))
    parser.add_argument("--manifest-out", type=Path, default=Path(".work/supplemental-catalog.json"))
    args = parser.parse_args()
    source_root = args.source_root.resolve()
    docs_dir = args.content_dir / "docs"
    extracted = args.content_dir / "extracted"
    docs_dir.mkdir(parents=True, exist_ok=True)
    extracted.mkdir(parents=True, exist_ok=True)
    documents = []
    for item in PDFS + SHEETS:
        source = (source_root / item.get("archive", item["source"])).resolve()
        if not source.is_relative_to(source_root) or any(part.casefold() == "черновик" for part in source.parts):
            raise ValueError(f"Excluded source: {source}")
        fmt = Path(item["source"]).suffix.lower().lstrip(".")
        destination = docs_dir / f'{item["id"]}.{fmt}'
        if "archive" in item:
            # Read one named member, never unpack an archive into the filesystem.
            with zipfile.ZipFile(source) as archive:
                destination.write_bytes(archive.read(item["archiveMember"]))
        else:
            shutil.copy2(source, destination)
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        body, details = extract_pdf(destination, item["id"], extracted) if fmt == "pdf" else extract_xlsx(destination)
        (extracted / f'{item["id"]}.html').write_text(body, encoding="utf-8")
        sidecar = {"sha256": digest, "source": item["source"], "format": fmt, **details}
        (extracted / f'{item["id"]}.json').write_text(json.dumps(sidecar, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        documents.append({"lang": "kk", "load": None, **item, "format": fmt, **({"pages": details["pages"]} if "pages" in details else {})})
        print(f'{item["id"]}: {fmt}, pages={details.get("pages", 0)}, worksheets={len(details.get("worksheets", []))}')
    args.manifest_out.parent.mkdir(parents=True, exist_ok=True)
    args.manifest_out.write_text(json.dumps({"subjects": SUBJECTS, "documents": documents}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
