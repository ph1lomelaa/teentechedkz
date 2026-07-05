from app.schemas.common import PaginatedResponse
from app.schemas.user import UserCreate, UserUpdate, UserResponse, UserList
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest, MeResponse
from app.schemas.student import (
    StudentCreate,
    StudentUpdate,
    StudentBase,
    StudentListItem,
    StudentFull,
    StudentMentor,
    PaginatedStudents,
)
from app.schemas.guardian import (
    GuardianCreate,
    GuardianUpdate,
    GuardianResponse,
    GuardianResponseFull,
)
from app.schemas.contract import ContractCreate, ContractUpdate, ContractResponse
from app.schemas.application import ApplicationCreate, ApplicationUpdate, ApplicationResponse
from app.schemas.service import ServiceCreate, ServiceUpdate, ServiceResponse
from app.schemas.portfolio_progress import (
    PortfolioProgressCreate,
    PortfolioProgressUpdate,
    PortfolioProgressResponse,
)
from app.schemas.country_reference import (
    CountryReferenceCreate,
    CountryReferenceUpdate,
    CountryReferenceResponse,
)
from app.schemas.confidential_note import ConfidentialNoteCreate, ConfidentialNoteResponse
from app.schemas.student_task import StudentTaskCreate, StudentTaskUpdate, StudentTaskResponse
from app.schemas.payment import (
    PaymentCreate,
    PaymentUpdate,
    PaymentResponse,
    FinanceSummary,
    MentorPayoutRow,
)
from app.schemas.document import DocumentResponse, DocumentUploadResponse
from app.schemas.communication_log import CommunicationLogCreate, CommunicationLogResponse
from app.schemas.pending_insight import PendingInsightResponse, InsightReviewRequest
from app.schemas.status_history import StatusHistoryResponse, PaginatedHistory
from app.schemas.sync_status import SyncStatusResponse
from app.schemas.student_note import StudentNoteCreate, StudentNoteReviewRequest, StudentNoteResponse

__all__ = [
    # common
    "PaginatedResponse",
    # user
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "UserList",
    # auth
    "LoginRequest",
    "TokenResponse",
    "RefreshRequest",
    "MeResponse",
    # student
    "StudentCreate",
    "StudentUpdate",
    "StudentBase",
    "StudentListItem",
    "StudentFull",
    "StudentMentor",
    "PaginatedStudents",
    # guardian
    "GuardianCreate",
    "GuardianUpdate",
    "GuardianResponse",
    "GuardianResponseFull",
    # contract
    "ContractCreate",
    "ContractUpdate",
    "ContractResponse",
    # application
    "ApplicationCreate",
    "ApplicationUpdate",
    "ApplicationResponse",
    # service
    "ServiceCreate",
    "ServiceUpdate",
    "ServiceResponse",
    # portfolio progress
    "PortfolioProgressCreate",
    "PortfolioProgressUpdate",
    "PortfolioProgressResponse",
    # country reference
    "CountryReferenceCreate",
    "CountryReferenceUpdate",
    "CountryReferenceResponse",
    # confidential note
    "ConfidentialNoteCreate",
    "ConfidentialNoteResponse",
    # student task
    "StudentTaskCreate",
    "StudentTaskUpdate",
    "StudentTaskResponse",
    # payment
    "PaymentCreate",
    "PaymentUpdate",
    "PaymentResponse",
    "FinanceSummary",
    "MentorPayoutRow",
    # document
    "DocumentResponse",
    "DocumentUploadResponse",
    # communication log
    "CommunicationLogCreate",
    "CommunicationLogResponse",
    # student note
    "StudentNoteCreate",
    "StudentNoteReviewRequest",
    "StudentNoteResponse",
    # pending insight
    "PendingInsightResponse",
    "InsightReviewRequest",
    # status history
    "StatusHistoryResponse",
    "PaginatedHistory",
    # sync status
    "SyncStatusResponse",
]
