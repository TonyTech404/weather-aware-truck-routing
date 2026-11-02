from django.urls import path

from api import views

urlpatterns = [
    path("api/health", views.health),
    path("api/geocode", views.geocode),
    path("api/analyze", views.analyze),
]

handler500 = "api.views.server_error"
