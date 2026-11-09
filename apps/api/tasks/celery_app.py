from celery import Celery
from celery.schedules import crontab
from kombu import Queue
from kombu.exceptions import OperationalError

try:
    from ..config import settings
except ImportError:
    from config import settings

celery_app = Celery(
    "freeframe",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "apps.api.tasks.transcode_tasks",
        "apps.api.tasks.purge_tasks",
        "apps.api.tasks.email_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    broker_connection_retry=True,
    broker_connection_max_retries=5,
    broker_pool_limit=0,  # Disable connection pooling in web process to avoid stale connections
    # Bound every broker socket call. Without this a Redis that accepts the
    # connection but never answers (paused, network blackhole) hangs a publish
    # forever and pins one of the four dispatch threads below. A publish is one
    # LPUSH and a worker's BRPOP waits 1 s, so 5 s never fires on a live Redis.
    broker_transport_options={"socket_timeout": 5, "socket_connect_timeout": 5},
    # Define queues
    task_queues=(
        Queue("default"),
        Queue("transcoding"),
        Queue("email_high"),  # Magic codes, invites - immediate
        Queue("email_low"),   # Mentions, comments - can be delayed
    ),
    task_default_queue="default",
    # Route tasks to queues
    task_routes={
        "apps.api.tasks.transcode_tasks.*": {"queue": "transcoding"},
        # Maintenance tasks share the transcoding worker; nothing consumes "default".
        "purge_expired_trash": {"queue": "transcoding"},
        "fail_stale_versions": {"queue": "transcoding"},
        "trash_approved_assets": {"queue": "transcoding"},
        "apps.api.tasks.email_tasks.send_invite_email": {"queue": "email_high"},
        "apps.api.tasks.email_tasks.send_mention_email": {"queue": "email_low"},
        "apps.api.tasks.email_tasks.send_comment_email": {"queue": "email_low"},
        "apps.api.tasks.email_tasks.send_approval_email": {"queue": "email_low"},
        "apps.api.tasks.email_tasks.send_project_added_email": {"queue": "email_low"},
    },
    # Rate limiting for email queues (SES limits)
    task_annotations={
        "apps.api.tasks.email_tasks.*": {"rate_limit": "10/s"},  # 10 emails per second
    },
)

celery_app.conf.beat_schedule = {
    "purge-expired-trash": {
        "task": "purge_expired_trash",
        "schedule": crontab(minute="30", hour="3", day_of_week="0"),  # weekly, Sun 03:30
    },
    "fail-stale-versions": {
        "task": "fail_stale_versions",
        "schedule": crontab(minute="0", hour="4"),  # daily 04:00
    },
    "trash-approved-assets": {
        "task": "trash_approved_assets",
        "schedule": crontab(minute="15", hour="4"),  # daily 04:15
    },
}


import logging
from concurrent.futures import ThreadPoolExecutor

_task_logger = logging.getLogger("celery.dispatch")

# Dispatches go through a small shared pool instead of one daemon thread per
# call. With broker_pool_limit=0 every thread also opened its own broker
# connection, so a burst had no bound on threads or connections, and daemon
# threads are killed at interpreter exit, so a dispatch that had not reached the
# broker when the API worker stopped or restarted (a deploy right after an
# upload completes) was lost without a log line. concurrent.futures joins its
# workers at exit, so a queued or in-flight dispatch is sent instead. The queue is
# unbounded on purpose: a caller on the request path must never wait for a slot.
_dispatch_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="celery-dispatch")


def _dispatch_task(task, args, kwargs):
    """Actually send the task to Celery broker (runs on the dispatch pool).

    ignore_result: the caller discards the AsyncResult, so nothing can read the
    result. Without it Celery first subscribes to the result backend in case the
    caller waits, and on an unresponsive Redis that call retries for minutes
    before the publish is even attempted.
    """
    try:
        task.apply_async(args=args, kwargs=kwargs, ignore_result=True)
    except (OperationalError, ConnectionError, OSError):
        try:
            with celery_app.producer_or_acquire() as producer:
                task.apply_async(args=args, kwargs=kwargs, producer=producer, ignore_result=True)
        except Exception:
            _task_logger.warning("Failed to dispatch task %s after retry", task.name)
    except Exception:
        _task_logger.warning("Failed to dispatch task %s", task.name)


def send_task_safe(task, *args, **kwargs):
    """Send a Celery task from a background thread so it never blocks the API response.

    Broker connections can take seconds (especially with pool_limit=0).
    This ensures the API returns immediately while the task is dispatched async
    on the shared, bounded dispatch pool.
    """
    _dispatch_executor.submit(_dispatch_task, task, args, kwargs)
