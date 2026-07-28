from app.core.import_notion_knowledge_pages import TARGETS


def test_current_knowledge_targets_are_unique_and_complete():
    page_ids = [item["page_id"] for item in TARGETS]

    assert len(page_ids) == 13
    assert len(set(page_ids)) == len(page_ids)
    assert {item["category"] for item in TARGETS} == {
        "Стипендии",
        "Мифы и разборы",
        "Регламенты",
        "Пакеты и выплаты",
        "Шаблоны",
    }
    assert all(len(page_id.replace("-", "")) == 32 for page_id in page_ids)
