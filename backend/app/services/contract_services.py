"""Verbatim contract activities for the act constructor; no authored work claims."""
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re

CATEGORIES = {
    'profile': ('Оценка профиля', r'Оценка\s+профиля\s+студента'),
    'career': ('Профориентация', r'Профориентация'),
    'csca': ('Подготовка к CSCA', r'Подготовка\s+к\s+CSCA'),
    'entrance': ('Подготовка к вступительным', r'Подготовка\s+к\s+вступительн\w*\s+(?:экзамен\w*|испытани\w*)'),
    'sat': ('Подготовка к SAT', r'Подготовка\s+к\s+SAT'),
    'portfolio': ('Улучшение академического портфолио', r'Улучшение\s+академического\s+портфолио'),
    'shortlist': ('Подбор университетов и программ', r'Шорт-лист\s+(?:образовательных|университетов)'),
    'essays': ('Мотивационные письма и эссе', r'Эссе\s*:|General\s+till\s+1000'),
    'recommendations': ('Рекомендательные письма', r'Рекомендательные\s+письма\s*/\s*Academic'),
    'resume': ('Резюме', r'Резюме\s*/\s*Personal'),
    'applications': ('Подачи в университеты', r'Регистрационны\s*е?\s+формы'),
    'interview': ('Подготовка к интервью', r'Интервью\s*/\s*General'),
    'offer': ('Коммуникация до оффера', r'Коммуникация\s+с\s+ВУЗами\s*:\s*ведение(?!\s*переговоров\s+ПОСЛЕ)'),
    'admission': ('Сопровождение после оффера', r'Коммуникация\s+с\s+ВУЗами\s*:\s*введени\s*е\s+переговоров\s+ПОСЛЕ'),
    'housing': ('Сопровождение размещения', r'Помощь\s+в\s+получении\s+места\s+в\s+резиденции'),
}


def normalized(value):
    return re.sub(r'\s+', ' ', value or '').strip()


_NUM = r'(?:\d+|один|одну|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)'


def strip_quantities(value):
    """Описание услуги для акта без количества консультаций и часов работы."""
    value = re.sub(r'\s*\(\s*\d+\s*ВУЗ\w*\s*\*\s*до\s*\d+\s*email\s*\)', '', value, flags=re.I)
    value = re.sub(rf'\b{_NUM}\s*(?:\([^)]*\)\s*)?(?=консультац)', '', value, flags=re.I)
    value = re.sub(rf'\b{_NUM}\s*(?:\([^)]*\)\s*)?час\w*\s+работы\s+координатора', '', value, flags=re.I)
    value = re.sub(rf'\s*{_NUM}\s*(?:\([^)]*\)\s*)?раз\w*\s+в\s+неделю', '', value, flags=re.I)
    value = re.sub(r'[ \t]+([,;:.)])', r'\1', re.sub(r'([(])[ \t]+', r'\1', value))
    return join_broken_words(re.sub(r'[ \t]{2,}', ' ', value).strip())


# PDF рвёт слова: «исследовательск их», «конкурентоспосо бно го», «д о 3».
_TAILS = {'ых', 'ого', 'ые', 'ий', 'ый', 'ую', 'ая', 'ое', 'ами', 'ями', 'ах', 'ях', 'бно', 'го', 'ных', 'ные', 'ная', 'ной', 'ный'}
_STEM_END = set('кнчшщ')  # усечённые основы прилагательных: «исследовательск их»
_PAIRS = {'до', 'по', 'со', 'во', 'на', 'за', 'из', 'от', 'но'}
_ORPHANS = set('хыйьюм')


def join_broken_words(value):
    out = []
    for token in re.split(r'([ \t]+)', value or ''):
        word = token.casefold()
        prev = out[-2] if len(out) >= 2 and not out[-1].strip() else ''
        stem = (re.search(r'[а-яёА-ЯЁ]+$', prev) or [''])[0]
        if stem and re.fullmatch(r'[а-яё]+', word):
            glue = ((word in _TAILS or (word == 'их' and stem[-1:].casefold() in _STEM_END)) and len(stem) >= 4) \
                or (len(word) == 1 and word in _ORPHANS and len(stem) >= 4) \
                or (len(word) == 1 and len(stem) == 1 and (stem + word).casefold() in _PAIRS)
            if glue:
                out.pop()
                out[-1] += token
                continue
        out.append(token)
    return ''.join(out)


DEFAULT_SERVICES = json.loads((Path(__file__).resolve().parents[1] / 'data' / 'contract_service_defaults.json').read_text())


def with_default_services(profile):
    """Use this contract's descriptions first, then the approved shared catalog.

    Catalog descriptions have their own provenance and never inherit another
    student's prices, training duration, exam fees or other commercial terms.
    """
    if not profile or not profile.get('fingerprint'):
        return profile
    previous = {s['category']: s for s in profile.get('services', []) if s.get('source_kind') == 'standard'}
    services = [s for s in profile.get('services', []) if s.get('source_kind') != 'standard']
    for category, template in DEFAULT_SERVICES.items():
        own = [s for s in services if s.get('category') == category]
        # A heading alone supplies no description. Keep explicit staff quotes.
        if any(s.get('verbatim_manual') or len(normalized(s['text'])) > len(s['name']) + 15 for s in own):
            continue
        services = [s for s in services if s not in own]
        identity = own[0]['id'] if len(own) == 1 else previous[category]['id'] if category in previous else hashlib.sha256(f"{profile['fingerprint']}:standard:{category}".encode()).hexdigest()[:24]
        services.append({'id': identity, 'name': template['name'], 'category': category,
                         'text': strip_quantities(template['text']), 'source_kind': 'standard',
                         'page': template['source']['page'], 'reference': 'Стандартное описание из договоров',
                         'excerpt': template['source']['excerpt'], 'template_source': template['source']})
    profile['services'] = services
    profile['default_services_version'] = 2
    return profile


def extract_services(pages, fingerprint):
    """Every offered text remains an exact substring of the original page text."""
    parts, offsets = [], []
    offset = 0
    for page in pages:
        text = normalized(page['text'])
        offsets.append((offset, page['page']))
        parts.append(text)
        offset += len(text) + 1
    whole = ' '.join(parts)
    def page_at(position):
        return next((page for start, page in reversed(offsets) if start <= position), 1)
    boundaries = []
    # Restrict table headings to the appendix when it can be identified.
    appendix = re.search(r'Приложение\s*№\s*1\s+к\s+Договору', whole, re.I)
    start = appendix.start() if appendix else 0
    for category, (label, pattern) in CATEGORIES.items():
        for match in re.finditer(pattern, whole[start:], re.I):
            boundaries.append((start+match.start(), start+match.end(), category, label))
    boundaries.sort()
    items = []
    def add(text, category, page, reference, excerpt):
        text = normalized(text).strip(' ;.:-–—')
        if len(text) < 12 or text not in normalized(excerpt):
            return
        # Идентификатор — по исходному тексту: готовые акты ссылаются на него.
        identity = hashlib.sha256(f'{fingerprint}:{page}:{text}'.encode()).hexdigest()[:24]
        if any(item['id'] == identity for item in items): return
        items.append({'id':identity, 'name': CATEGORIES.get(category, ('Подготовка IELTS' if category == 'ielts' else 'Английский язык', ''))[0], 'category':category, 'text':strip_quantities(text), 'page':page,
                      'reference':reference, 'excerpt':normalized(excerpt)[:3500]})
    for index, (begin, heading_end, category, label) in enumerate(boundaries):
        end = boundaries[index+1][0] if index+1 < len(boundaries) else len(whole)
        section = whole[begin:end]
        section = re.split(r'Юридические\s+адреса\s+сторон|Реквизиты\s+Исполнителя|Все\s+визовые\s+документы|Бұл\s+құжат', section, flags=re.I)[0]
        # Preserve actual descriptions, excluding table workload/price columns.
        description = re.search(r'(?:(?:Анализ академического)|(?:На этом этапе)|(?:Мы (?:берём|сопровождаем))|(?:Что получает абитуриент)|(?:В услугу входит)|(?:Определение и выявление))', section, re.I)
        body = section[description.start():] if description and category != 'portfolio' else section[heading_end-begin:]
        body = re.sub(r'^\s*[\d\s,./()]+', '', body)
        # Specific list activities are preferable to generic "what you receive" headings.
        candidates = re.split(r';|(?<=[.!?])\s+(?=[А-ЯA-Z])|✅|(?:\s+|^)[1-9]\)', body)
        selected = []
        for candidate in candidates:
            candidate = re.sub(r'[^\w);.!?]+$', '', candidate.strip())
            candidate = re.sub(r'^В услугу входит\s*:\s*', '', candidate, flags=re.I)
            candidate = re.sub(r'^[^\wА-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІі]+', '', candidate)
            if not candidate or re.match(r'^(?:Что получает|В услугу входит|Описание услуги|Количество|Стоимость)', candidate, re.I): continue
            # Only describe work. Outcomes/guarantees and unrelated table fragments
            # are available in the source excerpt but not preselected as completed work.
            if re.search(r'гарант|обязуется|самостоятельно|не нес[её]т|заказчик обязан|Мы стремимся', candidate, re.I): continue
            if category == 'portfolio':
                candidate = candidate.split('.', 1)[0].strip()
                if re.search(r'\d{3,}',candidate): continue
            if len(candidate) >= 20 and candidate in section:
                selected.append(candidate)
        if category == 'portfolio':
            selected = [c for c in selected if re.search(r'участи|публикац|прохождени|развит|получени|формировани|подбор|комплект|знакомств|встреч', c, re.I)]
        if not selected:
            # A heading is still a supported activity; never invent its contents.
            selected = [whole[begin:heading_end]]
        # One contractual service row -> one act line and one price, even
        # when its description contains several activities.
        selected = list(dict.fromkeys(normalized(c).strip(' ;.:-–—') for c in selected[:15]))
        selected = [c for c in selected if c and c in section]
        selected = [c for c in (strip_quantities(c) for c in selected) if c]
        if not selected: continue
        page = page_at(begin)
        identity = hashlib.sha256(f'{fingerprint}:{begin}:{category}'.encode()).hexdigest()[:24]
        if category == 'essays' and description:
            heading = section[:description.start()]
            workload = re.search(r'\s+\d{1,3}\s+\d{1,3}\s+(?:\d{1,3}(?:\s\d{3})+|\d{4,9})\s*$',heading)
            if workload: label = heading[:workload.start()].strip()[:300]
        item = {'id':identity, 'name':label, 'category':category, 'text':'\n'.join(selected),
                'page':page, 'reference':f'Приложение №1, стр. {page}' if appendix else f'Договор, стр. {page}',
                'excerpt':normalized(section)[:3500]}
        header = section[:description.start()] if description else ''
        prices = list(re.finditer(r'(?<!\d)(\d{1,3})\s+(\d{1,3})\s+(\d{1,3}(?:\s\d{3})+|\d{4,9})(?!\d)', header))
        price = prices[0] if len(prices) == 1 else None
        numbered = set(re.findall(r'(?<!\d)([1-9])\)', section))
        complete = not numbered or len(selected) >= len(numbered)
        if price and complete and re.search(r'Стоимость\s+услуги,?\s+тенге',whole[:begin],re.I):
            item['confirmed_price'] = {'amount':price.group(3).replace(' ',''), 'currency':'KZT'}
        items.append(item)
    # Numbered language-training clauses can sit outside the appendix.
    for match in re.finditer(r'(?P<number>\d+\.\d+\.)\s*(?P<title>Подготовка\s+к\s+IELTS|Подготовка\s+по\s+английскому\s+языку)\s*:', whole, re.I):
        tail = whole[match.end():]
        boundary = re.search(r'\s\d+\.(?:\d+\.)?\s', tail)
        section = whole[match.start():match.end()+(boundary.start() if boundary else min(len(tail),2000))]
        activity = re.search(r'включает\s+(.+?)(?=\s+Курс направлен|$)', section, re.I)
        if activity:
            text = activity.group(1)
            location = whole.find(text,match.start())
            page = page_at(location)
            add(text, 'ielts' if 'IELTS' in match.group('title').upper() else 'english', page, f'Договор, п. {match.group("number")} стр. {page}', section)
    return items


def validate_service_lines(data, profile):
    """Called on the server before every new preview/generated PDF."""
    if not profile or not profile.get('services'):
        raise ValueError('Сначала прочитайте договор: для акта нужны подтверждённые пункты из документа')
    available = {item['id']:item for item in profile['services']}
    seen = set()
    for line in data.lines:
        item = available.get(line.contract_service_id)
        if not item or line.source_fingerprint != profile.get('fingerprint'):
            raise ValueError('Состав договора изменился или пункт не найден. Повторно выберите услуги из договора')
        if line.contract_service_id in seen:
            raise ValueError('Одна и та же работа не должна повторяться в акте')
        seen.add(line.contract_service_id)
        # Текст можно поправить вручную; дословная цитата остаётся в профиле договора по contract_service_id.
        if line.name != item['name'] or line.contract_source != item['reference']:
            raise ValueError('Услуга должна совпадать с выбранным пунктом договора')
        if line.quantity != 1 or line.unit != 'услуга':
            raise ValueError('Объём нельзя подставлять произвольно: выбранный пункт оформляется как одна услуга')
        if data.include_amount and data.contract_total is None:
            # Price allocation requires separate structured agreement support;
            # a free amount input is not sufficient provenance.
            price = item.get('confirmed_price')
            if not price or line.unit_price != Decimal(price['amount']) or data.currency != price['currency']:
                raise ValueError('Для стоимости этой работы нет однозначного основания в договоре')
    if data.calls_count is not None:
        raise ValueError('Общее количество встреч не подтверждает объём выбранной услуги')


def signature_available(pages, fields):
    text = ' '.join(page['text'] for page in pages)
    return bool(re.search(r'(?<!\d)210240033224(?!\d)', text) and re.search(r'Ж[ұу]ман', fields.get('executor_representative', ''), re.I))


def validate_company_signature(data, profile):
    if not data.company_signature:
        return
    if not profile or not profile.get('company_signature_available'):
        raise ValueError('Подпись и печать не подтверждены для исполнителя этого договора')
    for key in ('executor_name', 'executor_representative'):
        if normalized(getattr(data, key)) != normalized(profile.get('company_signature_identity', {}).get(key)):
            raise ValueError('Подпись должна соответствовать исполнителю и представителю в договоре')
