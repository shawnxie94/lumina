from app.api.route_loader import build_legacy_router

router = build_legacy_router(include=[lambda path: path == '/api/export'])
