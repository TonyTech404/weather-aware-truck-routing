"""Cloudflare Python Worker entrypoint: serves the Django ASGI app."""

import os
from concurrent.futures import Executor, Future

import asgiref.sync
from workers import WorkerEntrypoint, asgi

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "routeguard.settings")


class InlineExecutor(Executor):
    """Runs submitted callables immediately on the calling thread.

    The workers runtime is single-threaded (Pyodide cannot start OS threads), but
    Django's ASGI handler pushes small sync calls such as ``response.close()``
    through asgiref's thread pool. Running them inline is safe here because the
    API has no blocking I/O or database access in sync code.
    """

    def submit(self, fn, /, *args, **kwargs):
        future = Future()
        try:
            future.set_result(fn(*args, **kwargs))
        except BaseException as exc:  # noqa: BLE001 - propagate through the future
            future.set_exception(exc)
        return future

    def shutdown(self, wait=True, *, cancel_futures=False):
        pass

    def __bool__(self):
        # asgiref only spawns a joiner thread on context exit for a truthy executor.
        return False


asgiref.sync.ThreadPoolExecutor = lambda *args, **kwargs: InlineExecutor()

from routeguard.asgi import application  # noqa: E402


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await asgi.fetch(application, request, self.env)
