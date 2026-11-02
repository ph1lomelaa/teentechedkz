"""Contract-based service acts using the provided company layout."""
import re
from io import BytesIO
from pathlib import Path
from threading import Lock
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from app.schemas.service_act import ActInput
from app.services.act_marks import CompanyInkMark

_font_lock = Lock()
_MONTHS = ('января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря')


def _date(value):
    return f'«{value.day:02d}» {_MONTHS[value.month-1]} {value.year} года'


def _form(n, words):
    return words[2] if 11 <= n % 100 <= 14 else words[0] if n % 10 == 1 else words[1] if 2 <= n % 10 <= 4 else words[2]


def amount_words(value):
    number = int(value)
    if number == 0: words = ['ноль']
    else:
        words = []
        scales = [('', '', ''), ('тысяча','тысячи','тысяч'), ('миллион','миллиона','миллионов'), ('миллиард','миллиарда','миллиардов'), ('триллион','триллиона','триллионов'), ('квадриллион','квадриллиона','квадриллионов')]
        units = ('','один','два','три','четыре','пять','шесть','семь','восемь','девять')
        teens = ('десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать')
        tens = ('','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто')
        hundreds = ('','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот')
        groups = []; level = 0
        while number:
            n = number % 1000; number //= 1000
            if n:
                part = [hundreds[n//100]]
                if 10 <= n % 100 < 20: part.append(teens[n%100-10])
                else:
                    part.append(tens[n%100//10])
                    part.append(('одна' if n%10==1 else 'две') if level==1 and n%10 in (1,2) else units[n%10])
                if level: part.append(_form(n, scales[level]))
                groups.insert(0, ' '.join(x for x in part if x))
            level += 1
        words = groups
    cents = int((value - int(value)) * 100)
    return ' '.join(words) + (f' {cents:02d}/100' if cents else '')


def render_act(data: ActInput, *, draft: bool = False) -> bytes:
    with _font_lock:
        if 'ActSans' not in pdfmetrics.getRegisteredFontNames():
            fonts = Path(__file__).resolve().parents[1] / 'assets' / 'fonts'
            pdfmetrics.registerFont(TTFont('ActSans', str(fonts / 'NotoSans-Regular.ttf')))
            pdfmetrics.registerFont(TTFont('ActSansBold', str(fonts / 'NotoSans-Bold.ttf')))
            pdfmetrics.registerFontFamily('ActSans', normal='ActSans', bold='ActSansBold')
    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, rightMargin=20*mm, leftMargin=20*mm,
        topMargin=18*mm, bottomMargin=18*mm, title=f'{data.student_name} - Акт оказанных услуг', author=data.executor_name)
    body = ParagraphStyle('ActBody', fontName='ActSans', fontSize=10, leading=14.4, spaceAfter=8, alignment=TA_JUSTIFY)
    small = ParagraphStyle('ActSmall', parent=body, fontSize=9, leading=12.5, alignment=0)
    title = ParagraphStyle('ActTitle', parent=body, fontName='ActSansBold', fontSize=12, leading=17, alignment=TA_CENTER, spaceAfter=12)
    bullet = ParagraphStyle('ActBullet', parent=body, leftIndent=10, firstLineIndent=-8, spaceAfter=3)
    def p(value, style=body):
        return Paragraph(escape(str(value)).replace('\n','<br/>'), style)
    story = []
    if draft: story.append(p('ПРЕДПРОСМОТР - НЕ СОХРАНЁННЫЙ АКТ', small))
    story.append(p(f'Акт оказанных услуг к Договору об оказании услуг №{data.contract_number}', title))
    meta = Table([[p(f'г. {data.city}',small), p(_date(data.act_date),ParagraphStyle('ActDate',parent=small,alignment=TA_RIGHT))]],colWidths=[73*mm,97*mm])
    meta.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
    story += [meta, Spacer(1,4*mm)]
    customer = data.customer_name + (f', ИИН / идентификатор {data.customer_id}' if data.customer_id else '')
    student = data.student_name + (f', ИИН / идентификатор {data.student_id_number}' if data.student_id_number else '')
    beneficiary = 'одновременно являющийся(аяся) получателем услуг' if data.customer_name == data.student_name else f'выступающий(ая) в интересах абитуриента {student}'
    story.append(p(f'{data.executor_name}, именуемое в дальнейшем «Исполнитель», в лице {data.executor_representative}, действующего на основании {data.executor_basis}, с одной стороны, и {customer}, {beneficiary}, именуемый(ая) в дальнейшем «Заказчик», с другой стороны, далее совместно именуемые «Стороны», составили настоящий Акт оказанных услуг к Договору №{data.contract_number} от {_date(data.contract_date)} (далее - «Договор») о нижеследующем:'))
    if data.customer_name == data.student_name:
        story.append(p(f'Абитуриент: {student}.',small))
    if draft and not data.verified:
        story.append(p('1. Перечень выбранных услуг для проверки. Фактический период и выполнение работ подлежат подтверждению перед созданием акта.'))
    else:
        story.append(p(f'1. В период с {_date(data.period_start)} по {_date(data.period_end)} Исполнитель оказал Заказчику предусмотренные Договором услуги в указанном ниже объёме:'))
    for line in data.lines:
        story.append(p(line.name, ParagraphStyle('ServiceTitle',parent=body,fontName='ActSansBold',spaceAfter=4)))
        for result in line.result.splitlines():
            if result.strip(): story.append(p('- '+result.strip().lstrip('- '),bullet))
        if line.quantity != 1 or line.unit not in ('этап','услуга'):
            story.append(p(f'Объём: {line.quantity.normalize():f} {line.unit}.',small))
    for outcome in data.verified_outcomes:
        story.append(p(outcome, small))
    if data.previous_act_references:
        story.append(p('Ранее оформленные услуги: '+ '; '.join(data.previous_act_references)+'. Повторно в стоимость настоящего акта не включены.',small))
    if data.calls_count is not None:
        story.append(p(f'Проведено звонков / встреч за указанный период: {data.calls_count}.',small))
    story.append(Spacer(1,3*mm))
    if data.include_amount:
        currency = {'KZT':'тенге','RUB':_form(int(data.total),('рубль','рубля','рублей')),'USD':'долларов США','EUR':'евро'}[data.currency]
        numeric = (f'{data.total:,.0f}' if data.total == int(data.total) else f'{data.total:,.2f}').replace(',',' ')
        story.append(p(f'2. Общая стоимость оказанных услуг составила {numeric} ({amount_words(data.total)}) {currency} в соответствии с условиями Договора.'))
    else:
        story.append(p('2. Стоимость перечисленных услуг и порядок расчётов определяются условиями Договора. Настоящий Акт не изменяет согласованную стоимость услуг.'))
    story.append(p('3. Подписанием настоящего Акта Заказчик подтверждает, что перечисленные услуги оказаны в указанном объёме, качественно и в срок. Претензий по объёму, качеству и срокам оказания перечисленных услуг к Исполнителю не имеет.'))
    story.append(p('4. Настоящий Акт составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному для каждой из Сторон. Акт является неотъемлемой частью Договора и подтверждает факт исполнения обязательств Исполнителем в части перечисленных услуг.'))
    if data.template in ('final', 'admission'):
        story.append(p('Стороны отдельно подтверждают полное исполнение обязательств Исполнителя по Договору.'))
    signature_assets = Path(__file__).resolve().parents[1] / 'assets' / 'acts'
    company_mark = p('____________________\n(подпись) М.П.',small)
    if data.company_signature:
        company_mark = CompanyInkMark(signature_assets)
    representative = re.sub(r'^генерального директора\b', 'Генеральный директор',data.executor_representative,flags=re.I)
    representative = re.sub(r'^директора\b','Директор',representative,flags=re.I)
    signatures = Table([[p('Подписи сторон:',body),p('',small)],
        [p(f'Исполнитель:\n{data.executor_name}\n{representative}',small),p(f'Заказчик:\n{data.customer_name}\nАбитуриент: {data.student_name}'+(f'\nE-mail: {data.customer_email}' if data.customer_email else ''),small)],
        [company_mark,p('____________________\n(подпись)',small)]],colWidths=[85*mm,85*mm])
    signatures.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),5),('BOX',(0,1),(0,-1),0.6,colors.black),('BOX',(1,1),(1,-1),0.6,colors.black),('LEFTPADDING',(0,1),(-1,-1),7)]))
    story.append(KeepTogether([Spacer(1,4*mm),signatures]))
    def footer(canvas, document):
        canvas.saveState();canvas.setFont('ActSans',8);canvas.setFillColor(colors.HexColor('#777777'))
        canvas.drawString(20*mm,9*mm,'Предпросмотр' if draft else 'Акт оказанных услуг')
        canvas.drawRightString(190*mm,9*mm,f'Страница {document.page}');canvas.restoreState()
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    return out.getvalue()
