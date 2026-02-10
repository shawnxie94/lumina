from typing import Optional

from pydantic import BaseModel


class CommentCreate(BaseModel):
    content: str
    user_id: str
    user_name: str
    user_avatar: Optional[str] = None
    provider: Optional[str] = None
    reply_to_id: Optional[str] = None


class CommentUpdate(BaseModel):
    content: str
    reply_to_id: Optional[str] = None


class CommentVisibilityUpdate(BaseModel):
    is_hidden: bool
