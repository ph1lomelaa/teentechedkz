"""Run from backend: python -m scripts.check_trustme --name 'Имя Фамилия'."""
import argparse
import asyncio
from pathlib import Path

from app.services.trustme import TrustMeClient, TrustMeError


async def check(args: argparse.Namespace) -> None:
    async with TrustMeClient.from_settings() as client:
        print("TrustMe: вход выполнен, компания определена")
        await client.refresh_session()
        print("TrustMe: обновление сессии выполнено")
        if args.name:
            result = await client.search(args.name)
            print(f"Кандидатов: {len(result.candidates)}; вариантов поиска: {len(result.queries)}; "
                  f"выдача ограничена: {result.truncated}")
        if args.download:
            content = await client.pdf(args.download)
            # Do not overwrite an existing file, especially a signed original.
            with Path(args.output).open("xb") as stream:
                stream.write(content)
            print(f"PDF сохранён: {len(content)} байт")


def main() -> None:
    parser = argparse.ArgumentParser(description="Проверка TrustMe с настройками из .env")
    parser.add_argument("--name", help="ФИО для поиска; результаты не привязываются автоматически")
    parser.add_argument("--download", help="Короткий идентификатор проверенного договора")
    parser.add_argument("--output", help="Путь для сохранения PDF")
    args = parser.parse_args()
    if args.download and not args.output:
        parser.error("для --download требуется --output")
    try:
        asyncio.run(check(args))
    except (TrustMeError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    except OSError:
        parser.exit(1, "Не удалось сохранить файл; проверьте путь и наличие файла\n")


if __name__ == "__main__":
    main()
