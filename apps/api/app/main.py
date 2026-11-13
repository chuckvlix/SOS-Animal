import sqlalchemy as sa
from fastapi import APIRouter, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.core.database import SessionDep
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


class ReadinessResponse(BaseModel):
    """Database readiness check response schema."""

    status: str
    database: str


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

    @api_router.get("/ready", response_model=ReadinessResponse, tags=["Health"])
    def readiness_check(session: SessionDep) -> ReadinessResponse:
        """Verify database connectivity before marking the API ready for traffic."""
        try:
            session.execute(sa.text("SELECT 1"))
        except SQLAlchemyError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database unavailable",
            ) from exc
        return ReadinessResponse(status="ready", database="ok")

    api_router.include_router(auth_router)
    api_router.include_router(complaints_router)
    api_router.include_router(directory_router)
    api_router.include_router(campaigns_router)
    api_router.include_router(norms_router)

    application.include_router(api_router)
    return application


app: FastAPI = create_app()
