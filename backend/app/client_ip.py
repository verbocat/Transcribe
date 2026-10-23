"""Client IP resolution shared by the API and the auth routes."""
import os

from fastapi import Request

# X-Forwarded-For is client-controlled unless it was added by our own reverse proxy, so it is honoured only when
# the TCP peer is one of these (comma-separated IPs; the default is a proxy on the same machine, e.g. nginx).
TRUSTED_PROXIES = {p.strip() for p in os.getenv("TRUSTED_PROXIES", "127.0.0.1,::1").split(",") if p.strip()}


def get_client_ip(request: Request) -> str:
    """Client IP for rate limiting and lockouts. Behind our own proxy it is the last X-Forwarded-For hop (the one
    the proxy appended); a direct caller's header is ignored."""
    peer = request.client.host if request.client else "127.0.0.1"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and peer in TRUSTED_PROXIES:
        hops = [h.strip() for h in forwarded.split(",") if h.strip()]
        if hops:
            return hops[-1]
    return peer
