"""Property tests for limits: the client IP behind Cloud Run, the rate key and the sliding-window limiter."""
from __future__ import annotations

import ipaddress

from hypothesis import assume, given, settings, strategies as st
from starlette.requests import Request

from app.limits import SlidingWindowLimiter, client_ip, rate_key

PROPS = settings(max_examples=200, deadline=None)
PEER = "10.0.0.9"


def _req(xff: list[str], peer: str = PEER) -> Request:
    headers = [(b"x-forwarded-for", v.encode("latin-1")) for v in xff]
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


ips = st.ip_addresses().map(str)
# Anything a client can put in the header: addresses, junk and spaces (a comma only starts another entry).
junk = st.text(alphabet=st.characters(min_codepoint=32, max_codepoint=255, exclude_characters=","), max_size=20)
entries = ips | junk


# ---- client_ip ---------------------------------------------------------------------------------------
@PROPS
@given(st.lists(entries, max_size=5), st.lists(ips, min_size=1, max_size=3), st.integers(1, 3))
def test_entries_a_client_puts_in_front_cannot_change_its_ip(spoofed, appended, hops):
    """Google's front end appends the real client IP (a load balancer then its own): only `hops` from the right count."""
    assume(len(appended) >= hops)
    expected = str(ipaddress.ip_address(appended[-hops]))
    assert client_ip(_req([", ".join(appended)]), hops) == expected
    assert client_ip(_req([", ".join([*spoofed, *appended])]), hops) == expected
    assert client_ip(_req([*spoofed, ", ".join(appended)]), hops) == expected  # several headers are one joined header


@PROPS
@given(st.lists(entries, max_size=4), junk, st.integers(1, 3))
def test_a_trusted_entry_that_is_not_an_ip_falls_back_to_the_peer(spoofed, bad, hops):
    try:
        ipaddress.ip_address(bad.strip())
        assume(False)
    except ValueError:
        pass
    assume(bad.strip())
    xff = [*spoofed, bad, *["203.0.113.1"] * (hops - 1)]
    assert client_ip(_req([", ".join(xff)]), hops) == PEER


@PROPS
@given(st.lists(entries, max_size=6), st.integers(-2, 0))
def test_no_trusted_hops_means_the_peer(xff, hops):
    assert client_ip(_req(xff), hops) == PEER


# ---- rate_key ----------------------------------------------------------------------------------------
@PROPS
@given(st.ip_addresses(v=6), st.integers(0, 2**64 - 1))
def test_ipv6_addresses_in_one_64_share_a_key(addr, host):
    other = ipaddress.IPv6Address((int(addr) >> 64 << 64) | host)
    assume(addr.ipv4_mapped is None and other.ipv4_mapped is None)
    assert rate_key(str(addr)) == rate_key(str(other)) == str(ipaddress.ip_network(f"{addr}/64", strict=False))


@PROPS
@given(st.ip_addresses(v=6), st.ip_addresses(v=6))
def test_ipv6_addresses_in_different_64s_get_different_keys(a, b):
    assume(int(a) >> 64 != int(b) >> 64 and a.ipv4_mapped is None and b.ipv4_mapped is None)
    assert rate_key(str(a)) != rate_key(str(b))


@PROPS
@given(st.ip_addresses(v=4), st.ip_addresses(v=4))
def test_ipv4_is_its_own_key_and_its_mapped_form_shares_it(addr, other):
    assert rate_key(str(addr)) == rate_key(f"::ffff:{addr}") == str(addr)
    assert (rate_key(str(addr)) == rate_key(str(other))) == (addr == other)


@PROPS
@given(st.text(max_size=30))
def test_a_key_that_is_not_an_ip_is_kept_as_it_is(value):
    try:
        ipaddress.ip_address(value)
    except ValueError:
        assert rate_key(value) == value


# ---- SlidingWindowLimiter ----------------------------------------------------------------------------
class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


@PROPS
@given(st.integers(1, 4), st.integers(1, 60), st.lists(st.tuples(st.integers(0, 30), st.sampled_from("abc")), max_size=60))
def test_limiter_is_an_exact_sliding_window_per_key(limit, window, events):
    """A hit is allowed iff fewer than `limit` allowed hits of that key fall in (now - window, now]. Denied
    hits are not recorded, and Retry-After (whole seconds on a whole-second clock) is exactly when the
    oldest hit leaves the window."""
    clock = Clock()
    limiter = SlidingWindowLimiter(limit, window, clock=clock)
    allowed: dict[str, list[float]] = {}
    for dt, key in events:
        clock.t += dt
        recent = [t for t in allowed.get(key, []) if t > clock.t - window]
        ok, retry = limiter.hit(key)
        assert ok == (len(recent) < limit)
        if ok:
            assert retry == 0
            allowed.setdefault(key, []).append(clock.t)
        else:
            assert retry == recent[0] + window - clock.t >= 1


@PROPS
@given(st.integers(1, 3), st.integers(1, 60), st.integers(1, 40))
def test_after_retry_after_the_next_hit_is_allowed(limit, window, gap):
    clock = Clock()
    limiter = SlidingWindowLimiter(limit, window, clock=clock)
    for _ in range(limit):
        assert limiter.hit("k") == (True, 0)
    clock.t += min(gap, window - 1)
    ok, retry = limiter.hit("k")
    assert not ok and 1 <= retry <= window
    clock.t += retry - 1
    assert not limiter.hit("k")[0]  # one second early is still too early
    clock.t += 1
    assert limiter.hit("k") == (True, 0)


@PROPS
@given(st.integers(1, 5), st.lists(st.tuples(st.integers(0, 20), st.text(alphabet="abcdefgh", min_size=1, max_size=2)),
                                   max_size=80))
def test_limiter_never_holds_more_than_max_keys(max_keys, events):
    clock = Clock()
    limiter = SlidingWindowLimiter(3, 30, clock=clock, max_keys=max_keys)
    for dt, key in events:
        clock.t += dt
        ok, _ = limiter.hit(key)
        assert len(limiter._hits) <= max_keys
        if ok:
            assert key in limiter._hits  # the key that was just let through is never the one evicted
