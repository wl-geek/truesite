from __future__ import annotations

import threading

from starlette.requests import Request

from app.limits import SlidingWindowLimiter, client_ip, rate_key


def _req(xff: list[str] | None = None, peer: str = "169.254.1.1") -> Request:
    headers = [(b"x-forwarded-for", v.encode()) for v in (xff or [])]
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


# ---- client_ip -----------------------------------------------------------------------


def test_no_header_uses_peer() -> None:
    assert client_ip(_req(), 1) == "169.254.1.1"


def test_cloud_run_single_entry() -> None:
    assert client_ip(_req(["203.0.113.5"]), 1) == "203.0.113.5"


def test_spoofed_left_entries_are_ignored() -> None:
    # Client sent "X-Forwarded-For: 6.6.6.6"; Cloud Run appended the real IP.
    assert client_ip(_req(["6.6.6.6, 203.0.113.5"]), 1) == "203.0.113.5"
    assert client_ip(_req(["1.1.1.1,2.2.2.2 , 203.0.113.5"]), 1) == "203.0.113.5"


def test_behind_load_balancer_two_hops() -> None:
    assert client_ip(_req(["6.6.6.6, 203.0.113.5, 34.120.0.1"]), 2) == "203.0.113.5"


def test_fewer_entries_than_hops_takes_leftmost() -> None:
    assert client_ip(_req(["203.0.113.5"]), 2) == "203.0.113.5"


def test_multiple_headers_are_joined() -> None:
    assert client_ip(_req(["6.6.6.6", "203.0.113.5"]), 1) == "203.0.113.5"


def test_garbage_falls_back_to_peer() -> None:
    assert client_ip(_req(["not-an-ip"]), 1) == "169.254.1.1"


def test_hops_zero_ignores_header() -> None:
    assert client_ip(_req(["203.0.113.5"]), 0) == "169.254.1.1"


def test_ipv6_normalised() -> None:
    assert client_ip(_req(["2001:DB8::1"]), 1) == "2001:db8::1"


# ---- rate_key ---------------------------------------------------------------------------


def test_ipv6_grouped_by_64() -> None:
    assert rate_key("2001:db8:1:2:aaaa::1") == rate_key("2001:db8:1:2:bbbb::9") == "2001:db8:1:2::/64"
    assert rate_key("2001:db8:1:3::1") != rate_key("2001:db8:1:2::1")


def test_ipv4_and_mapped() -> None:
    assert rate_key("203.0.113.5") == "203.0.113.5"
    assert rate_key("::ffff:203.0.113.5") == "203.0.113.5"


# ---- limiter ----------------------------------------------------------------------------


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def test_ten_per_hour_then_retry_after() -> None:
    clk = FakeClock()
    lim = SlidingWindowLimiter(10, 3600, clock=clk)
    for i in range(10):
        clk.t = i * 60.0
        assert lim.hit("a") == (True, 0)
    clk.t = 600.0
    allowed, retry = lim.hit("a")
    assert not allowed
    assert retry == 3000  # first hit (t=0) leaves the window at t=3600
    assert lim.hit("b") == (True, 0)  # other keys unaffected


def test_window_slides_rather_than_resets() -> None:
    clk = FakeClock()
    lim = SlidingWindowLimiter(10, 3600, clock=clk)
    for _ in range(5):
        assert lim.hit("a")[0]
    clk.t = 1800.0
    for _ in range(5):
        assert lim.hit("a")[0]
    clk.t = 3599.0
    assert not lim.hit("a")[0]
    clk.t = 3600.0  # the five t=0 hits expire, the t=1800 ones do not
    assert [lim.hit("a")[0] for _ in range(6)] == [True] * 5 + [False]


def test_a_limit_of_zero_refuses_every_hit_for_a_whole_window() -> None:
    """C-39: CHECKS_PER_IP_PER_HOUR=0 (checks switched off) was an IndexError, so the endpoints answered 500."""
    clk = FakeClock()
    lim = SlidingWindowLimiter(0, 3600, clock=clk)
    assert lim.hit("1.2.3.4") == (False, 3600)
    clk.t = 7200.5
    assert lim.hit("1.2.3.4") == (False, 3600)
    assert SlidingWindowLimiter(-1, 60, clock=clk).hit("a") == (False, 60)


def test_retry_after_rounds_up() -> None:
    """C-40: int(retry + 0.999) rounded 2.0005 s down to 2, so a client that waited that long was refused again."""
    clk = FakeClock()
    lim = SlidingWindowLimiter(1, 3600, clock=clk)
    assert lim.hit("a") == (True, 0)
    clk.t = 3597.9995  # the t=0 hit leaves the window 2.0005 s from now
    assert lim.hit("a") == (False, 3)
    clk.t += 3
    assert lim.hit("a") == (True, 0)


def test_denied_hits_are_not_recorded() -> None:
    clk = FakeClock()
    lim = SlidingWindowLimiter(1, 10, clock=clk)
    assert lim.hit("a")[0]
    clk.t = 5
    assert not lim.hit("a")[0]
    clk.t = 10
    assert lim.hit("a")[0]


def test_memory_is_bounded() -> None:
    clk = FakeClock()
    lim = SlidingWindowLimiter(10, 3600, clock=clk, max_keys=100)
    for i in range(1000):
        lim.hit(f"k{i}")
    assert len(lim._hits) <= 100
    assert lim.hit("k999")[0]  # most recent keys survive


def test_thread_safe_exact_count() -> None:
    lim = SlidingWindowLimiter(10, 3600)
    results: list[bool] = []
    lock = threading.Lock()

    def worker() -> None:
        for _ in range(20):
            ok, _ = lim.hit("same")
            with lock:
                results.append(ok)

    threads = [threading.Thread(target=worker) for _ in range(16)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(True) == 10
