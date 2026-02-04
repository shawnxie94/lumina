from ai_client import ConfigurableAIClient, is_english_content
from models import (
    Article,
    AIAnalysis,
    Category,
    SessionLocal,
    ModelAPIConfig,
    PromptConfig,
)
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError


def build_parameters(model) -> dict:
    if not model:
        return {}
    params = {}
    system_prompt = getattr(model, "system_prompt", None)
    response_format = getattr(model, "response_format", None)
    temperature = getattr(model, "temperature", None)
    max_tokens = getattr(model, "max_tokens", None)
    top_p = getattr(model, "top_p", None)
    if system_prompt:
        params["system_prompt"] = system_prompt
    if response_format:
        params["response_format"] = response_format
    if temperature is not None:
        params["temperature"] = temperature
    if max_tokens is not None:
        params["max_tokens"] = max_tokens
    if top_p is not None:
        params["top_p"] = top_p
    return params


class ArticleService:
    def __init__(self):
        pass

    def get_ai_config(
        self, db: Session, category_id: str = None, prompt_type: str = "summary"
    ):
        query = db.query(ModelAPIConfig).filter(ModelAPIConfig.is_enabled == True)
        prompt_query = db.query(PromptConfig).filter(
            PromptConfig.is_enabled == True, PromptConfig.type == prompt_type
        )

        prompt_config = None
        if category_id:
            prompt_config = prompt_query.filter(
                PromptConfig.category_id == category_id
            ).first()

        if not prompt_config:
            prompt_config = prompt_query.filter(
                PromptConfig.category_id.is_(None)
            ).first()

        model_config = None
        if prompt_config and prompt_config.model_api_config_id:
            model_config = query.filter(
                ModelAPIConfig.id == prompt_config.model_api_config_id
            ).first()

        if not model_config:
            model_config = query.filter(ModelAPIConfig.is_default == True).first()

        if not model_config:
            return None

        result = {
            "base_url": model_config.base_url,
            "api_key": model_config.api_key,
            "model_name": model_config.model_name,
            "prompt_template": prompt_config.prompt if prompt_config else None,
        }

        parameters = build_parameters(prompt_config) if prompt_config else {}
        result["parameters"] = parameters or None
        return result

    def create_ai_client(self, config: dict) -> ConfigurableAIClient:
        return ConfigurableAIClient(
            base_url=config["base_url"],
            api_key=config["api_key"],
            model_name=config["model_name"],
        )

    async def create_article(self, article_data: dict, db: Session) -> str:
        category = (
            db.query(Category)
            .filter(Category.id == article_data.get("category_id"))
            .first()
        )

        article = Article(
            title=article_data.get("title"),
            content_html=article_data.get("content_html"),
            content_md=article_data.get("content_md"),
            source_url=article_data.get("source_url"),
            top_image=article_data.get("top_image"),
            author=article_data.get("author"),
            published_at=article_data.get("published_at"),
            source_domain=article_data.get("source_domain"),
            category_id=article_data.get("category_id"),
            status="pending",
        )

        try:
            db.add(article)
            db.commit()
            db.refresh(article)
        except IntegrityError as e:
            db.rollback()
            error_str = str(e).lower()
            if "source_url" in error_str or "unique constraint" in error_str:
                existing = (
                    db.query(Article)
                    .filter(Article.source_url == article_data.get("source_url"))
                    .first()
                )
                if existing:
                    raise ValueError("该文章已存在，请勿重复提交")
            raise ValueError(f"数据完整性错误: {str(e)}")

        import asyncio

        asyncio.create_task(
            self.process_article_ai(article.id, article_data.get("category_id"))
        )

        return article.id

    async def process_article_ai(self, article_id: str, category_id: str):
        from models import SessionLocal
        import asyncio

        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            article.status = "processing"
            db.commit()

            ai_config = self.get_ai_config(db, category_id)
            if not ai_config:
                article.status = "failed"
                existing_analysis = (
                    db.query(AIAnalysis)
                    .filter(AIAnalysis.article_id == article_id)
                    .first()
                )
                if existing_analysis:
                    existing_analysis.error_message = (
                        "未配置AI服务，请先在配置页面设置AI参数"
                    )
                else:
                    ai_analysis = AIAnalysis(
                        article_id=article.id,
                        error_message="未配置AI服务，请先在配置页面设置AI参数",
                    )
                    db.add(ai_analysis)
                db.commit()
                return

            ai_client = self.create_ai_client(ai_config)
            parameters = ai_config.get("parameters") or {}
            prompt = ai_config.get("prompt_template")

            try:
                summary = await asyncio.wait_for(
                    ai_client.generate_summary(
                        article.content_md, prompt=prompt, parameters=parameters
                    ),
                    timeout=300.0,
                )
            except asyncio.TimeoutError:
                raise Exception("AI生成超时，请稍后重试")

            # Auto-translate English articles to Chinese
            content_trans = None
            if article.content_md and is_english_content(article.content_md):
                try:
                    print(f"检测到英文文章，开始翻译: {article.title}")
                    article.translation_status = "processing"
                    article.translation_error = None
                    db.commit()

                    # 获取翻译类型的提示词配置
                    trans_config = self.get_ai_config(
                        db, category_id, prompt_type="translation"
                    )
                    trans_prompt = None
                    trans_parameters = {}

                    # 如果有翻译专用配置，使用翻译配置的AI客户端
                    if trans_config:
                        trans_prompt = trans_config.get("prompt_template")
                        trans_parameters = trans_config.get("parameters") or {}
                        # 如果翻译配置有独立的模型配置，使用它
                        if trans_config.get("base_url") and trans_config.get("api_key"):
                            trans_client = self.create_ai_client(trans_config)
                        else:
                            trans_client = ai_client
                    else:
                        trans_client = ai_client

                    content_trans = await asyncio.wait_for(
                        trans_client.translate_to_chinese(
                            article.content_md,
                            prompt=trans_prompt,
                            parameters=trans_parameters,
                        ),
                        timeout=300.0,
                    )
                    print(f"翻译完成: {article.title}")
                    article.translation_status = "completed"
                    article.translation_error = None
                except asyncio.TimeoutError:
                    print(f"翻译超时: {article.title}")
                    article.translation_status = "failed"
                    article.translation_error = "翻译超时，请稍后重试"
                except Exception as e:
                    print(f"翻译失败: {article.title}, 错误: {e}")
                    article.translation_status = "failed"
                    article.translation_error = str(e)

            # Update article with translation if available
            if content_trans:
                article.content_trans = content_trans

            existing_analysis = (
                db.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).first()
            )
            if existing_analysis:
                existing_analysis.summary = summary
                existing_analysis.error_message = None
            else:
                ai_analysis = AIAnalysis(article_id=article.id, summary=summary)
                db.add(ai_analysis)

            article.status = "completed"
            db.commit()
        except Exception as e:
            print(f"AI生成失败: {e}")
            error_message = str(e)
            article = db.query(Article).filter(Article.id == article_id).first()
            if article:
                article.status = "failed"
                existing_analysis = (
                    db.query(AIAnalysis)
                    .filter(AIAnalysis.article_id == article_id)
                    .first()
                )
                if existing_analysis:
                    existing_analysis.error_message = error_message
                else:
                    ai_analysis = AIAnalysis(
                        article_id=article.id, error_message=error_message
                    )
                    db.add(ai_analysis)
                db.commit()
        finally:
            db.close()

    def get_articles(
        self,
        db: Session,
        page: int = 1,
        size: int = 20,
        category_id: str = None,
        search: str = None,
        source_domain: str = None,
        author: str = None,
        published_at_start: str = None,
        published_at_end: str = None,
        created_at_start: str = None,
        created_at_end: str = None,
        sort_by: str = "created_at_desc",
        is_admin: bool = False,
    ):
        from sqlalchemy import func

        query = db.query(Article)

        if not is_admin:
            query = query.filter(Article.is_visible == True)

        if category_id:
            query = query.filter(Article.category_id == category_id)
        if search:
            query = query.filter(Article.title.contains(search))
        if source_domain:
            query = query.filter(Article.source_domain == source_domain)
        if author:
            query = query.filter(Article.author == author)
        if published_at_start:
            query = query.filter(
                func.substr(Article.published_at, 1, 10) >= published_at_start
            )
        if published_at_end:
            query = query.filter(
                func.substr(Article.published_at, 1, 10) <= published_at_end
            )
        if created_at_start:
            query = query.filter(
                func.substr(Article.created_at, 1, 10) >= created_at_start
            )
        if created_at_end:
            query = query.filter(
                func.substr(Article.created_at, 1, 10) <= created_at_end
            )

        total = query.count()

        # Apply sorting based on sort_by parameter
        if sort_by == "created_at_desc":
            query = query.order_by(Article.created_at.desc())
        else:  # Default: published_at_desc
            query = query.order_by(
                Article.published_at.desc().nullslast(), Article.created_at.desc()
            )

        query = query.offset((page - 1) * size).limit(size)

        articles = query.all()
        return articles, total

    def get_article(self, db: Session, article_id: str):
        return db.query(Article).filter(Article.id == article_id).first()

    def export_articles(self, db: Session, article_ids: list):
        articles = db.query(Article).filter(Article.id.in_(article_ids)).all()

        categories_dict = {}
        uncategorized = []

        for article in articles:
            if article.category:
                cat_name = article.category.name
                if cat_name not in categories_dict:
                    categories_dict[cat_name] = []
                categories_dict[cat_name].append(article)
            else:
                uncategorized.append(article)

        markdown_content = ""

        for cat_name, cat_articles in categories_dict.items():
            markdown_content += f"## {cat_name}\n\n"
            for article in cat_articles:
                markdown_content += (
                    f"### [{article.title}]({article.source_url or ''})\n\n"
                )
                if article.top_image:
                    markdown_content += f"![]({article.top_image})\n\n"
                if article.ai_analysis:
                    # 优先使用关键内容，没有则使用摘要
                    if article.ai_analysis.key_points:
                        markdown_content += f"{article.ai_analysis.key_points}\n\n"
                    elif article.ai_analysis.summary:
                        markdown_content += f"{article.ai_analysis.summary}\n\n"

        if uncategorized:
            markdown_content += "## 未分类\n\n"
            for article in uncategorized:
                markdown_content += (
                    f"### [{article.title}]({article.source_url or ''})\n\n"
                )
                if article.top_image:
                    markdown_content += f"![]({article.top_image})\n\n"
                if article.ai_analysis:
                    # 优先使用关键内容，没有则使用摘要
                    if article.ai_analysis.key_points:
                        markdown_content += f"{article.ai_analysis.key_points}\n\n"
                    elif article.ai_analysis.summary:
                        markdown_content += f"{article.ai_analysis.summary}\n\n"

        return markdown_content

    async def retry_article_ai(self, db: Session, article_id: str) -> str:
        article = db.query(Article).filter(Article.id == article_id).first()

        if not article:
            raise ValueError("Article not found")

        article.status = "pending"
        if article.ai_analysis:
            article.ai_analysis.error_message = None
        db.commit()

        import asyncio

        asyncio.create_task(self.process_article_ai(article_id, article.category_id))

        return article_id

    async def retry_article_translation(self, db: Session, article_id: str) -> str:
        """重新生成文章翻译"""
        article = db.query(Article).filter(Article.id == article_id).first()

        if not article:
            raise ValueError("文章不存在")

        if not article.content_md:
            raise ValueError("文章内容为空，无法翻译")

        if not is_english_content(article.content_md):
            raise ValueError("文章不是英文内容，无需翻译")

        article.translation_status = "pending"
        article.translation_error = None
        db.commit()

        import asyncio

        asyncio.create_task(
            self.process_article_translation(article_id, article.category_id)
        )

        return article_id

    async def process_article_translation(self, article_id: str, category_id: str):
        """单独处理文章翻译"""
        from models import SessionLocal
        import asyncio

        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            article.translation_status = "processing"
            article.translation_error = None
            db.commit()

            # 获取AI配置
            ai_config = self.get_ai_config(db, category_id)
            if not ai_config:
                article.translation_status = "failed"
                article.translation_error = "未配置AI服务，请先在配置页面设置AI参数"
                db.commit()
                return

            ai_client = self.create_ai_client(ai_config)

            # 获取翻译类型的提示词配置
            trans_config = self.get_ai_config(
                db, category_id, prompt_type="translation"
            )
            trans_prompt = None
            trans_parameters = {}

            if trans_config:
                trans_prompt = trans_config.get("prompt_template")
                trans_parameters = trans_config.get("parameters") or {}
                if trans_config.get("base_url") and trans_config.get("api_key"):
                    trans_client = self.create_ai_client(trans_config)
                else:
                    trans_client = ai_client
            else:
                trans_client = ai_client

            try:
                content_trans = await asyncio.wait_for(
                    trans_client.translate_to_chinese(
                        article.content_md,
                        prompt=trans_prompt,
                        parameters=trans_parameters,
                    ),
                    timeout=300.0,
                )
                article.content_trans = content_trans
                article.translation_status = "completed"
                article.translation_error = None
                print(f"翻译完成: {article.title}")
            except asyncio.TimeoutError:
                article.translation_status = "failed"
                article.translation_error = "翻译超时，请稍后重试"
                print(f"翻译超时: {article.title}")
            except Exception as e:
                article.translation_status = "failed"
                article.translation_error = str(e)
                print(f"翻译失败: {article.title}, 错误: {e}")

            db.commit()
        except Exception as e:
            print(f"翻译处理失败: {e}")
            article = db.query(Article).filter(Article.id == article_id).first()
            if article:
                article.translation_status = "failed"
                article.translation_error = str(e)
                db.commit()
        finally:
            db.close()

    async def generate_ai_content(
        self,
        db: Session,
        article_id: str,
        content_type: str,
        model_config_id: str = None,
        prompt_config_id: str = None,
    ):
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            raise ValueError("文章不存在")

        if not article.content_md:
            raise ValueError("文章内容为空")

        if not article.ai_analysis:
            ai_analysis = AIAnalysis(article_id=article.id)
            db.add(ai_analysis)
            db.commit()
            db.refresh(article)

        setattr(article.ai_analysis, f"{content_type}_status", "pending")
        db.commit()

        import asyncio

        asyncio.create_task(
            self.process_ai_content(
                article_id,
                article.category_id,
                content_type,
                model_config_id=model_config_id,
                prompt_config_id=prompt_config_id,
            )
        )

    async def process_ai_content(
        self,
        article_id: str,
        category_id: str,
        content_type: str,
        model_config_id: str = None,
        prompt_config_id: str = None,
    ):
        from models import SessionLocal
        import asyncio

        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article or not article.ai_analysis:
                return

            setattr(article.ai_analysis, f"{content_type}_status", "processing")
            db.commit()

            ai_config = None
            prompt = None
            prompt_parameters = {}

            if model_config_id:
                model_config = (
                    db.query(ModelAPIConfig)
                    .filter(ModelAPIConfig.id == model_config_id)
                    .first()
                )
                if model_config:
                    ai_config = {
                        "base_url": model_config.base_url,
                        "api_key": model_config.api_key,
                        "model_name": model_config.model_name,
                    }

            if prompt_config_id:
                prompt_config = (
                    db.query(PromptConfig)
                    .filter(PromptConfig.id == prompt_config_id)
                    .first()
                )
                if prompt_config:
                    prompt = prompt_config.prompt
                    prompt_parameters = build_parameters(prompt_config)
                    if not ai_config and prompt_config.model_api_config_id:
                        model_config = (
                            db.query(ModelAPIConfig)
                            .filter(
                                ModelAPIConfig.id == prompt_config.model_api_config_id
                            )
                            .first()
                        )
                        if model_config:
                            ai_config = {
                                "base_url": model_config.base_url,
                                "api_key": model_config.api_key,
                                "model_name": model_config.model_name,
                            }

            if not ai_config:
                default_config = self.get_ai_config(
                    db, category_id, prompt_type=content_type
                )
                if default_config:
                    ai_config = default_config
                    if not prompt:
                        prompt = default_config.get("prompt_template")

            if not ai_config:
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = (
                    "未配置AI服务，请先在配置页面设置AI参数"
                )
                db.commit()
                return

            ai_client = self.create_ai_client(ai_config)
            parameters = ai_config.get("parameters") or {}
            if prompt_parameters:
                parameters = {**parameters, **prompt_parameters}

            try:
                result = await asyncio.wait_for(
                    ai_client.generate_summary(
                        article.content_md, prompt=prompt, parameters=parameters
                    ),
                    timeout=300.0,
                )
                setattr(article.ai_analysis, content_type, result)
                setattr(article.ai_analysis, f"{content_type}_status", "completed")
                article.ai_analysis.error_message = None
                print(f"{content_type} 生成完成: {article.title}")
            except asyncio.TimeoutError:
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = "AI生成超时，请稍后重试"
                print(f"{content_type} 生成超时: {article.title}")
            except Exception as e:
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = str(e)
                print(f"{content_type} 生成失败: {article.title}, 错误: {e}")

            db.commit()
        except Exception as e:
            print(f"{content_type} 处理失败: {e}")
            article = db.query(Article).filter(Article.id == article_id).first()
            if article and article.ai_analysis:
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = str(e)
                db.commit()
        finally:
            db.close()
