from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def root():
    return {"message": "文章知识库API", "version": "1.0.0"}
