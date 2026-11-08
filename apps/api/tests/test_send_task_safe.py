"""Celery dispatches share a small pool, discard results, and survive a failing broker."""
import threading
from unittest.mock import MagicMock

from kombu.exceptions import OperationalError

from apps.api.tasks import celery_app as celery_module


def _counting_task(expected: int, on_call=None):
    """A task double that sets `done` once `expected` dispatches have reached it."""
    done = threading.Event()
    lock = threading.Lock()
    calls = 0

    def apply_async(**kwargs):
        nonlocal calls
        if on_call:
            on_call(kwargs)
        with lock:
            calls += 1
            if calls >= expected:
                done.set()

    task = MagicMock()
    task.apply_async.side_effect = apply_async
    return task, done


def test_dispatch_returns_at_once_and_does_not_keep_the_result():
    task, done = _counting_task(1)

    celery_module.send_task_safe(task, "asset-1", "version-1")

    assert done.wait(5)
    task.apply_async.assert_called_once_with(args=("asset-1", "version-1"), kwargs={}, ignore_result=True)


def test_a_burst_of_dispatches_uses_at_most_four_threads():
    seen: set[str] = set()
    task, done = _counting_task(40, on_call=lambda _: seen.add(threading.current_thread().name))

    for i in range(40):
        celery_module.send_task_safe(task, i)

    assert done.wait(5)
    assert task.apply_async.call_count == 40
    assert 1 <= len(seen) <= 4
    assert all(name.startswith("celery-dispatch") for name in seen)


def test_a_broker_error_is_retried_once_then_logged_not_raised(monkeypatch):
    task = MagicMock(name="task")
    task.name = "process_asset"
    done = threading.Event()

    def broker_down(**kwargs):
        if "producer" in kwargs:  # the retry on a fresh producer
            done.set()
        raise OperationalError("broker down")

    task.apply_async.side_effect = broker_down
    monkeypatch.setattr(celery_module.celery_app, "producer_or_acquire", lambda: MagicMock())

    celery_module.send_task_safe(task, "asset-1")

    assert done.wait(5)
    assert task.apply_async.call_count == 2  # the direct attempt, then one on a fresh producer
    assert task.apply_async.call_args.kwargs["ignore_result"] is True
