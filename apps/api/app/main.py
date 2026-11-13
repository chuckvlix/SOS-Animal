from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.core.config import settings
from app.modules.auth.router import router as auth_router
from app.modules.campaigns.router import router as campaigns_router
from app.modules.complaints.router import router as complaints_router
from app.modules.directory.router import router as directory_router
from app.modules.norms.router import router as norms_router


class HealthResponse(BaseModel):
    """Health check response schema."""

    status: str
    service: str
    version: str


def create_app() -> FastAPI:
    """Instantiate and configure the FastAPI application."""
    application = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api_router = APIRouter(prefix=settings.API_V1_PREFIX)

    @api_router.get("/health", response_model=HealthResponse, tags=["Health"])
    def health_check() -> HealthResponse:
        """Return API liveness metadata."""
        return HealthResponse(
            status="ok",
            service=settings.APP_NAME,
            version=settings.APP_VERSION,
        )

    api_router.include_router(auth_router)
    api_router.include_router(complaints_router)
    api_router.include_router(directory_router)
    api_router.include_router(campaigns_router)
    api_router.include_router(norms_router)

    application.include_router(api_router)
    return application


app: FastAPI = create_app()
