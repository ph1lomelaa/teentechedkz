"""Formal, un-signed act PDFs. All variable text is escaped before ReportLab."""
from io import BytesIO
from pathlib import Path
from threading import Lock
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether

from app.schemas.service_act import ActInput

_font_lock = Lock()


def render_act(data: ActInput, *, draft: bool = False) -> bytes:
    with _font_lock:
        if "ActSans" not in pdfmetrics.getRegisteredFontNames():
            fonts = Path(__file__).resolve().parents[1] / "assets" / "fonts"
            pdfmetrics.registerFont(TTFont("ActSans", str(fonts / "NotoSans-Regular.ttf")))
            pdfmetrics.registerFont(TTFont("ActSansBold", str(fonts / "NotoSans-Bold.ttf")))
            pdfmetrics.registerFontFamily("ActSans", normal="ActSans", bold="ActSansBold")
    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, rightMargin=20*mm, leftMargin=20*mm,
                            topMargin=18*mm, bottomMargin=19*mm,
                            title=f"{data.student_name} - Акт оказанных услуг", author=data.executor_name)
    styles = getSampleStyleSheet()
    body = ParagraphStyle("ActBody", fontName="ActSans", fontSize=10, leading=15, spaceAfter=8, alignment=TA_JUSTIFY)
    small = ParagraphStyle("ActSmall", parent=body, fontSize=8.5, leading=12, alignment=0)
    title = ParagraphStyle("ActTitle", parent=body, fontName="ActSansBold", fontSize=13, leading=18, alignment=TA_CENTER, spaceAfter=12)
    def p(value, style=body):
        return Paragraph(escape(str(value)).replace("\n", "<br/>"), style)
    fmt = lambda d: d.strftime("%d.%m.%Y")
    story = []
    if draft:
        story.append(p("ПРЕДПРОСМОТР - НЕ СОХРАНЁННЫЙ АКТ", title))
    story += [p("Акт оказанных услуг", title), p(f"к договору №{data.contract_number} от {fmt(data.contract_date)}", title)]
    meta = Table([[p(f"г. {data.city}", small), p(fmt(data.act_date), small)]], colWidths=[125*mm, 45*mm])
    meta.setStyle(TableStyle([("VALIGN", (0,0),(-1,-1),"TOP"), ("LEFTPADDING",(0,0),(-1,-1),0)]))
    story += [meta, Spacer(1, 5*mm)]
    customer = data.customer_name + (f", ИИН/идентификатор {data.customer_id}" if data.customer_id else "")
    student = data.student_name + (f", ИИН/идентификатор {data.student_id_number}" if data.student_id_number else "")
    story += [p(f"{data.executor_name}, именуемое в дальнейшем «Исполнитель», в лице {data.executor_representative}, действующего на основании {data.executor_basis}, и {customer}, именуемый(ая) в дальнейшем «Заказчик», составили настоящий акт к указанному договору о нижеследующем."),
              p(f"Получатель услуг (студент): {student}."),
              p(f"1. В период с {fmt(data.period_start)} по {fmt(data.period_end)} Исполнитель оказал следующие услуги:")]
    rows = [[p("№", small), p("Услуги и фактический результат", small), p("Объём", small)]]
    widths = [8*mm, 132*mm, 30*mm]
    if data.include_amount:
        rows[0] += [p(f"Стоимость, {data.currency}", small)]
        widths = [8*mm, 100*mm, 27*mm, 35*mm]
    for i, line in enumerate(data.lines, 1):
        desc = f"{line.name}\n{line.result}\nОснование: {line.contract_source}."
        row = [p(i, small), p(desc, small), p(f"{line.quantity.normalize():f} {line.unit}", small)]
        if data.include_amount:
            row.append(p(f"{line.amount:,.2f}".replace(",", " "), small))
        rows.append(row)
    table = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"), ("GRID",(0,0),(-1,-1),0.5,colors.HexColor("#b9b9b9")),
        ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#f1f1f1")), ("LEFTPADDING",(0,0),(-1,-1),6),
        ("RIGHTPADDING",(0,0),(-1,-1),6),("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7)]))
    story += [table, Spacer(1, 4*mm)]
    if data.calls_count is not None:
        story.append(p(f"Количество проведённых звонков/встреч за указанный период: {data.calls_count}."))
    if data.include_amount:
        story.append(p(f"2. Общая стоимость перечисленных услуг: {data.total:,.2f} {data.currency}.".replace(",", " ")))
    else:
        story.append(p("2. Стоимость услуг регулируется условиями договора. Настоящий акт не изменяет порядок расчётов."))
    story.append(p("3. Настоящий акт подтверждает исполнение обязательств в части перечисленных услуг за указанный период. Подписанием акта Заказчик подтверждает их получение в указанном объёме."))
    if data.template == "final":
        story.append(p("4. Стороны подтверждают полное исполнение обязательств Исполнителя по указанному договору."))
    else:
        story.append(p("4. Подтверждение по настоящему акту относится к перечисленным услугам и не распространяется на иные обязательства по договору."))
    signatures = Table([[p("Исполнитель", small), p("Заказчик", small)],
                        [p(f"{data.executor_name}\n{data.executor_representative}\n{data.executor_requisites}", small), p(customer, small)],
                        [p("____________________ / подпись", small), p("____________________ / подпись", small)]], colWidths=[85*mm,85*mm])
    signatures.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),12),("TOPPADDING",(0,0),(-1,-1),8)]))
    story.append(KeepTogether([Spacer(1, 5*mm), signatures]))
    def footer(canvas, document):
        canvas.saveState(); canvas.setFont("ActSans", 8)
        canvas.setFillColor(colors.HexColor("#666666"))
        canvas.drawString(20*mm, 10*mm, "Предпросмотр" if draft else "Акт оказанных услуг")
        canvas.drawRightString(190*mm, 10*mm, f"Страница {document.page}")
        canvas.restoreState()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return out.getvalue()
