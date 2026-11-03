"""Conservative, page-attributed contract extraction. Unknown values stay empty."""
import hashlib
import json
import re
from datetime import date
from app.services.contract_services import extract_services, signature_available, with_default_services
from app.services.contract_discovery import fuzzy_overlap, same_person
from app.core.encryption import decrypt, encrypt

VERSION = 1
# Версия правил чтения: при росте сохранённые профили перечитываются из PDF.
EXTRACTOR = 6
COMPANY_EMAIL_DOMAINS = ('teenteched', 'tinteched')
FIELDS = ('student_name', 'customer_name', 'customer_id', 'student_id_number', 'customer_email',
          'executor_name', 'executor_representative', 'executor_basis', 'executor_requisites',
          'contract_number', 'contract_date', 'city')
MONTHS = dict(zip(('января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'), range(1,13)))
SERVICE_TERMS = {'portfolio': r'портфолио', 'ielts': r'\bIELTS\b', 'profile': r'анамнез|оценк\w*\s+(?:академическ\w*\s+)?профил|анализ\w*\s+профил'}


def clean(value):
    return re.sub(r'\s+', ' ', value.replace('\u00a0', ' ')).strip(' ,;:')


def _name(value):
    value = clean(value).strip(' /_')
    words = value.split()
    if not 2 <= len(words) <= 5 or any(not any(c.isalpha() for c in w) for w in words): return None
    if any(w.casefold().strip('.,') in {'и','иин','номер','реквизиты','заказчик','абитуриент','гражданкой','республики','действующей','физическое','физическим','лицо','лицом','услуги'} for w in words): return None
    if any(not re.fullmatch(r"[^\W\d_][^\W\d_.'’-]*", w, re.UNICODE) for w in words): return None
    return value


def cached_profile(link):
    value = getattr(link, 'profile_encrypted', None)
    if not value: return None
    try:
        profile = json.loads(decrypt(value))
        return with_default_services(profile) if profile.get('parser_version') == VERSION else None
    except Exception:
        return None


def services_summary(profile):
    return [{'id': x['id'], 'category': x.get('category') or 'other', 'name': x.get('name') or ''}
            for x in (profile or {}).get('services', []) if x.get('id')]


def store_profile(link, profile):
    profile = with_default_services(profile)
    link.profile_encrypted = encrypt(json.dumps(profile, ensure_ascii=False))
    if hasattr(link, 'services_summary'):
        link.services_summary = services_summary(profile)
    # У загруженных вручную договоров номера TrustMe нет — берём номер из текста.
    if not getattr(link, 'number', None) and (profile or {}).get('fields', {}).get('contract_number'):
        link.number = profile['fields']['contract_number'][:200]


def extract_profile(pages, info, content):
    fields, sources, conflicts = {}, {}, {}
    candidates = {}
    normalized = [(p['page'], clean(p['text'])) for p in pages]
    ocr_pages = {p['page'] for p in pages if p.get('ocr')}
    def add(key, value, page, excerpt='', kind='pdf'):
        value = clean(str(value))
        if not value or '[' in value or len(value) > (1500 if key == 'executor_requisites' else 500): return
        if key.endswith('_name') and key != 'executor_name':
            value = _name(value)
            if not value: return
        entry = {'value': value, 'page': page, 'kind': 'ocr' if kind == 'pdf' and page in ocr_pages else kind, 'excerpt': clean(excerpt)[:220]}
        known = candidates.setdefault(key, [])
        if key.endswith('_name') and key != 'executor_name':
            # Одно ФИО в разных падежах — не конфликт; оставляем более короткую форму.
            for i, other in enumerate(known):
                if same_person(other['value'], value) and len(value.split()) == len(other['value'].split()):
                    if len(value) < len(other['value']) and (kind == 'pdf' or other['kind'] != 'pdf'):
                        known[i] = entry
                    return
        if value.casefold() not in {x['value'].casefold() for x in known}:
            known.append(entry)
    first = normalized[0][1] if normalized else ''
    def match(key, pattern, text, page=1, transform=None):
        for m in re.finditer(pattern, text, re.I):
            if key == 'student_name' and re.search(r'(?:получает|получит)\s*$', text[max(0, m.start()-40):m.start()], re.I):
                continue
            value = m.group(1)
            if transform: value = transform(value)
            if value: add(key, value, page, m.group(0))
    match('contract_number', r'(?:ДОГОВОР|ШАРТ|CONTRACT|AGREEMENT)\s*№\s*([^\s,;]{1,70})', first[:700])
    city = re.search(r'\bг\.\s*([^\s,«"\d]{2,80})', first[:500], re.I)
    if city: add('city', city.group(1), 1, city.group(0))
    for m in re.finditer(r'[«"“]?(\d{1,2})[»"”]?\s+(\w+)\s+(20\d{2})', first[:500]):
        month = MONTHS.get(m.group(2).lower())
        if month:
            try: add('contract_date', date(int(m.group(3)), month, int(m.group(1))).isoformat(), 1, m.group(0))
            except ValueError: pass
    def numeric_date(value):
        parts = re.split(r'[./-]', value)
        try:
            return (date(*map(int, parts)) if len(parts[0]) == 4 else date(int(parts[2]), int(parts[1]), int(parts[0]))).isoformat()
        except ValueError:
            return None
    match('contract_date', r'\b(\d{1,2}[./]\d{1,2}[./]20\d{2}|20\d{2}-\d{2}-\d{2})\b', first[:500], transform=numeric_date)
    kazakh_months = dict(zip(('қаңтар','ақпан','наурыз','сәуір','мамыр','маусым','шілде','тамыз','қыркүйек','қазан','қараша','желтоқсан'), range(1,13)))
    for m in re.finditer(r'(20\d{2})\s*(?:жылғы|жыл|ж\.)?\s*[«\"“]?(\d{1,2})[»\"”]?\s*(\w+)', first[:500], re.I):
        month = kazakh_months.get(m.group(3).lower())
        if month:
            try: add('contract_date', date(int(m.group(1)), month, int(m.group(2))).isoformat(), 1, m.group(0))
            except ValueError: pass
    match('executor_name', r'(?:Товариществ\w*\s+с\s+ограниченной\s+ответственностью|ТОО|TOO)\s*[«"]([^»"]{2,100})[»"]', first[:1800], transform=lambda s: 'ТОО «'+s+'»')
    match('executor_representative', r'в\s+лице\s+(.{3,200}?),?\s+действующ', first[:2400])
    match('executor_basis', r'на\s+основании\s+(.{3,100}?)(?:,|\s+с\s+одной\s+стороны)', first[:2400])
    intro = (re.search(r'с\s+одной\s+стороны,?\s+и\s+(.{3,200}?)\s*,?\s*(?:ИИН|(?:индивидуальный\s+)?идентификационный\s+номер(?:\s*\(ИИН\))?)\s*:?\s*((?:\d\s*){9,16})', first[:2600], re.I)
             or re.search(r'с\s+одной\s+стороны,?\s+и\s+(.{3,200}?)\s*\(\s*(?:ИИН\s*:?\s*)?((?:\d\s*){12})\s*\)', first[:2600], re.I)
             or re.search(r'с\s+одной\s+стороны,?\s+и\s+(.{3,200}?)\s*\(\s*удостоверени\w*\s+личности()', first[:2600], re.I)
             # Старые шаблоны: «Гражданин Республики Казахстан ФИО, именуемый в дальнейшем «Заказчик»» без ИИН.
             or re.search(r'с\s+одной\s+стороны\s*,?\s+и\s+(.{3,260}?)\s*[,_]?\s*именуем\w*\s*(?:\(\s*-?\s*ая\s*\))?\s+в\s+дальнейшем\s+[«"]\s*Заказчик()', first[:2600], re.I))
    if intro:
        name = re.sub(r'^граждан\w*\s*(?:\(\s*ка\s*\))?\s+(?:(?:Республики(?:\s+(?:Казахстан|Кыргызстан|Кыргыстан|Германия|Узбекистан|Таджикистан|Беларусь))?|Российской\s+Федерации|РК)\s+)?', '', intro.group(1), flags=re.I)
        # «и (законный представитель) (в случае несовершеннолетия обучающегося) ФИО (Фамилия, имя, отчество…»
        name = re.sub(r'^и\s*\(законный\s+представитель\)\s*\([^)]*\)\s*', '', name, flags=re.I)
        name = re.sub(r'\s*\(Фамилия.*$', '', name, flags=re.I).strip(' _')
        add('customer_name', name, 1, intro.group(0))
        ident = re.sub(r'\s+', '', intro.group(2))
        if 9 <= len(ident) <= 16: add('customer_id', ident, 1, intro.group(0))
    ward = re.search(r'законного\s+представителя\s+(?:несовершеннолетн\w+\s+)?абитуриента\s*(?:[—–-]\s*)?(?:граждан\w+\s+(?:Республики(?:\s+Казахстан)?|РК|Российской\s+Федерации)\s+)?(.{3,150}?)\s*(?:,\s*ИИН\s*:?\s*((?:\d\s*){12})|\(\s*(?:ИИН\s*:?\s*)?((?:\d\s*){12})\s*\)|\(далее)', first[:3200], re.I)
    if ward:
        add('student_name', ward.group(1), 1, ward.group(0))
        ident = re.sub(r'\s+', '', ward.group(2) or ward.group(3) or '')
        if len(ident) == 12: add('student_id_number', ident, 1, ward.group(0))
    interest = re.search(r'в\s+интересах\s+(?:несовершеннолетн\w+\s+)?(?:(?:абитуриента|участника|обучающегося|учащегося)\s*[—–-]?\s*)?(.{3,150}?)\s*,\s*(?:(?:индивидуальный\s+)?идентификационный\s+номер\s*\(ИИН\)\s*|ИИН\s*:?\s*)((?:\d\s*){12})', first[:4500], re.I)
    if interest:
        add('student_name', interest.group(1), 1, interest.group(0))
        add('student_id_number', re.sub(r'\s+', '', interest.group(2)), 1, interest.group(0))
    participant = re.search(r'законного\s+представителя\s+несовершеннолетн\w+\s+(?:(?:абитуриента|участника)\s*[—–-]?\s*)?(.{3,150}?)\s*,?\s+ИИН\s*:?\s*((?:\d\s*){12})', first[:4500], re.I)
    if participant:
        add('student_name', participant.group(1), 1, participant.group(0))
        add('student_id_number', re.sub(r'\s+', '', participant.group(2)), 1, participant.group(0))
    for page, text in normalized:
        match('customer_name', r'Подписант\s*/\s*законный\s+представитель\s*:\s*(.{5,150}?)(?=\s+Абитуриент\s*:|\s+ИИН|\s+Номер\s+телефона|$)', text, page)
        match('student_name', r'(?:Ф\.?\s*И\.?\s*О\.?\s+(?:\(\s*)?(?:абитуриента|учащегося|обучающегося|студента|участника|стажирующегося)(?:\s*\))?|Абитуриент|Учащийся|Обучающийся|Студент|Участник|Стажирующийся)\s*:\s*(.{5,150}?)(?=\.\s|\s*\(\s*\d|\s+\d+\.\d|\s+ИИН|\s+(?:Номер\s+)?телефон(?:а)?\b|\s+Адрес\s*:|\s+E-mail|$)', text, page)
        match('customer_id', r'ИИН\s+(?:подписанта|заказчика)\s*:\s*(\d{12})\b', text, page)
        match('student_id_number', r'ИИН\s+(?:абитуриента|участника|учащегося)\s*:\s*(\d{12})\b', text, page)
        match('customer_email', r'E[- ]?mail\s+(?:подписанта(?:/абитуриента)?|заказчика)\s*:\s*([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})', text, page)
        match('executor_requisites', r'Реквизиты\s+Исполнителя\s*:\s*(.{5,1500}?)(?=Реквизиты\s+Заказчика\s*:|$)', text, page)
        for section in re.finditer(r'ЗАКАЗЧИК\s*(?:/\s*АБИТУРИЕНТ\s*)?Ф\.\s*И\.\s*О\.\s*:\s*(.{5,150}?)\s+(?:ИИН|идентификационный\s+номер)\s*:\s*(\d{9,16})', text, re.I):
            add('customer_name', section.group(1), page, section.group(0))
            add('customer_id', section.group(2), page, section.group(0))
            tail = text[section.end():section.end()+350]
            match('customer_email', r'E[- ]?mail\s*:\s*([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})', tail, page)
    # Only an explicit self-customer clause permits reusing the customer's ID/name.
    is_self = bool(re.search(r'одновременно\s+в\s+качестве\s+[«\"]?Абитуриента|Заказчика\s+и\s+Абитуриента|одновременно\s+являющ\w*\s+[«"]?Абитуриентом|[«"]Заказчик[»"]\s+и\s+[«"]Абитуриент[»"]', first[:2600], re.I))
    if is_self:
        for source, target in (('customer_name','student_name'), ('customer_id','student_id_number')):
            for candidate in candidates.get(source, []):
                add(target, candidate['value'], candidate['page'], 'Заказчик одновременно является абитуриентом')
    # Requisites of the non-company party are hints, never company director data.
    for party in info.get('doc_parties') or []:
        if party.get('isCreator', party.get('is_creator')): continue
        try: values = json.loads(party.get('requisites') or '[]')
        except (TypeError, ValueError): continue
        if not isinstance(values, list): continue
        values = {str(x.get('key','')).casefold(): x.get('value') for x in values if isinstance(x,dict)}
        # PDF wording is authoritative; metadata fills only missing fields.
        for key, aliases in {'customer_name': ('fio','name'), 'customer_id': ('iin','tinbin'), 'customer_email': ('email','e-mail')}.items():
            if key not in candidates:
                value = next((values[a] for a in aliases if values.get(a)), None)
                if value: add(key, value, None, 'Реквизиты подписанта TrustMe', 'trustme')
    # В таблице реквизитов колонки склеиваются: блок заказчика — не реквизиты исполнителя.
    requisites = [c for c in candidates.pop('executor_requisites', []) if 'заказчик' not in c['value'].casefold()]
    if requisites: candidates['executor_requisites'] = requisites
    if 'customer_email' not in candidates:
        # Почта без подписи «E-mail заказчика»: берём, только если чужой адрес в договоре один.
        found = {}
        for page, text in normalized:
            for m in re.finditer(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}', text):
                if not any(d in m.group().casefold() for d in COMPANY_EMAIL_DOMAINS):
                    found.setdefault(m.group().casefold(), (page, text[max(0, m.start() - 60):m.end()]))
        if len(found) == 1:
            email, (page, excerpt) = found.popitem()
            add('customer_email', email, page, excerpt)
    for key, values in candidates.items():
        if len(values) > 1 and key.endswith('_name') and key != 'executor_name':
            # Один человек, в тексте договора написан дважды с опечаткой: оставляем первое написание.
            first_name = values[0]['value']
            if all(len(v['value'].split()) == len(first_name.split()) == fuzzy_overlap(first_name, v['value']) for v in values[1:]):
                values = values[:1]
        if len(values) == 1:
            fields[key] = values[0]['value']; sources[key] = {k:v for k,v in values[0].items() if k!='value'}
        else: conflicts[key] = values
    hints = {}
    for template, pattern in SERVICE_TERMS.items():
        matches = [(page, re.search(pattern, text, re.I)) for page,text in normalized]
        found = [(page,m) for page,m in matches if m]
        if found:
            page,m = found[0]
            hints[template] = {'page': page, 'reference': f'Договор, стр. {page}', 'confirmed_price': None}
            # A price is usable only when explicitly attached to the named service.
            prices = []
            for p,text in normalized:
                for price in re.finditer(r'Стоимость\s+(?:услуг\w*\s+|подготовки\s+)?(?:'+pattern+r').{0,60}?(?:составляет|равна|:)\s*([\d ][\d ]{1,14}(?:[,.]\d{1,2})?)\s*(тенге|KZT|рублей|RUB|USD|EUR)\b', text, re.I):
                    amount = price.group(1).replace(' ','').replace(',','.')
                    currency = {'тенге':'KZT','рублей':'RUB'}.get(price.group(2).lower(), price.group(2).upper())
                    prices.append({'amount':amount,'currency':currency,'page':p})
            unique = {(p['amount'],p['currency']) for p in prices}
            if len(unique)==1: hints[template]['confirmed_price'] = prices[0]
    required = ('student_name','customer_name','executor_name','executor_representative','executor_basis','contract_number','contract_date','city')
    return with_default_services({'parser_version':VERSION, 'extractor':EXTRACTOR, 'fingerprint':hashlib.sha256(content).hexdigest(), 'fields':fields,
            'sources':sources, 'conflicts':conflicts, 'service_hints':hints,
            'service_policy':3, 'services':extract_services(pages, hashlib.sha256(content).hexdigest()),
            'source_pages':[{'page':p['page'],'text':clean(p['text'])} for p in pages],
            'company_signature_available':signature_available(pages, fields),
            'company_signature_identity':{key:fields.get(key) for key in ('executor_name','executor_representative')},
            'missing':[key for key in required if not fields.get(key)], 'reviewed':False})
