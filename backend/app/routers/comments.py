import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Comment
from app.schemas import CommentCreate, CommentResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/comments", tags=["comments"])

VALID_ENTITY_TYPES = {"alert", "backup"}


@router.get("/{entity_type}/{entity_id}", response_model=List[CommentResponse])
async def list_comments(entity_type: str, entity_id: str, db: Session = Depends(get_db)):
    """List all comments for an entity (alert or backup)"""
    if entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail=f"entity_type must be one of: {VALID_ENTITY_TYPES}")
    comments = (
        db.query(Comment)
        .filter(Comment.entity_type == entity_type, Comment.entity_id == entity_id)
        .order_by(Comment.created_at.asc())
        .all()
    )
    return comments


@router.post("/{entity_type}/{entity_id}", response_model=CommentResponse)
async def create_comment(
    entity_type: str,
    entity_id: str,
    body: CommentCreate,
    db: Session = Depends(get_db),
):
    """Add a comment to an alert or backup"""
    if entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail=f"entity_type must be one of: {VALID_ENTITY_TYPES}")
    author = (body.author or "").strip() or "CMS"
    comment = Comment(
        entity_type=entity_type,
        entity_id=entity_id,
        content=body.content.strip(),
        author=author,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/{comment_id}")
async def delete_comment(comment_id: str, db: Session = Depends(get_db)):
    """Delete a comment"""
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    db.delete(comment)
    db.commit()
    return {"message": "Comment deleted"}
