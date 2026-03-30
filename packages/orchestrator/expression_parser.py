from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from packages.protocol.events import RendererCommand, RendererCommandType


SUPPORTED_SQUARE_TAGS = {"smile", "thinking", "angry"}
SUPPORTED_ACTION_VALUES = {"nod", "shake_head"}
SUPPORTED_TONE_VALUES = {"soft"}


class OrchestratorModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        validate_assignment=True,
    )


class ParserState(str, Enum):
    TEXT = "text"
    IN_SQUARE_TAG = "in_square_tag"
    IN_ANGLE_TAG = "in_angle_tag"
    IN_VOICE_BLOCK = "in_voice_block"
    IN_SUBTITLE_BLOCK = "in_subtitle_block"
    IN_VOICE_CLOSE_TAG = "in_voice_close_tag"
    IN_SUBTITLE_CLOSE_TAG = "in_subtitle_close_tag"


class ParsedExpressionResult(OrchestratorModel):
    clean_text: str = ""
    voice_text: str = ""
    subtitle_text: str = ""
    renderer_commands: list[RendererCommand] = Field(default_factory=list)
    special_cues: list["StageCue"] = Field(default_factory=list)


class StageCueKind(str, Enum):
    RENDERER_COMMAND = "renderer_command"
    DELAY = "delay"


class StageCue(OrchestratorModel):
    kind: StageCueKind
    renderer_command: RendererCommand | None = None
    delay_ms: int | None = Field(default=None, ge=0, le=4_000)

    @model_validator(mode="after")
    def validate_shape(self) -> "StageCue":
        if self.kind == StageCueKind.RENDERER_COMMAND and self.renderer_command is None:
            raise ValueError("renderer_command cue requires renderer_command")
        if self.kind == StageCueKind.DELAY and self.delay_ms is None:
            raise ValueError("delay cue requires delay_ms")
        if self.kind == StageCueKind.RENDERER_COMMAND and self.delay_ms is not None:
            raise ValueError("renderer_command cue must not carry delay_ms")
        if self.kind == StageCueKind.DELAY and self.renderer_command is not None:
            raise ValueError("delay cue must not carry renderer_command")
        return self


class ExpressionParser:
    def __init__(self, max_tag_buffer_chars: int = 128) -> None:
        self.state = ParserState.TEXT
        self.text_buffer: list[str] = []
        self.tag_buffer: list[str] = []
        self.max_tag_buffer_chars = max_tag_buffer_chars
        self._dropping_tag = False
        self._voice_buffer: list[str] = []
        self._subtitle_buffer: list[str] = []
        self._close_tag_buffer: list[str] = []

    def feed(self, text: str) -> ParsedExpressionResult:
        clean_parts: list[str] = []
        voice_parts: list[str] = []
        subtitle_parts: list[str] = []
        commands: list[RendererCommand] = []
        special_cues: list[StageCue] = []

        for ch in text:
            if self.state == ParserState.TEXT:
                if ch == "[":
                    flushed = self.flush_text()
                    if flushed:
                        clean_parts.append(flushed)
                    self.state = ParserState.IN_SQUARE_TAG
                    self.tag_buffer = ["["]
                    self._dropping_tag = False
                elif ch == "<":
                    flushed = self.flush_text()
                    if flushed:
                        clean_parts.append(flushed)
                    self.state = ParserState.IN_ANGLE_TAG
                    self.tag_buffer = ["<"]
                    self._dropping_tag = False
                else:
                    self.text_buffer.append(ch)
                continue

            if self.state == ParserState.IN_SQUARE_TAG:
                if self._dropping_tag:
                    if ch == "]":
                        self._drop_tag_buffer()
                    continue

                self.tag_buffer.append(ch)
                if len(self.tag_buffer) > self.max_tag_buffer_chars:
                    self.tag_buffer.clear()
                    self._dropping_tag = True
                    continue
                if ch == "]":
                    cmd = self._parse_square_tag("".join(self.tag_buffer))
                    if cmd is not None:
                        commands.append(cmd)
                        special_cues.append(
                            StageCue(
                                kind=StageCueKind.RENDERER_COMMAND,
                                renderer_command=cmd,
                            )
                        )
                    self._drop_tag_buffer()
                continue

            if self.state == ParserState.IN_ANGLE_TAG:
                if self._dropping_tag:
                    if ch == ">":
                        self._drop_tag_buffer()
                    continue

                self.tag_buffer.append(ch)
                if len(self.tag_buffer) > self.max_tag_buffer_chars:
                    self.tag_buffer.clear()
                    self._dropping_tag = True
                    continue
                if ch == ">":
                    tag_str = "".join(self.tag_buffer)
                    if tag_str.lower() == "<voice>":
                        self._drop_tag_buffer()
                        self.state = ParserState.IN_VOICE_BLOCK
                        self._voice_buffer.clear()
                        continue
                    if tag_str.lower() == "<subtitle>":
                        self._drop_tag_buffer()
                        self.state = ParserState.IN_SUBTITLE_BLOCK
                        self._subtitle_buffer.clear()
                        continue
                    cue = self._parse_angle_tag(tag_str)
                    if cue is not None:
                        special_cues.append(cue)
                        if cue.renderer_command is not None:
                            commands.append(cue.renderer_command)
                    self._drop_tag_buffer()
                continue

            if self.state == ParserState.IN_VOICE_BLOCK:
                if ch == "<":
                    self.state = ParserState.IN_VOICE_CLOSE_TAG
                    self._close_tag_buffer = ["<"]
                else:
                    self._voice_buffer.append(ch)
                continue

            if self.state == ParserState.IN_VOICE_CLOSE_TAG:
                self._close_tag_buffer.append(ch)
                if ch == ">":
                    close_str = "".join(self._close_tag_buffer)
                    if close_str.lower() == "</voice>":
                        voice_parts.append("".join(self._voice_buffer))
                        self._voice_buffer.clear()
                        self._close_tag_buffer.clear()
                        self.state = ParserState.TEXT
                    else:
                        self._voice_buffer.extend(self._close_tag_buffer)
                        self._close_tag_buffer.clear()
                        self.state = ParserState.IN_VOICE_BLOCK
                elif len(self._close_tag_buffer) > 16:
                    self._voice_buffer.extend(self._close_tag_buffer)
                    self._close_tag_buffer.clear()
                    self.state = ParserState.IN_VOICE_BLOCK
                continue

            if self.state == ParserState.IN_SUBTITLE_BLOCK:
                if ch == "<":
                    self.state = ParserState.IN_SUBTITLE_CLOSE_TAG
                    self._close_tag_buffer = ["<"]
                else:
                    self._subtitle_buffer.append(ch)
                continue

            if self.state == ParserState.IN_SUBTITLE_CLOSE_TAG:
                self._close_tag_buffer.append(ch)
                if ch == ">":
                    close_str = "".join(self._close_tag_buffer)
                    if close_str.lower() == "</subtitle>":
                        subtitle_parts.append("".join(self._subtitle_buffer))
                        self._subtitle_buffer.clear()
                        self._close_tag_buffer.clear()
                        self.state = ParserState.TEXT
                    else:
                        self._subtitle_buffer.extend(self._close_tag_buffer)
                        self._close_tag_buffer.clear()
                        self.state = ParserState.IN_SUBTITLE_BLOCK
                elif len(self._close_tag_buffer) > 20:
                    self._subtitle_buffer.extend(self._close_tag_buffer)
                    self._close_tag_buffer.clear()
                    self.state = ParserState.IN_SUBTITLE_BLOCK
                continue

        if self.state == ParserState.TEXT:
            flushed = self.flush_text()
            if flushed:
                clean_parts.append(flushed)

        return ParsedExpressionResult(
            clean_text="".join(clean_parts),
            voice_text="".join(voice_parts),
            subtitle_text="".join(subtitle_parts),
            renderer_commands=commands,
            special_cues=special_cues,
        )

    def flush_text(self) -> str:
        if not self.text_buffer:
            return ""
        data = "".join(self.text_buffer)
        self.text_buffer.clear()
        return data

    def end_of_stream(self) -> ParsedExpressionResult:
        voice_text = ""
        subtitle_text = ""
        if self.state in (
            ParserState.IN_VOICE_BLOCK,
            ParserState.IN_VOICE_CLOSE_TAG,
        ):
            self._voice_buffer.extend(self._close_tag_buffer)
            self._close_tag_buffer.clear()
            voice_text = "".join(self._voice_buffer)
            self._voice_buffer.clear()
        elif self.state in (
            ParserState.IN_SUBTITLE_BLOCK,
            ParserState.IN_SUBTITLE_CLOSE_TAG,
        ):
            self._subtitle_buffer.extend(self._close_tag_buffer)
            self._close_tag_buffer.clear()
            subtitle_text = "".join(self._subtitle_buffer)
            self._subtitle_buffer.clear()
        elif self.state != ParserState.TEXT:
            self._drop_tag_buffer()

        self.state = ParserState.TEXT

        return ParsedExpressionResult(
            clean_text=self.flush_text(),
            voice_text=voice_text,
            subtitle_text=subtitle_text,
            renderer_commands=[],
        )

    def _drop_tag_buffer(self) -> None:
        self.tag_buffer.clear()
        self.state = ParserState.TEXT
        self._dropping_tag = False

    def _parse_square_tag(self, token: str) -> RendererCommand | None:
        if not (token.startswith("[") and token.endswith("]")):
            return None

        name = token[1:-1].strip()
        if not name or " " in name or "\n" in name:
            return None

        return RendererCommand(
            command_type=RendererCommandType.SET_EXPRESSION,
            target="expression",
            value=name.lower(),
            intensity=1.0,
            is_interruptible=True,
        )

    def _parse_angle_tag(self, token: str) -> StageCue | None:
        if not (token.startswith("<") and token.endswith(">")):
            return None

        body = token[1:-1].strip()
        if "=" not in body:
            return None

        key, value = body.split("=", 1)
        key = key.strip().lower()
        value = value.strip()

        if key == "action" and value:
            return StageCue(
                kind=StageCueKind.RENDERER_COMMAND,
                renderer_command=RendererCommand(
                    command_type=RendererCommandType.SET_MOTION,
                    target="motion",
                    value=value,
                    intensity=1.0,
                    is_interruptible=True,
                ),
            )

        if key == "tone" and value.lower() in SUPPORTED_TONE_VALUES:
            return StageCue(
                kind=StageCueKind.RENDERER_COMMAND,
                renderer_command=RendererCommand(
                    command_type=RendererCommandType.SET_EXPRESSION,
                    target="tone",
                    value=value.lower(),
                    intensity=1.0,
                    is_interruptible=True,
                ),
            )

        if key == "delay":
            try:
                delay_ms = int(value)
            except ValueError:
                return None
            if delay_ms < 0 or delay_ms > 4_000:
                return None
            return StageCue(
                kind=StageCueKind.DELAY,
                delay_ms=delay_ms,
            )

        return None
