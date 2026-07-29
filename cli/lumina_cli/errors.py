from __future__ import annotations

class CliError(Exception):
    def __init__(self, message: str, *, code: int = 1, hint: str | None = None, error_code: str | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.hint = hint
        self.error_code = error_code or "error"

class ConfigError(CliError):
    def __init__(self, message: str, *, hint: str | None = None):
        super().__init__(message, code=2, hint=hint, error_code="config_error")

class AuthError(CliError):
    def __init__(self, message: str, *, hint: str | None = None):
        super().__init__(message, code=3, hint=hint, error_code="auth_error")

class DependencyError(CliError):
    def __init__(self, message: str, *, hint: str | None = None):
        super().__init__(message, code=4, hint=hint, error_code="dependency_error")

class SyncError(CliError):
    def __init__(self, message: str, *, hint: str | None = None):
        super().__init__(message, code=5, hint=hint, error_code="sync_error")
