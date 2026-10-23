"""Centroid calls name the Transcribe user they are for (X-End-User-Email), so Centroid's word reports show who
translated, not only the owner of the shared API key."""
import asyncio
import contextvars
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import centroid_client


def test_no_user_sends_no_header():
    ctx = contextvars.Context()
    assert "X-End-User-Email" not in ctx.run(centroid_client._headers)


def test_user_email_is_sent_lower_cased():
    def run():
        centroid_client.for_user(SimpleNamespace(email=" Editor@VerboLabs.com "))
        return centroid_client._headers()
    headers = contextvars.Context().run(run)
    assert headers["X-End-User-Email"] == "editor@verbolabs.com"
    assert "x-api-key" in headers


def test_each_request_keeps_its_own_user():
    async def request(email):
        centroid_client.for_user(SimpleNamespace(email=email))
        await asyncio.sleep(0)
        return centroid_client._headers()["X-End-User-Email"]

    async def both():
        return await asyncio.gather(asyncio.create_task(request("a@x.com")), asyncio.create_task(request("b@x.com")))

    assert asyncio.run(both()) == ["a@x.com", "b@x.com"]
