"""Replay synthetic recognition cases using the configured provider; no DB writes.

From backend: python scripts/evaluate_profile_recognition.py --output /tmp/eval.json
Requires explicit authorization to send the fixture text to the AI provider.
Local regression tests use the same fixture without any network calls.
"""
import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings
from app.services.ai_client import complete_with_fallback, json_block, provider_chain
from app.services.profile_recognition import normalized, recognize_profile_changes
from app.services.telegram_extraction import PROMPT_SYSTEM


async def evaluate(output: str, limit: int | None = None) -> bool:
    if not provider_chain():
        raise SystemExit('No AI provider configured')
    cases = json.loads((Path(__file__).resolve().parents[1] / 'tests/fixtures/profile_recognition_cases.json').read_text())
    if limit is not None:
        if limit < 1:
            raise SystemExit("--limit must be positive")
        cases = cases[:limit]
    semaphore = asyncio.Semaphore(3)

    async def run(case):
        try:
            dialog = json.loads(case['source_text'])
        except ValueError:
            dialog = [{'text': case['source_text'], 'sender_role': 'unknown'}]
        payload = {'student_profile': case['snapshot'], 'preceding_dialog': dialog,
                   'new_message': {'id': case['id'], 'text': dialog[-1]['text']}}
        async with semaphore:
            raw = await complete_with_fallback(PROMPT_SYSTEM, json.dumps(payload, ensure_ascii=False), max_tokens=1800)
        parsed = json_block(raw)
        accepted, reasons = recognize_profile_changes(parsed.get('proposed_changes'), parsed.get('change_evidence'),
                                                     source_text=case['source_text'], snapshot=case['snapshot'])
        expected = case['expected']
        correct = set(accepted) == set(expected)
        for field, value in expected.items():
            actual = accepted.get(field)
            if field == 'phone':
                correct = correct and re.sub(r'\D', '', str(value)) == re.sub(r'\D', '', str(actual))
            elif field == 'achievements_text':
                correct = correct and all(normalized(line) in normalized(actual) for line in str(value).splitlines())
            else:
                correct = correct and normalized(actual) == normalized(value)
        return {'id': case['id'], 'pass': bool(correct), 'expected': expected, 'accepted': accepted,
                'filter_reasons': reasons, 'model_output': parsed}

    results = await asyncio.gather(*(run(case) for case in cases))
    report = {'provider_chain': provider_chain(), 'configured_openai_model': settings.OPENAI_MODEL,
              'cases': len(results), 'passed': sum(r['pass'] for r in results),
              'failed': [r['id'] for r in results if not r['pass']], 'results': results}
    Path(output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'results'}, ensure_ascii=False))
    return not report['failed']


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    raise SystemExit(0 if asyncio.run(evaluate(args.output, args.limit)) else 1)
