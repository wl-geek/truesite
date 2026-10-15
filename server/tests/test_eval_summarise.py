"""eval/summarise.py: the overlay and check tables we publish."""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("summarise", ROOT / "eval" / "summarise.py")
summarise = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summarise)


def test_overlay_median_and_worst_per_distance():
    rows = [{"distance_m": d, "point_id": "P1", "offset_mm": o, "try": "1"}
            for d, o in [("1", "8"), ("1", "12"), ("1", "10"), ("2", "20"), ("2", "35")]]
    table = summarise.overlay_table(rows)
    assert "| 1 m | 3 | 10 mm | 12 mm |" in table and "| 2 m | 2 | 28 mm | 35 mm |" in table


def test_check_counts_follow_the_definitions():
    labels = {"s1": {"door": "misplaced", "sleeve": "missing", "wall": "present_ok", "col": "present_ok", "win": "present_ok"}}
    results = {"s1": {"findings": [
        {"guid": "door", "status": "misplaced"},       # hit
        {"guid": "sleeve", "status": "present_ok"},    # miss
        {"guid": "wall", "status": "missing"},         # false alarm
        {"guid": "col", "status": "present_ok"},       # match
        # win not in the result -> can't judge
    ]}}
    assert summarise.check_counts(labels, results) == {"hit": 1, "miss": 1, "false_alarm": 1, "match": 1,
                                                       "cannot_judge": 1, "not_run": 0}
    assert "| 5 | 1 | 1 | 1 | 1 | 1 (20%) | 0 |" in summarise.check_table(summarise.check_counts(labels, results))


def test_a_sample_that_did_not_run_is_not_cant_judge():
    # A 429 or a broken sample says nothing about the model, so it stays out of the can't-judge share.
    counts = summarise.check_counts({"s1": {"a": "present_ok", "b": "missing"}, "s9": {"g": "missing", "h": "present_ok"}},
                                    {"s1": {"findings": [{"guid": "a", "status": "present_ok"}]}})
    assert counts == {"hit": 0, "miss": 0, "false_alarm": 0, "match": 1, "cannot_judge": 1, "not_run": 2}
    assert "| 4 | 0 | 0 | 0 | 1 | 1 (50%) | 2 |" in summarise.check_table(counts)


def test_check_exits_non_zero_and_names_the_samples_that_did_not_run(tmp_path, capsys):
    labels, results = tmp_path / "labels.json", tmp_path / "results.json"
    labels.write_text(json.dumps({"s1": {"a": "present_ok"}, "s9": {"g": "missing"}, "s10": {"g": "missing"}}))
    results.write_text(json.dumps({"s1": {"findings": [{"guid": "a", "status": "present_ok"}]}}))
    assert summarise.main(["check", str(labels), str(results)]) == 1
    out, err = capsys.readouterr()
    assert "| 3 |" in out and "not run: s10, s9" in err


def test_usage_message():
    assert summarise.main([]) == 2


def test_label_typos_are_rejected():
    with pytest.raises(ValueError, match="misplace"):
        summarise.check_counts({"s1": {"door": "misplace"}}, {})


def test_files_are_read_as_utf8(tmp_path):
    labels, results = tmp_path / "labels.json", tmp_path / "results.json"
    labels.write_bytes(json.dumps({"s1": {"a": "present_ok"}}).encode())
    results.write_bytes(json.dumps({"s1": {"summary": "Door “D-01” looks fine.",
                                           "findings": [{"guid": "a", "status": "present_ok"}]}},
                                   ensure_ascii=False).encode("utf-8"))
    assert summarise.main(["check", str(labels), str(results)]) == 0
    csv = tmp_path / "overlay.csv"
    csv.write_bytes("﻿distance_m,point_id,offset_mm,try\n1,P1,8,1\n".encode())  # Excel saves CSV with a BOM
    assert summarise.main(["overlay", str(csv)]) == 0
