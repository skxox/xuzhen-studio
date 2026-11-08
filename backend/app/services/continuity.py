import re

from pydantic import ValidationError

from ..domain.contracts import ContinuityReportCandidate


class ContinuityReportError(ValueError):
    """Raised when a continuity report fails schema or evidence checks."""


def parse_continuity_report(
    content: str,
    chapter_start: int,
    chapter_end: int,
    chapter_texts: dict[int, str],
    *,
    allow_review_decisions: bool,
) -> ContinuityReportCandidate:
    try:
        report = ContinuityReportCandidate.model_validate_json(content)
    except ValidationError as error:
        raise ContinuityReportError("审校报告格式无效，请重新生成或修复结构。") from error
    if report.chapter_start != chapter_start or report.chapter_end != chapter_end:
        raise ContinuityReportError("审校报告范围与本次任务范围不一致。")
    expected_chapters = set(range(chapter_start, chapter_end + 1))
    allowed_context = {chapter_start - 1} if chapter_start > 1 else set()
    if (
        chapter_start > chapter_end
        or not expected_chapters.issubset(chapter_texts)
        or set(chapter_texts) - expected_chapters - allowed_context
    ):
        raise ContinuityReportError("审校范围章节缺失或不连续。")
    finding_ids: set[str] = set()
    for finding in report.findings:
        if finding.finding_id in finding_ids:
            raise ContinuityReportError("审校问题编号重复。")
        finding_ids.add(finding.finding_id)
        if not chapter_start <= finding.chapter_ordinal <= chapter_end:
            raise ContinuityReportError("审校问题引用了所选范围之外的章节。")
        if not allow_review_decisions and finding.status != "open":
            raise ContinuityReportError("模型生成的问题初始状态必须为 open。")
        if finding.status != "open" and not finding.resolution_note:
            raise ContinuityReportError("已处理或接受风险的问题必须填写处理说明。")
        if not _contains_quote(chapter_texts[finding.chapter_ordinal], finding.evidence_quote):
            raise ContinuityReportError("审校问题的原文证据未能在对应章节中定位。")
        if finding.related_chapter_ordinal is not None:
            if finding.related_chapter_ordinal not in chapter_texts:
                raise ContinuityReportError("关联证据引用了所选范围之外的章节。")
            if not _contains_quote(
                chapter_texts[finding.related_chapter_ordinal],
                finding.related_evidence_quote or "",
            ):
                raise ContinuityReportError("关联原文证据未能在对应章节中定位。")
    return report


def unresolved_high_findings(report: ContinuityReportCandidate) -> list[str]:
    return [
        finding.finding_id
        for finding in report.findings
        if finding.severity == "high" and finding.status == "open"
    ]


def unresolved_medium_findings(report: ContinuityReportCandidate) -> list[str]:
    return [
        finding.finding_id
        for finding in report.findings
        if finding.severity == "medium" and finding.status == "open"
    ]


def _contains_quote(chapter: str, quote: str) -> bool:
    normalized_quote = re.sub(r"\s+", " ", quote).strip()
    normalized_chapter = re.sub(r"\s+", " ", chapter).strip()
    return bool(normalized_quote) and normalized_quote in normalized_chapter
