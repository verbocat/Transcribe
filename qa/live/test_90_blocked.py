"""Coverage: every endpoint that is never sent to production appears in the report as SKIP with why."""
import pytest

from catalog import CATALOG

pytestmark = pytest.mark.blocked

BLOCKED = [e for e in CATALOG if e.tier == "blocked"]


@pytest.mark.parametrize("ep", BLOCKED, ids=lambda e: e.id)
def test_not_run_on_production(ep):
    pytest.skip(f"blocked on production: {ep.why}")
