from __future__ import annotations

from threading import Barrier, Thread
from time import sleep

from app.core.public_cache import PublicTTLCache


def test_public_ttl_cache_coalesces_concurrent_loads_for_same_key():
    cache = PublicTTLCache()
    barrier = Barrier(5)
    load_count = 0
    results: list[str] = []

    def loader() -> str:
        nonlocal load_count
        load_count += 1
        sleep(0.05)
        return "cached-value"

    def worker() -> None:
        barrier.wait()
        results.append(cache.get_or_set("same-key", loader))

    threads = [Thread(target=worker) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert results == ["cached-value"] * 5
    assert load_count == 1
