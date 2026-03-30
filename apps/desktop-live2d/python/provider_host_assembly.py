from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from packages.llm.models import (
    LLMGenerationConfig,
    LLMModelProfile,
    LLMProviderDescriptor,
    LLMRouteBinding,
    LLMRouteKind,
)
from packages.llm.openai_compatible_local_provider import (
    OpenAICompatibleLocalAuthMode,
    OpenAICompatibleLocalProvider,
    OpenAICompatibleLocalProviderConfig,
    OpenAICompatibleLocalTransportPort,
)
from packages.llm.openai_responses_provider import (
    OpenAIResponsesProvider,
    OpenAIResponsesProviderConfig,
    OpenAIResponsesTransportPort,
)
from packages.llm.registry import LLMProviderRegistry
from packages.llm.service import LLMService
from packages.orchestrator.audio_mutex import OrchestratorConfig
from packages.renderer.desktop_live2d_bridge import (
    DesktopLive2DBridgeConfig,
    DesktopLive2DBridgeTransportPort,
    DesktopLive2DModelAssetRef,
)
from packages.runtime.desktop_companion_session_service import (
    DesktopCompanionSessionService,
    DesktopCompanionSessionServiceConfig,
)
from packages.tts.models import (
    TTSProviderProfile,
    TTSSynthesisConfig,
    TTSVoiceEnrollmentRequest,
    TTSVoiceEnrollmentResult,
    TTSVoiceProfile,
)
from packages.tts.qwen3_voice_clone_provider import (
    Qwen3VoiceCloneProvider,
    Qwen3VoiceCloneProviderConfig,
    Qwen3VoiceCloneTransportPort,
)
from packages.tts.registry import TTSProviderRegistry
from packages.tts.service import TTSService

try:  # pragma: no cover - import fallback for script-mode host execution
    from .provider_settings import (
        DesktopLocalFastLLMSettings,
        DesktopProviderComponentReadiness,
        DesktopProviderReadinessSnapshot,
        DesktopProviderSettingsDocument,
        DesktopTTSVoiceEnrollmentRequest,
    )
except ImportError:  # pragma: no cover - script fallback
    from provider_settings import (
        DesktopLocalFastLLMSettings,
        DesktopProviderComponentReadiness,
        DesktopProviderReadinessSnapshot,
        DesktopProviderSettingsDocument,
        DesktopTTSVoiceEnrollmentRequest,
    )


DESKTOP_LOCAL_INTENT_PROFILE_KEY = "desktop.local.intent"
DESKTOP_LOCAL_QUICK_PROFILE_KEY = "desktop.local.quick"
DESKTOP_LOCAL_PRIMARY_PROFILE_KEY = "desktop.local.primary"
DESKTOP_CLOUD_PRIMARY_PROFILE_KEY = "desktop.cloud.primary"
DESKTOP_LOCAL_FAST_LLM_PROVIDER_KEY = "desktop.local.openai_compatible"
DESKTOP_CLOUD_LLM_PROVIDER_KEY = "desktop.openai.responses"
DESKTOP_QWEN_TTS_PROVIDER_KEY = "desktop.qwen3.voice_clone"
AVATAR_MODEL_SELECTION_FILE_NAME = "desktop-live2d-avatar-model.json"


class DesktopCompanionHostAssemblyError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class DesktopCompanionHostProviderTransports:
    local_fast_llm_transport: OpenAICompatibleLocalTransportPort | None = None
    cloud_primary_llm_transport: OpenAIResponsesTransportPort | None = None
    qwen_tts_transport: Qwen3VoiceCloneTransportPort | None = None


class DesktopCompanionHostAssembler:
    def __init__(
        self,
        *,
        workspace_root: str | Path,
        user_data_dir: str | Path,
        desktop_bridge_config: DesktopLive2DBridgeConfig,
        session_id: UUID,
        active_model_key: str | None = None,
        tts_voice_profile_key_override: str | None = None,
        provider_transports: DesktopCompanionHostProviderTransports | None = None,
        session_kind: str = "direct",
        suppress_bubble_and_expression: bool = False,
    ) -> None:
        self._workspace_root = Path(workspace_root).resolve()
        self._user_data_dir = Path(user_data_dir).resolve()
        self._desktop_bridge_config = desktop_bridge_config
        self._session_id = session_id
        self._active_model_key = active_model_key.strip() if isinstance(active_model_key, str) and active_model_key.strip() else None
        self._tts_voice_profile_key_override = (
            tts_voice_profile_key_override.strip()
            if isinstance(tts_voice_profile_key_override, str)
            and tts_voice_profile_key_override.strip()
            else None
        )
        self._session_kind = (
            session_kind.strip()
            if isinstance(session_kind, str) and session_kind.strip()
            else "direct"
        )
        self._suppress_bubble_and_expression = suppress_bubble_and_expression
        self._provider_transports = (
            provider_transports or DesktopCompanionHostProviderTransports()
        )

    def build_readiness(
        self,
        settings: DesktopProviderSettingsDocument,
    ) -> DesktopProviderReadinessSnapshot:
        local_ready, local_message = self._check_local_fast_llm_readiness(settings)
        cloud_ready, cloud_message = self._check_cloud_primary_llm_readiness(settings)
        qwen_ready, qwen_message = self._check_qwen_tts_readiness(settings)

        runtime_ready = cloud_ready and qwen_ready
        if runtime_ready and local_ready:
            runtime_message = (
                "desktop companion host is ready with optional local fast LLM acceleration"
            )
        elif runtime_ready:
            runtime_message = (
                "desktop companion host is ready; optional local fast LLM acceleration "
                "is unavailable"
            )
        else:
            runtime_message = "desktop companion host production provider stack is not ready yet"

        return DesktopProviderReadinessSnapshot(
            runtime_ready=runtime_ready,
            runtime_message=runtime_message,
            local_fast_llm=DesktopProviderComponentReadiness(
                ready=local_ready,
                message=local_message,
            ),
            cloud_primary_llm=DesktopProviderComponentReadiness(
                ready=cloud_ready,
                message=cloud_message,
            ),
            qwen_tts=DesktopProviderComponentReadiness(
                ready=qwen_ready,
                message=qwen_message,
            ),
            voice_enrollment=DesktopProviderComponentReadiness(
                ready=qwen_ready,
                message=(
                    "Qwen3 voice enrollment can run with the current settings"
                    if qwen_ready
                    else "Qwen3 voice enrollment requires a ready TTS provider configuration"
                ),
            ),
        )

    def resolve_active_model_key(self) -> str | None:
        if self._active_model_key is not None:
            return self._active_model_key
        registry_path = (
            self._workspace_root
            / "apps"
            / "desktop-live2d"
            / "assets"
            / "models"
            / "model_library_registry.json"
        )
        if not registry_path.is_file():
            return self._load_selected_model_key()
        registry = json.loads(registry_path.read_text("utf-8"))
        selected_key = self._load_selected_model_key()
        if selected_key:
            return selected_key
        default_key = registry.get("default_model_key")
        if isinstance(default_key, str):
            normalized = default_key.strip()
            return normalized or None
        return None

    def build_session_service(
        self,
        *,
        settings: DesktopProviderSettingsDocument,
        transport: DesktopLive2DBridgeTransportPort,
        transcript_source=None,
    ) -> DesktopCompanionSessionService:
        readiness = self.build_readiness(settings)
        if not readiness.runtime_ready:
            raise DesktopCompanionHostAssemblyError(readiness.runtime_message)

        return DesktopCompanionSessionService(
            config=self._build_service_config(settings),
            llm_service=self.build_real_llm_service(settings),
            tts_service=self.build_real_tts_service(settings),
            transport=transport,
            transcript_source=transcript_source,
        )

    def build_real_llm_service(
        self,
        settings: DesktopProviderSettingsDocument,
    ) -> LLMService:
        cloud_settings = settings.cloud_primary_llm
        local_settings = self._resolve_local_fast_llm_settings_for_assembly(settings)

        registry = LLMProviderRegistry()
        cloud_provider = OpenAIResponsesProvider(
            OpenAIResponsesProviderConfig(
                provider_key=DESKTOP_CLOUD_LLM_PROVIDER_KEY,
                base_url=cloud_settings.base_url,
                api_key=cloud_settings.api_key or "__missing_api_key__",
                request_timeout_ms=cloud_settings.request_timeout_ms,
                organization_id=cloud_settings.organization_id,
                project_id=cloud_settings.project_id,
            ),
            transport=self._provider_transports.cloud_primary_llm_transport,
        )
        registry.register_provider(
            LLMProviderDescriptor(
                provider_key=DESKTOP_CLOUD_LLM_PROVIDER_KEY,
                display_name="Desktop OpenAI Responses",
                supports_one_shot=True,
                supports_streaming=True,
                supports_structured_intent_routing=False,
                supports_tool_reasoning=False,
                allowed_routes=(
                    LLMRouteKind.QUICK_REACTION,
                    LLMRouteKind.PRIMARY_RESPONSE,
                ),
            ),
            cloud_provider,
        )
        registry.register_profile(
            LLMModelProfile(
                profile_key=DESKTOP_CLOUD_PRIMARY_PROFILE_KEY,
                provider_key=DESKTOP_CLOUD_LLM_PROVIDER_KEY,
                model_name=cloud_settings.primary_model_name,
                default_generation_config=LLMGenerationConfig(
                    max_output_tokens=512,
                    timeout_ms=cloud_settings.request_timeout_ms,
                ),
            )
        )
        registry.bind_route(
            LLMRouteBinding(
                route_kind=LLMRouteKind.PRIMARY_RESPONSE,
                profile_key=DESKTOP_CLOUD_PRIMARY_PROFILE_KEY,
            )
        )

        if local_settings is None:
            registry.bind_route(
                LLMRouteBinding(
                    route_kind=LLMRouteKind.QUICK_REACTION,
                    profile_key=DESKTOP_CLOUD_PRIMARY_PROFILE_KEY,
                )
            )
            return LLMService(registry)

        local_provider = OpenAICompatibleLocalProvider(
            OpenAICompatibleLocalProviderConfig(
                provider_key=DESKTOP_LOCAL_FAST_LLM_PROVIDER_KEY,
                display_name="Desktop Local Fast LLM",
                base_url=local_settings.base_url,
                default_model_name=local_settings.quick_model_name,
                request_timeout_ms=local_settings.request_timeout_ms,
                auth_mode=local_settings.auth_mode,
                api_key=local_settings.api_key,
            ),
            transport=self._provider_transports.local_fast_llm_transport,
        )
        registry.register_provider(
            LLMProviderDescriptor(
                provider_key=DESKTOP_LOCAL_FAST_LLM_PROVIDER_KEY,
                display_name="Desktop Local Fast LLM",
                supports_one_shot=True,
                supports_streaming=True,
                supports_structured_intent_routing=True,
                supports_tool_reasoning=False,
                allowed_routes=(
                    LLMRouteKind.INTENT_ROUTING,
                    LLMRouteKind.QUICK_REACTION,
                    LLMRouteKind.AMBIENT_PRESENCE,
                    LLMRouteKind.PRIMARY_RESPONSE,
                ),
            ),
            local_provider,
        )
        registry.register_profile(
            LLMModelProfile(
                profile_key=DESKTOP_LOCAL_INTENT_PROFILE_KEY,
                provider_key=DESKTOP_LOCAL_FAST_LLM_PROVIDER_KEY,
                model_name=local_settings.intent_model_name,
                default_generation_config=LLMGenerationConfig(
                    max_output_tokens=32,
                    timeout_ms=local_settings.request_timeout_ms,
                ),
            )
        )
        registry.register_profile(
            LLMModelProfile(
                profile_key=DESKTOP_LOCAL_QUICK_PROFILE_KEY,
                provider_key=DESKTOP_LOCAL_FAST_LLM_PROVIDER_KEY,
                model_name=local_settings.quick_model_name,
                default_generation_config=LLMGenerationConfig(
                    max_output_tokens=64,
                    timeout_ms=local_settings.request_timeout_ms,
                ),
            )
        )
        registry.register_profile(
            LLMModelProfile(
                profile_key=DESKTOP_LOCAL_PRIMARY_PROFILE_KEY,
                provider_key=DESKTOP_LOCAL_FAST_LLM_PROVIDER_KEY,
                model_name=local_settings.local_primary_model_name,
                default_generation_config=LLMGenerationConfig(
                    max_output_tokens=256,
                    timeout_ms=local_settings.request_timeout_ms,
                ),
            )
        )
        registry.bind_route(
            LLMRouteBinding(
                route_kind=LLMRouteKind.INTENT_ROUTING,
                profile_key=DESKTOP_LOCAL_INTENT_PROFILE_KEY,
            )
        )
        registry.bind_route(
            LLMRouteBinding(
                route_kind=LLMRouteKind.QUICK_REACTION,
                profile_key=DESKTOP_LOCAL_QUICK_PROFILE_KEY,
            )
        )
        return LLMService(registry)

    def build_real_tts_service(
        self,
        settings: DesktopProviderSettingsDocument,
    ) -> TTSService:
        tts_settings = settings.qwen_tts
        provider = Qwen3VoiceCloneProvider(
            config=Qwen3VoiceCloneProviderConfig(
                provider_key=DESKTOP_QWEN_TTS_PROVIDER_KEY,
                base_url=tts_settings.base_url,
                api_key=tts_settings.api_key or "__missing_api_key__",
                request_timeout_ms=tts_settings.request_timeout_ms,
                standard_model_id=tts_settings.standard_model_id,
                standard_voice_id=tts_settings.standard_voice_id,
                realtime_model_id=tts_settings.realtime_model_id,
                realtime_voice_id=tts_settings.realtime_voice_id,
                default_media_type=tts_settings.preferred_media_type,
            ),
            transport=self._provider_transports.qwen_tts_transport,
        )
        registry = TTSProviderRegistry(
            providers=(provider,),
            voice_profiles=(
                TTSVoiceProfile(
                    voice_profile_key=tts_settings.voice_profile_key,
                    provider_key=DESKTOP_QWEN_TTS_PROVIDER_KEY,
                    display_name=tts_settings.voice_display_name,
                    provider_voice_id=tts_settings.standard_voice_id,
                    provider_realtime_voice_id=tts_settings.realtime_voice_id,
                ),
            ),
            provider_profiles=(
                TTSProviderProfile(
                    provider_profile_key=tts_settings.provider_profile_key,
                    provider_key=DESKTOP_QWEN_TTS_PROVIDER_KEY,
                    display_name="Desktop Qwen3 Voice Profile",
                    voice_profile_key=tts_settings.voice_profile_key,
                    synthesis_config=TTSSynthesisConfig(
                        timeout_ms=tts_settings.request_timeout_ms,
                        preferred_media_type=tts_settings.preferred_media_type,
                    ),
                    is_default=True,
                ),
            ),
        )
        return TTSService(registry)

    async def run_tts_voice_enrollment(
        self,
        *,
        settings: DesktopProviderSettingsDocument,
        request: DesktopTTSVoiceEnrollmentRequest,
    ) -> TTSVoiceEnrollmentResult:
        readiness = self.build_readiness(settings)
        if not readiness.qwen_tts.ready:
            raise DesktopCompanionHostAssemblyError(readiness.qwen_tts.message)

        service = self.build_real_tts_service(settings)
        return await service.enroll_voice(
            TTSVoiceEnrollmentRequest(
                provider_key=DESKTOP_QWEN_TTS_PROVIDER_KEY,
                display_name=request.display_name,
                reference_audio_path=request.reference_audio_path,
                realtime_reference_audio_path=request.realtime_reference_audio_path,
                prompt_text=request.prompt_text,
                prompt_language=request.prompt_language,
                voice_profile_key=(
                    request.voice_profile_key or settings.qwen_tts.voice_profile_key
                ),
            ),
            register_voice_profile=False,
        )

    def _build_service_config(
        self,
        settings: DesktopProviderSettingsDocument,
    ) -> DesktopCompanionSessionServiceConfig:
        return DesktopCompanionSessionServiceConfig(
            session_id=self._session_id,
            desktop_bridge_config=self._resolve_active_bridge_config(),
            orchestrator_config=self._build_orchestrator_config(settings),
            clear_bubble_after_turn_settlement=False,
            suppress_bubble_and_expression=self._suppress_bubble_and_expression,
            suppress_tts_output=self._session_kind == "story_narrator",
        )

    def _resolve_active_bridge_config(self) -> DesktopLive2DBridgeConfig:
        """Return a bridge config whose model_asset matches the selected avatar."""
        selected_key = self.resolve_active_model_key()
        if (
            not selected_key
            or selected_key == self._desktop_bridge_config.model_asset.model_key
        ):
            return self._desktop_bridge_config
        registry_path = (
            self._workspace_root
            / "apps"
            / "desktop-live2d"
            / "assets"
            / "models"
            / "model_library_registry.json"
        )
        if not registry_path.is_file():
            return self._desktop_bridge_config
        registry = json.loads(registry_path.read_text("utf-8"))
        manifest_rel = None
        for entry in registry.get("models", []):
            if entry.get("model_key") == selected_key:
                manifest_rel = entry.get("scene_manifest_repo_relative_path")
                break
        if not manifest_rel:
            return self._desktop_bridge_config
        manifest_path = self._workspace_root / manifest_rel
        if not manifest_path.is_file():
            return self._desktop_bridge_config
        manifest = json.loads(manifest_path.read_text("utf-8"))
        model_settings_file = manifest.get("model_settings_file_name", "")
        model_settings_rel = manifest.get("model_settings_repo_relative_path", "")
        if not model_settings_file or not model_settings_rel:
            return self._desktop_bridge_config
        new_asset = DesktopLive2DModelAssetRef(
            model_key=selected_key,
            repo_relative_model_json_path=model_settings_rel,
            display_name=manifest.get("display_name", selected_key),
        )
        return self._desktop_bridge_config.model_copy(
            update={"model_asset": new_asset}
        )

    def _build_orchestrator_config(
        self,
        settings: DesktopProviderSettingsDocument,
    ) -> OrchestratorConfig:
        local_settings = self._resolve_local_fast_llm_settings_for_assembly(settings)
        tts_voice_profile_key = (
            self._tts_voice_profile_key_override or settings.qwen_tts.voice_profile_key
        )
        tts_provider_profile_key = (
            None
            if self._tts_voice_profile_key_override is not None
            else settings.qwen_tts.provider_profile_key
        )
        suppress = self._suppress_bubble_and_expression
        return OrchestratorConfig(
            llm_intent_routing_profile_key=(
                DESKTOP_LOCAL_INTENT_PROFILE_KEY
                if local_settings is not None
                else None
            ),
            llm_quick_reaction_profile_key=(
                None
                if suppress
                else (
                    DESKTOP_LOCAL_QUICK_PROFILE_KEY
                    if local_settings is not None
                    else DESKTOP_CLOUD_PRIMARY_PROFILE_KEY
                )
            ),
            llm_local_primary_response_profile_key=(
                DESKTOP_LOCAL_PRIMARY_PROFILE_KEY
                if local_settings is not None
                else None
            ),
            llm_cloud_primary_response_profile_key=DESKTOP_CLOUD_PRIMARY_PROFILE_KEY,
            tts_quick_reaction_voice_profile_key=tts_voice_profile_key,
            tts_quick_reaction_provider_profile_key=tts_provider_profile_key,
            tts_primary_response_voice_profile_key=tts_voice_profile_key,
            tts_primary_response_provider_profile_key=tts_provider_profile_key,
            voice_language=settings.voice_language,
            subtitle_language=settings.subtitle_language,
            **self._load_active_model_capabilities(),
        )

    def _load_active_model_capabilities(
        self,
    ) -> dict[str, object]:
        """Read the selected model's scene_manifest.json and persona.md."""
        result: dict[str, object] = {
            "avatar_supported_expressions": (),
            "avatar_supported_motions": (),
            "avatar_persona_prompt": "",
        }
        registry_path = (
            self._workspace_root
            / "apps"
            / "desktop-live2d"
            / "assets"
            / "models"
            / "model_library_registry.json"
        )
        if not registry_path.is_file():
            return result
        registry = json.loads(registry_path.read_text("utf-8"))
        selected_key = self.resolve_active_model_key()
        if not selected_key:
            return result
        models = registry.get("models", [])
        manifest_rel = None
        for entry in models:
            if entry.get("model_key") == selected_key:
                manifest_rel = entry.get("scene_manifest_repo_relative_path")
                break
        if not manifest_rel:
            return result
        manifest_path = self._workspace_root / manifest_rel
        if not manifest_path.is_file():
            return result
        manifest = json.loads(manifest_path.read_text("utf-8"))
        expressions = manifest.get("supported_expressions", [])
        motions = manifest.get("supported_motions", [])
        if not self._suppress_bubble_and_expression and isinstance(expressions, list):
            result["avatar_supported_expressions"] = tuple(
                str(e) for e in expressions if isinstance(e, str) and e
            )
        if not self._suppress_bubble_and_expression and isinstance(motions, list):
            result["avatar_supported_motions"] = tuple(
                str(m) for m in motions if isinstance(m, str) and m
            )
        # Load persona.md from the model directory (same dir as scene_manifest.json)
        persona_path = manifest_path.parent / "persona.md"
        if self._session_kind != "story_narrator" and persona_path.is_file():
            persona_text = persona_path.read_text("utf-8").strip()
            # Cap at 2000 chars to avoid prompt bloat
            if len(persona_text) > 2000:
                persona_text = persona_text[:2000]
            result["avatar_persona_prompt"] = persona_text
        return result

    def _load_selected_model_key(self) -> str | None:
        selection_path = self._user_data_dir / AVATAR_MODEL_SELECTION_FILE_NAME
        if not selection_path.is_file():
            return None
        payload = json.loads(selection_path.read_text("utf-8"))
        if not isinstance(payload, dict):
            return None
        selected_model_key = payload.get("selected_model_key")
        if not isinstance(selected_model_key, str):
            return None
        normalized = selected_model_key.strip()
        return normalized or None

    def _check_local_fast_llm_readiness(
        self,
        settings: DesktopProviderSettingsDocument,
    ) -> tuple[bool, str]:
        local = settings.local_fast_llm
        if local is None:
            return False, "local fast LLM is not configured; cloud-only production path will be used"
        if (
            local.auth_mode == OpenAICompatibleLocalAuthMode.BEARER
            and local.api_key is None
        ):
            return (
                False,
                "local fast LLM bearer auth requires an api_key; cloud-only production path will be used",
            )
        return True, "local fast LLM is configured as an optional accelerator"

    def _check_cloud_primary_llm_readiness(
        self,
        settings: DesktopProviderSettingsDocument,
    ) -> tuple[bool, str]:
        cloud = settings.cloud_primary_llm
        if cloud.api_key is None:
            return False, "cloud primary LLM requires an api_key"
        return True, "cloud primary LLM settings are ready for assembly"

    def _check_qwen_tts_readiness(
        self,
        settings: DesktopProviderSettingsDocument,
    ) -> tuple[bool, str]:
        tts = settings.qwen_tts
        if tts.api_key is None:
            return False, "Qwen3 TTS requires an api_key"
        return True, "Qwen3 TTS settings are ready for assembly and enrollment"

    def _resolve_local_fast_llm_settings_for_assembly(
        self,
        settings: DesktopProviderSettingsDocument,
    ) -> DesktopLocalFastLLMSettings | None:
        local_ready, _ = self._check_local_fast_llm_readiness(settings)
        if not local_ready:
            return None
        return settings.local_fast_llm


__all__ = [
    "DESKTOP_CLOUD_LLM_PROVIDER_KEY",
    "DESKTOP_CLOUD_PRIMARY_PROFILE_KEY",
    "DESKTOP_LOCAL_FAST_LLM_PROVIDER_KEY",
    "DESKTOP_LOCAL_INTENT_PROFILE_KEY",
    "DESKTOP_LOCAL_PRIMARY_PROFILE_KEY",
    "DESKTOP_LOCAL_QUICK_PROFILE_KEY",
    "DESKTOP_QWEN_TTS_PROVIDER_KEY",
    "DesktopCompanionHostAssembler",
    "DesktopCompanionHostAssemblyError",
    "DesktopCompanionHostProviderTransports",
]
