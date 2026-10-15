"""Turn evaluation measurements into the tables for the README and deck (spec section 10).

  python eval/summarise.py overlay eval/overlay.csv
      overlay.csv columns: distance_m, point_id, offset_mm, try  (one row per measurement)
      -> median and worst on-screen offset per distance

  python eval/summarise.py check eval/labels.json results.json
      labels.json:  {"<sample_id>": {"<guid>": "<expected status>"}}   (staged deviations vs matches)
      results.json: {"<sample_id>": <CheckResult>}                    (downloaded from /samples?dev=1)
      -> hits, misses, false alarms, correct matches, can't-judge share

Definitions (per labelled element):
  hit          expected a deviation, returned a deviation (missing / misplaced / different_from_design)
  miss         expected a deviation, returned present_ok
  false alarm  expected present_ok, returned a deviation
  match        expected present_ok, returned present_ok
  can't judge  returned cannot_judge, or the element was not in the result (counted separately, never rounded up)
"""
from __future__ import annotations

import csv
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

DEVIATIONS = {"missing", "misplaced", "different_from_design"}


def overlay_table(rows: list[dict[str, str]]) -> str:
    by_distance: dict[float, list[float]] = defaultdict(list)
    for row in rows:
        by_distance[float(row["distance_m"])].append(float(row["offset_mm"]))
    lines = ["| Distance | Measurements | Median offset | Worst offset |", "|---|---|---|---|"]
    for d in sorted(by_distance):
        xs = by_distance[d]
        lines.append(f"| {d:g} m | {len(xs)} | {statistics.median(xs):.0f} mm | {max(xs):.0f} mm |")
    return "\n".join(lines)


def check_counts(labels: dict[str, dict[str, str]], results: dict[str, dict]) -> dict[str, int]:
    counts = {"hit": 0, "miss": 0, "false_alarm": 0, "match": 0, "cannot_judge": 0}
    for sample_id, expected in labels.items():
        findings = {f["guid"]: f["status"] for f in results.get(sample_id, {}).get("findings", [])}
        for guid, want in expected.items():
            got = findings.get(guid, "cannot_judge")
            if got == "cannot_judge":
                counts["cannot_judge"] += 1
            elif want in DEVIATIONS:
                counts["hit" if got in DEVIATIONS else "miss"] += 1
            else:
                counts["false_alarm" if got in DEVIATIONS else "match"] += 1
    return counts


def check_table(counts: dict[str, int]) -> str:
    total = sum(counts.values())
    share = f"{100 * counts['cannot_judge'] / total:.0f}%" if total else "—"
    return "\n".join([
        "| Labelled elements | Hits | Misses | False alarms | Correct matches | Can't judge |",
        "|---|---|---|---|---|---|",
        f"| {total} | {counts['hit']} | {counts['miss']} | {counts['false_alarm']} | {counts['match']} | {counts['cannot_judge']} ({share}) |",
    ])


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "overlay":
        with open(argv[1], newline="", encoding="utf-8") as fh:
            print(overlay_table(list(csv.DictReader(fh))))
        return 0
    if len(argv) >= 3 and argv[0] == "check":
        labels = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
        results = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
        print(check_table(check_counts(labels, results)))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
