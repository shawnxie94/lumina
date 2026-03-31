# AI Output Protocol Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify AI task execution around code-owned output protocols while moving classification, tagging, and content validation onto fixed structured JSON contracts.

**Architecture:** Add a protocol layer inside the backend AI pipeline that maps `prompt_type` to a fixed output contract and parser. Structured tasks will ignore user-configured `response_format` and instead use code-owned JSON schema contracts, while text tasks continue using fixed text-oriented protocols. Existing task execution and usage logging stay in place.

**Tech Stack:** Python 3.11, FastAPI backend, SQLAlchemy, pytest, OpenAI chat completions

---

### Task 1: Add protocol-level regression tests

**Files:**
- Modify: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`
- Test: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`

- [ ] **Step 1: Write the failing test**

```python
def test_get_prompt_output_contract_returns_structured_contracts():
    service = ArticleAIPipelineService()

    classification = service._get_prompt_output_contract("classification")
    tagging = service._get_prompt_output_contract("tagging")
    validation = service._get_prompt_output_contract("content_validation")

    assert classification.response_format["type"] == "json_schema"
    assert tagging.response_format["type"] == "json_schema"
    assert validation.response_format["type"] == "json_schema"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`
Expected: FAIL because `_get_prompt_output_contract` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```python
@dataclass(frozen=True)
class PromptOutputContract:
    mode: str
    response_format: dict[str, Any] | str | None


def _get_prompt_output_contract(self, prompt_type: str) -> PromptOutputContract:
    ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`
Expected: PASS for the new contract test

### Task 2: Move classification and tagging onto fixed structured parsing

**Files:**
- Modify: `backend/app/domain/article_ai_pipeline_service.py`
- Modify: `backend/app/domain/article_tag_service.py`
- Modify: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`
- Test: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_process_article_classification_uses_structured_category_id(...):
    ...


def test_process_article_tagging_uses_structured_tag_list(...):
    ...
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`
Expected: FAIL because classification still expects plain text and tagging still relies on loose parsing

- [ ] **Step 3: Write minimal implementation**

```python
contract = self._get_prompt_output_contract("classification")
parameters = self._merge_protocol_parameters(config_parameters, contract)
parsed = self._parse_structured_task_result("classification", result)
category_output = parsed["category_id"].strip()
```

```python
contract = self._get_prompt_output_contract("tagging")
parameters = self._merge_protocol_parameters(config_parameters, contract)
parsed = self._parse_structured_task_result("tagging", result)
tag_names = article_tag_service.parse_tag_names(parsed["tags"])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`
Expected: PASS for classification/tagging tests

### Task 3: Move content validation onto the same protocol layer

**Files:**
- Modify: `backend/app/domain/article_ai_pipeline_service.py`
- Modify: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`
- Test: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`

- [ ] **Step 1: Write the failing test**

```python
def test_validate_content_uses_structured_validation_payload(...):
    ...
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`
Expected: FAIL because validation still directly parses ad-hoc JSON content

- [ ] **Step 3: Write minimal implementation**

```python
contract = self._get_prompt_output_contract("content_validation")
parameters = self._merge_protocol_parameters(config_parameters, contract)
parsed = self._parse_structured_task_result("content_validation", result)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`
Expected: PASS for validation protocol test

### Task 4: Hide response-format drift behind code-owned contracts

**Files:**
- Modify: `backend/app/domain/article_ai_pipeline_service.py`
- Modify: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`
- Test: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`

- [ ] **Step 1: Write the failing test**

```python
def test_structured_protocol_ignores_configured_text_response_format(...):
    ...
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`
Expected: FAIL because structured task configs can still drift via prompt-config `response_format`

- [ ] **Step 3: Write minimal implementation**

```python
def _merge_protocol_parameters(...):
    merged = {**(config_parameters or {})}
    if contract.response_format is not None:
        merged["response_format"] = contract.response_format
    return merged
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`
Expected: PASS with structured tasks always forcing protocol-owned response formats

### Task 5: Verify the focused backend slice

**Files:**
- Modify: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`
- Modify: `backend/app/domain/article_ai_pipeline_service.py`
- Modify: `backend/app/domain/article_tag_service.py`

- [ ] **Step 1: Run focused unit tests**

Run: `uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py tests/unit/core/test_db_migrations.py -q`
Expected: PASS

- [ ] **Step 2: Run broader backend unit tests if time permits**

Run: `uv run pytest tests/unit -q`
Expected: PASS or a short list of unrelated pre-existing failures

- [ ] **Step 3: Sanity-check docker startup path**

Run: `docker compose up -d api worker`
Expected: `lumina-api-1` and `lumina-worker-1` remain `Up`
