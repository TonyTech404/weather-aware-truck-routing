from django.http import JsonResponse


async def health(request):
    return JsonResponse({"status": "ok", "service": "routeguard-api"})
