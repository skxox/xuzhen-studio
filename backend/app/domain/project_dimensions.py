"""项目创作维度领域规则（功能卡 D-01a）。

生产平台功能规格把旧的单一 ``creation_mode`` 拆成三个独立维度：
内容来源 ``source_kind``、叙事形式 ``content_mode``、视频路径 ``video_mode``。
本模块集中维护取值、合法组合和旧模式桥接，供 API schema 与路由复用。
旧项目行的反向兼容映射由功能卡 D-01b 处理，这里只服务新项目创建。
"""

from typing import Literal

SourceKind = Literal[
    "ai_novel",  # AI 原创小说
    "existing_novel",  # 已有小说
    "finished_script",  # 成品剧本
    "product_material",  # 商品素材
    "creative_brief",  # 创意简报
]
ContentMode = Literal[
    "drama",  # 剧情演绎
    "narration",  # 旁白/解说
    "commercial",  # 广告短片
]
VideoMode = Literal[
    "storyboard_video",  # 分镜图生视频
    "reference_video",  # 参考图生视频
]

# 广告短片只允许从商品素材或创意简报出发（规格“商品/广告 → 成片”场景）。
COMMERCIAL_SOURCE_KINDS = frozenset({"product_material", "creative_brief"})
# 商品素材只用于广告叙事；小说与剧本类来源可走剧情或旁白。
COMMERCIAL_ONLY_SOURCE_KINDS = frozenset({"product_material"})


def dimension_field_errors(source_kind: str, content_mode: str) -> list[tuple[str, str]]:
    """返回维度组合的字段级错误 ``(字段名, 中文说明)``；空列表表示组合合法。

    所有来源×叙事组合错误都定位在 ``content_mode``：创建表单先选来源、后选叙事，
    与来源冲突的是叙事选择。视频路径没有跨维度限制，能力差异由 Provider 校验。
    """
    errors: list[tuple[str, str]] = []
    if content_mode == "commercial" and source_kind not in COMMERCIAL_SOURCE_KINDS:
        errors.append(
            (
                "content_mode",
                f"广告短片只支持内容来源“商品素材”或“创意简报”，当前 source_kind={source_kind}",
            )
        )
    if source_kind in COMMERCIAL_ONLY_SOURCE_KINDS and content_mode != "commercial":
        errors.append(
            (
                "content_mode",
                f"内容来源“商品素材”只支持广告短片叙事，当前 content_mode={content_mode}",
            )
        )
    return errors


def legacy_creation_mode(source_kind: str, content_mode: str) -> str:
    """新项目维度到旧 ``creation_mode`` 的确定性桥接。

    新项目按维度创建后，既有阶段路径与门禁仍读取 ``creation_mode``；
    D-01b 完成旧项目反向映射并改造各分支后，本函数与桥接列一并移除。
    """
    if source_kind == "ai_novel":
        return "original"
    if source_kind == "product_material":
        return "commercial"
    if source_kind == "creative_brief" and content_mode == "commercial":
        return "commercial"
    return "adaptation"
