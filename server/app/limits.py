"""Per-IP sliding-window rate limit and client-IP extraction behind Cloud Run.

Client IP on Cloud Run
----------------------
Google's front end *appends* the connecting client's IP to X-Forwarded-For and
keeps whatever the client sent in front of it:

    direct *.run.app URL:          "<anything the client sent>,<client-ip>"
    behind an external HTTPS LB:   "<anything the client sent>,<client-ip>,<lb-ip>"

So only the entry `trusted_proxy_hops` from the right is trustworthy (1 for a
plain Cloud Run URL, 2 behind a load balancer). Everything to its left is
attacker-controlled. Do NOT use `uvicorn --forwarded-allow-ips='*'` for this:
with '*' uvicorn takes the *leftmost* entry, which the client can forge.
Verify on day 1 with:  curl -H 'X-Forwarded-For: 203.0.113.9' $URL/api/whoami
(expect your real IP, not 203.0.113.9).

IPv6 clients are keyed by their /64, because one subscriber usually controls a
whole /64 and could otherwise rotate addresses to dodge the limit.

The limiter is in-memory, i.e. per instance. With --max-instances 2 a client
can get at most 2x the limit per hour; the Firestore daily cap is the global
backstop.
"""

from __future__ import annotations

import ipaddress
import math
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable

from starlette.requests import Request


def client_ip(request: Request, trusted_proxy_hops: int) -> str:
    peer = request.client.host if request.client else "unknown"
    if trusted_proxy_hops <= 0:
        return peer
    # Several X-Forwarded-For headers are equivalent to one comma-joined header.
    joined = ",".join(request.headers.getlist("x-forwarded-for"))
    parts = [p.strip() for p in joined.split(",") if p.strip()]
    if not parts:
        return peer  # local dev / tests: no proxy in front
    candidate = parts[-min(trusted_proxy_hops, len(parts))]
    try:
        ip = ipaddress.ip_address(candidate)
    except ValueError:
        return peer
    return str(ip)


def rate_key(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            return str(addr.ipv4_mapped)
        return str(ipaddress.ip_network(f"{addr}/64", strict=False))
    return str(addr)


class SlidingWindowLimiter:
    """Exact sliding-window log: at most `limit` hits in any `window_s` span."""

    def __init__(
        self,
        limit: int,
        window_s: float,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 50_000,
    ) -> None:
        self.limit = limit
        self.window_s = window_s
        self._clock = clock
        self._max_keys = max_keys
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()  # sync endpoints run in a thread pool

    def hit(self, key: str) -> tuple[bool, int]:
        """Record a hit if allowed. Returns (allowed, retry_after_seconds)."""
        now = self._clock()
        cutoff = now - self.window_s
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                if len(self._hits) >= self._max_keys:
                    self._evict(cutoff)
                q = deque()
                self._hits[key] = q
            else:
                self._hits.move_to_end(key)
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= self.limit:
                # Until the oldest hit leaves the window, rounded up so waiting that long is enough. A limit
                # of 0 (the endpoint switched off) records no hits: a whole window.
                retry = q[0] + self.window_s - now if q else self.window_s
                return False, max(1, math.ceil(retry))
            q.append(now)
            return True, 0

    def _evict(self, cutoff: float) -> None:
        """Make room for one new key: drop idle keys, then the least recently used."""
        for k in [k for k, q in self._hits.items() if not q or q[-1] <= cutoff]:
            del self._hits[k]
        while len(self._hits) >= self._max_keys:
            self._hits.popitem(last=False)
