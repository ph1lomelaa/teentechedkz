"""Тип опыта активности — ось «чего не хватает» в портфолио.

«Направление» в каталоге — это предмет (IT, медицина…), а для портфолио важно,
какой это опыт: олимпиада, исследование, стажировка. В базе тип хранится
свободным текстом из Excel («Конкурс / олимпиада», «Стажировка»…), поэтому
сводим его к короткому постоянному списку по ключевым словам.
"""

EXPERIENCE_TYPES: list[tuple[str, str]] = [
    ('competitions', 'Олимпиады и конкурсы'),
    ('research', 'Исследования и проекты'),
    ('programs', 'Программы и летние школы'),
    ('courses', 'Курсы'),
    ('internships', 'Стажировки'),
    ('social', 'Волонтёрство и социальные проекты'),
    ('other', 'Другое'),
]

# Порядок важен: «Исследовательский конкурс» — это конкурс, «Курс-интенсив в
# летней школе» — программа. Первое совпадение побеждает.
_RULES: list[tuple[str, tuple[str, ...]]] = [
    ('competitions', ('олимпиад', 'конкурс', 'хакатон', 'чемпионат', 'турнир', 'olymp', 'competition', 'contest', 'hackathon')),
    ('internships', ('стажир', 'intern', 'практик')),
    ('social', ('волонт', 'социал', 'благотвор', 'volunt', 'community')),
    ('research', ('исслед', 'проект', 'research', 'project', 'научн')),
    ('programs', ('школ', 'академ', 'программ', 'лагер', 'интенсив', 'school', 'academy', 'program', 'camp', 'summer')),
    ('courses', ('курс', 'course', 'mooc', 'онлайн-обуч')),
]


def experience_type(kind: str | None) -> str:
    value = (kind or '').lower()
    for key, words in _RULES:
        if any(word in value for word in words):
            return key
    return 'other'


EXPERIENCE_LABEL = dict(EXPERIENCE_TYPES)
