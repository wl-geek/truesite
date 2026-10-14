"""eval/summarise.py: the overlay and check tables we publish."""
import importlib.util
from pathlib import Path

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
    assert summarise.check_counts(labels, results) == {"hit": 1, "miss": 1, "false_alarm": 1, "match": 1, "cannot_judge": 1}
    assert "| 5 | 1 | 1 | 1 | 1 | 1 (20%) |" in summarise.check_table(summarise.check_counts(labels, results))


def test_missing_sample_counts_as_cannot_judge_and_usage_message():
    assert summarise.check_counts({"s9": {"g": "missing"}}, {})["cannot_judge"] == 1
    assert summarise.main([]) == 2
