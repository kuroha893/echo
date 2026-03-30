// ---------------------------------------------------------------------------
// Story Mode Console Tab — Phase 1
// Renderer-side UI for story mode, mounted as a tab in the console window.
// Provides: thread creation, cast setup, user turn input, timeline view,
// save/load, and orchestrator status.
// ---------------------------------------------------------------------------

function esc(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const DEFAULT_CAST_VISUALS = Object.freeze([
    Object.freeze({ subtitleColor: "#ff7b84", timelineColor: "#45212b" }),
    Object.freeze({ subtitleColor: "#67c7ff", timelineColor: "#1b3446" })
]);

function buildEmptyCastDraft(displayName, defaultVisual = DEFAULT_CAST_VISUALS[0]) {
    return {
        displayName,
        modelKey: "",
        personaRef: "",
        voiceProfileKey: "",
        subtitleColor: defaultVisual.subtitleColor,
        timelineColor: defaultVisual.timelineColor
    };
}

function buildModelOptionLabel(model) {
    return `${model.display_name || model.model_key} (${model.model_key})`;
}

function buildVoiceOptionLabel(voice) {
    if (!voice.voice_profile_key) {
        return voice.display_name || "跟随全局当前音色";
    }
    return `${voice.display_name || voice.voice_profile_key} (${voice.voice_profile_key})`;
}

function formatSavedAt(savedAt) {
    if (typeof savedAt !== "string" || savedAt.trim() === "") {
        return "空槽位";
    }
    const date = new Date(savedAt);
    if (Number.isNaN(date.getTime())) {
        return savedAt;
    }
    return date.toLocaleString();
}

function alphaHex(hexColor, alpha) {
    if (typeof hexColor !== "string" || !/^#[0-9a-f]{6}$/i.test(hexColor)) {
        return `rgba(255,255,255,${alpha})`;
    }
    const normalized = hexColor.slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function normalizeHexColor(value, fallback) {
    if (typeof value !== "string") {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

export function captureTimelineScrollState(timelineElement) {
    if (!timelineElement) {
        return null;
    }
    const maxScrollTop = Math.max(0, timelineElement.scrollHeight - timelineElement.clientHeight);
    const distanceToBottom = Math.max(0, maxScrollTop - timelineElement.scrollTop);
    return {
        scrollTop: Math.max(0, timelineElement.scrollTop),
        wasNearBottom: distanceToBottom <= 24
    };
}

export function restoreTimelineScrollState(timelineElement, scrollState) {
    if (!timelineElement || !scrollState) {
        return;
    }
    const maxScrollTop = Math.max(0, timelineElement.scrollHeight - timelineElement.clientHeight);
    if (scrollState.wasNearBottom) {
        timelineElement.scrollTop = maxScrollTop;
        return;
    }
    timelineElement.scrollTop = Math.min(Math.max(0, scrollState.scrollTop), maxScrollTop);
}

export function restoreTimelineScrollStateDeferred(timelineElement, scrollState) {
    if (!timelineElement || !scrollState) {
        return;
    }
    const applyRestore = () => restoreTimelineScrollState(timelineElement, scrollState);
    if (typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(() => {
            applyRestore();
            globalThis.requestAnimationFrame(applyRestore);
        });
        return;
    }
    globalThis.setTimeout(applyRestore, 0);
}

export function getRenderableTimelineEvents(timeline) {
    if (!Array.isArray(timeline)) {
        return [];
    }
    return timeline;
}

/**
 * @param {object} api - window.echoDesktopLive2D (with storyMode sub-API)
 * @param {function} showToast - (message) => void
 * @param {function} renderContent - () => void (triggers tab re-render)
 */
export function createStoryModeTabState(api, showToast, renderContent) {
    const sm = api.storyMode;
    const STATUS_POLL_INTERVAL_MS = 1200;
    const STORY_WAIT_POLICY = Object.freeze({
        YIELD_TO_USER: "yield_to_user",
        CONTINUE_CHAIN: "continue_chain"
    });

    let thread = null;
    let castMembers = [];
    let timeline = [];
    let stageState = null;
    let narratorState = null;
    let storySlots = [];
    let orchestratorStatus = { available: false, running: false };
    let availablePersonaModels = [];
    let availableVoiceProfiles = [];
    let castOptionsLoaded = false;
    let castOptionsError = null;
    let busy = false;
    let lastSeenOrchestratorError = null;

    let castDraftA = buildEmptyCastDraft("角色 A", DEFAULT_CAST_VISUALS[0]);
    let castDraftB = buildEmptyCastDraft("角色 B", DEFAULT_CAST_VISUALS[1]);
    let sceneGoalDraft = "两位角色与用户自由对话。";
    let sceneLabelDraft = "月读缘侧";
    let currentTimeLabelDraft = "永恒之夜";
    let narratorSubtitleColorDraft = "#ffd782";
    let narratorSubtitleColorLoaded = false;
    let pendingTimelineScrollState = null;
    let storyInputDraft = "";
    let pendingStoryInputFocus = false;
    let pendingStoryInputSelection = null;
    let mountedRoot = null;
    let mountedViewMode = null;
    let storyInputComposing = false;
    let lastYieldBeatPrompted = null;
    let acknowledgedYieldBeat = null;
    let yieldAutoSelectTimer = null;
    let yieldAutoSelectBeat = null;
    let pendingChoiceMetadata = null;

    function getCastMemberMap() {
        return new Map(castMembers.map((castMember) => [castMember.cast_member_id, castMember]));
    }

    function getNarratorSubtitleColor() {
        return normalizeHexColor(narratorSubtitleColorDraft, "#ffd782");
    }

    function clearYieldAutoSelectTimer() {
        if (yieldAutoSelectTimer !== null) {
            globalThis.clearTimeout(yieldAutoSelectTimer);
            yieldAutoSelectTimer = null;
        }
        yieldAutoSelectBeat = null;
    }

    function cancelYieldAutoSelectForCurrentBeat() {
        const beatCounter = Number.isInteger(narratorState?.beat_counter) ? narratorState.beat_counter : null;
        if (beatCounter === null || beatCounter !== yieldAutoSelectBeat) {
            return;
        }
        clearYieldAutoSelectTimer();
    }

    function getMountedRoot() {
        if (!mountedRoot || mountedRoot.isConnected !== true) {
            mountedRoot = null;
            mountedViewMode = null;
            return null;
        }
        return mountedRoot;
    }

    function summarizeText(text, maxLength = 96) {
        if (typeof text !== "string") {
            return "";
        }
        const normalized = text.replace(/\s+/g, " ").trim();
        if (normalized.length <= maxLength) {
            return normalized;
        }
        return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}...`;
    }

    function formatScorePercent(value) {
        if (typeof value !== "number" || Number.isNaN(value)) {
            return "0%";
        }
        return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
    }

    function buildThreadTitleFromSceneGoal(sceneGoal) {
        const normalized = summarizeText(sceneGoal, 28);
        return normalized || "Story Thread";
    }

    function ensureConfirm() {
        if (typeof globalThis.confirm !== "function") {
            throw new Error("confirm is not available in this renderer context");
        }
        return globalThis.confirm.bind(globalThis);
    }

    function getSlotById(slotId) {
        return storySlots.find((slot) => slot.slot_id === slotId) || null;
    }

    function canMutateStateSlots() {
        return busy !== true && orchestratorStatus.running !== true;
    }

    function requestViewRefresh(forceFull = false) {
        const root = getMountedRoot();
        if (!root || forceFull || !thread || mountedViewMode !== "thread") {
            renderContent();
            return;
        }
        updateThreadView(root);
    }

    function applyPendingComposerFocus(root) {
        const storyInput = root?.querySelector("#storyInput") || null;
        if (storyInput && pendingStoryInputFocus && !storyInput.disabled) {
            const selection = pendingStoryInputSelection;
            const focusInput = () => {
                storyInput.focus();
                if (selection && typeof selection.start === "number" && typeof selection.end === "number") {
                    storyInput.setSelectionRange(selection.start, selection.end);
                }
            };
            if (typeof globalThis.requestAnimationFrame === "function") {
                globalThis.requestAnimationFrame(focusInput);
            } else {
                globalThis.setTimeout(focusInput, 0);
            }
        }
        pendingStoryInputFocus = false;
        pendingStoryInputSelection = null;
    }

    function getEffectiveCastColor(castMember, fieldName, fallbackIndex) {
        const rawValue = castMember?.[fieldName];
        if (typeof rawValue === "string" && /^#[0-9a-f]{6}$/i.test(rawValue.trim())) {
            return rawValue.trim().toLowerCase();
        }
        const fallback = DEFAULT_CAST_VISUALS[fallbackIndex] || DEFAULT_CAST_VISUALS[0];
        return fieldName === "subtitle_color" ? fallback.subtitleColor : fallback.timelineColor;
    }

    function normalizeVoiceProfiles(voiceLibrary) {
        const voices = Array.isArray(voiceLibrary?.voices) ? voiceLibrary.voices : [];
        const activeVoiceProfileKey =
            typeof voiceLibrary?.active_voice_profile_key === "string"
                ? voiceLibrary.active_voice_profile_key
                : "";
        const uniqueProfiles = new Map();
        for (const voice of voices) {
            if (!voice?.voice_profile_key || uniqueProfiles.has(voice.voice_profile_key)) {
                continue;
            }
            uniqueProfiles.set(voice.voice_profile_key, Object.freeze({
                voice_profile_key: voice.voice_profile_key,
                display_name: voice.display_name || voice.voice_profile_key,
                is_active: voice.is_active === true
            }));
        }
        if (activeVoiceProfileKey && !uniqueProfiles.has(activeVoiceProfileKey)) {
            uniqueProfiles.set(activeVoiceProfileKey, Object.freeze({
                voice_profile_key: activeVoiceProfileKey,
                display_name: `当前全局音色 (${activeVoiceProfileKey})`,
                is_active: true
            }));
        }
        return Object.freeze([
            Object.freeze({
                voice_profile_key: "",
                display_name: activeVoiceProfileKey
                    ? `跟随全局当前音色 (${activeVoiceProfileKey})`
                    : "跟随全局当前音色",
                is_active: false
            }),
            ...Array.from(uniqueProfiles.values())
        ]);
    }

    function findPersonaModel(modelKey) {
        return availablePersonaModels.find((model) => model.model_key === modelKey) || null;
    }

    function applyModelSelectionToDraft(draft, modelKey) {
        const model = findPersonaModel(modelKey);
        if (!model) {
            return;
        }
        draft.modelKey = model.model_key;
        draft.personaRef = model.persona_repo_relative_path;
        if (!draft.displayName || draft.displayName.startsWith("角色 ")) {
            draft.displayName = model.display_name || model.model_key;
        }
    }

    function syncDraftDefaultsFromPersonaModels() {
        const first = availablePersonaModels[0] || null;
        const second = availablePersonaModels[1] || first;
        if (first && !findPersonaModel(castDraftA.modelKey)) {
            applyModelSelectionToDraft(castDraftA, first.model_key);
        }
        if (second && (!findPersonaModel(castDraftB.modelKey) || castDraftB.modelKey === castDraftA.modelKey)) {
            applyModelSelectionToDraft(castDraftB, second.model_key);
        }
    }

    async function ensureAvailablePersonaModels(forceReload = false) {
        if (castOptionsLoaded && !forceReload) {
            return;
        }
        try {
            const [library, voiceLibrary] = await Promise.all([
                api.loadAvatarModelLibrary(),
                api.listClonedVoices()
            ]);
            availablePersonaModels = (library?.models || []).filter(
                (model) => model.has_persona === true && typeof model.persona_repo_relative_path === "string"
            );
            availableVoiceProfiles = normalizeVoiceProfiles(voiceLibrary);
            castOptionsLoaded = true;
            castOptionsError = null;
            syncDraftDefaultsFromPersonaModels();
        } catch (error) {
            castOptionsLoaded = true;
            castOptionsError = error instanceof Error ? error.message : String(error);
            availablePersonaModels = [];
            availableVoiceProfiles = normalizeVoiceProfiles(null);
        }
        renderContent();
    }

    async function ensureNarratorSubtitleColorLoaded(forceReload = false) {
        if (narratorSubtitleColorLoaded && !forceReload) {
            return;
        }
        try {
            if (typeof api.getStoryNarratorSubtitleColor === "function") {
                narratorSubtitleColorDraft = normalizeHexColor(
                    await api.getStoryNarratorSubtitleColor(),
                    narratorSubtitleColorDraft
                );
            }
        } catch {
            narratorSubtitleColorDraft = normalizeHexColor(narratorSubtitleColorDraft, "#ffd782");
        }
        narratorSubtitleColorLoaded = true;
    }

    async function saveNarratorSubtitleColor() {
        narratorSubtitleColorDraft = getNarratorSubtitleColor();
        if (typeof api.setStoryNarratorSubtitleColor !== "function") {
            return narratorSubtitleColorDraft;
        }
        narratorSubtitleColorDraft = normalizeHexColor(
            await api.setStoryNarratorSubtitleColor(narratorSubtitleColorDraft),
            narratorSubtitleColorDraft
        );
        return narratorSubtitleColorDraft;
    }

    async function loadCurrentState() {
        const hadThread = thread !== null;
        try {
            await ensureNarratorSubtitleColorLoaded();
            const threadResult = await sm.getThread();
            thread = threadResult?.payload || null;
            if (thread) {
                const [timelineResult, stageResult, narratorResult, castMembersResult, slotsResult] = await Promise.all([
                    sm.getTimeline(),
                    sm.getStageState(),
                    sm.getNarratorState(),
                    sm.getCastMembers(),
                    sm.listStateSlots()
                ]);
                timeline = timelineResult?.payload || [];
                stageState = stageResult?.payload || null;
                narratorState = narratorResult?.payload || null;
                castMembers = castMembersResult?.payload || [];
                storySlots = slotsResult?.payload || [];
                sceneGoalDraft = narratorState?.scene_goal || sceneGoalDraft;
                sceneLabelDraft = narratorState?.scene_label || sceneLabelDraft;
                currentTimeLabelDraft = narratorState?.current_time_label || currentTimeLabelDraft;
            } else {
                timeline = [];
                stageState = null;
                narratorState = null;
                castMembers = [];
                clearYieldAutoSelectTimer();
                const slotsResult = await sm.listStateSlots();
                storySlots = slotsResult?.payload || [];
            }
            const statusResult = await sm.getOrchestratorStatus();
            orchestratorStatus = statusResult?.payload || {
                available: false,
                running: false,
                last_error_message: null
            };
            if (
                orchestratorStatus.last_error_message &&
                orchestratorStatus.last_error_message !== lastSeenOrchestratorError
            ) {
                lastSeenOrchestratorError = orchestratorStatus.last_error_message;
                showToast("故事模式运行失败: " + orchestratorStatus.last_error_message);
            }
        } catch {
            thread = null;
            timeline = [];
            stageState = null;
            narratorState = null;
            castMembers = [];
            storySlots = [];
            clearYieldAutoSelectTimer();
            orchestratorStatus = { available: false, running: false, last_error_message: null };
        }
        const root = getMountedRoot();
        if (root && hadThread && thread && mountedViewMode === "thread") {
            updateThreadView(root);
            return;
        }
        renderContent();
    }

    async function createThread() {
        if (busy) return;
        if (availablePersonaModels.length < 2) {
            showToast("至少需要两个已配置 persona 的模型");
            return;
        }
        if (!castDraftA.modelKey || !castDraftB.modelKey) {
            showToast("请为两个角色都选择人格模型");
            return;
        }
        if (castDraftA.modelKey === castDraftB.modelKey) {
            showToast("两个角色必须选择不同的人格模型");
            return;
        }
        busy = true;
        renderContent();
        try {
            const result = await sm.createThread({
                title: buildThreadTitleFromSceneGoal(sceneGoalDraft),
                mode: "free_play",
                castMembers: [
                    {
                        display_name: castDraftA.displayName,
                        persona_profile_ref: castDraftA.personaRef,
                        model_profile_ref: castDraftA.modelKey,
                        voice_profile_ref: castDraftA.voiceProfileKey || null,
                        subtitle_color: castDraftA.subtitleColor,
                        timeline_color: castDraftA.timelineColor,
                        role_type: "protagonist"
                    },
                    {
                        display_name: castDraftB.displayName,
                        persona_profile_ref: castDraftB.personaRef,
                        model_profile_ref: castDraftB.modelKey,
                        voice_profile_ref: castDraftB.voiceProfileKey || null,
                        subtitle_color: castDraftB.subtitleColor,
                        timeline_color: castDraftB.timelineColor,
                        role_type: "supporting"
                    }
                ],
                sceneCardInit: {
                    sceneGoal: sceneGoalDraft,
                    sceneLabel: sceneLabelDraft,
                    currentTimeLabel: currentTimeLabelDraft,
                    toneTagsList: [],
                    discourseConstraints: []
                }
            });
            if (result?.status === "ok") {
                thread = result.payload;
                showToast("故事线程已创建");
                await initOrchestrator();
                await loadCurrentState();
            } else {
                showToast("创建失败: " + (result?.error_message || "unknown"));
            }
        } catch (err) {
            showToast("创建失败: " + (err.message || err));
        } finally {
            busy = false;
            renderContent();
        }
    }

    async function initOrchestrator() {
        try {
            const result = await sm.initOrchestrator(castMembers);
            if (result?.status !== "ok") {
                showToast("Orchestrator 初始化失败: " + (result?.error_message || "unknown"));
            }
        } catch (err) {
            showToast("Orchestrator 初始化失败: " + (err.message || err));
        }
    }

    async function submitTurn(text) {
        if (busy || orchestratorStatus.running || !text.trim()) return;
        clearYieldAutoSelectTimer();
        const choiceMetadata = pendingChoiceMetadata;
        pendingChoiceMetadata = null;
        busy = true;
        requestViewRefresh();
        try {
            const result = await sm.runStoryTurn(text.trim(), null, choiceMetadata);
            if (result?.status === "ok") {
                storyInputDraft = "";
                showToast("自动推进已启动");
                await loadCurrentState();
            } else {
                showToast("轮次失败: " + (result?.error_message || "unknown"));
            }
        } catch (err) {
            showToast("轮次失败: " + (err.message || err));
        } finally {
            busy = false;
            requestViewRefresh();
        }
    }

    async function stopStoryTurn() {
        if (busy || !orchestratorStatus.running) {
            return;
        }
        clearYieldAutoSelectTimer();
        busy = true;
        requestViewRefresh();
        try {
            const result = await sm.stopStoryTurn("user_interrupt");
            if (result?.status === "ok") {
                showToast(result.payload?.stopped ? "故事推进已打断" : "当前没有可打断的推进");
                await loadCurrentState();
            } else {
                showToast("打断失败: " + (result?.error_message || "unknown"));
            }
        } catch (err) {
            showToast("打断失败: " + (err.message || err));
        } finally {
            busy = false;
            requestViewRefresh();
        }
    }

    async function saveState(slotId) {
        if (!thread || !canMutateStateSlots()) {
            return;
        }
        const slot = getSlotById(slotId);
        if (slot?.exists) {
            const confirmed = ensureConfirm()(`存档 ${slotId} 已有内容，是否覆盖？`);
            if (!confirmed) {
                return;
            }
        }
        busy = true;
        requestViewRefresh();
        try {
            const result = await sm.saveState(slotId, thread.title || null);
            if (result?.status === "ok") {
                showToast(`已保存到存档 ${slotId}`);
                await loadCurrentState();
            } else {
                showToast("保存失败: " + (result?.error_message || "unknown"));
            }
        } catch (err) {
            showToast("保存失败: " + (err.message || err));
        } finally {
            busy = false;
            requestViewRefresh();
        }
    }

    async function loadState(slotId) {
        if (!canMutateStateSlots()) {
            return;
        }
        busy = true;
        requestViewRefresh();
        try {
            const result = await sm.loadState(slotId);
            if (result?.status === "ok") {
                if (result.payload) {
                    showToast(`已载入存档 ${slotId}`);
                } else {
                    showToast(`存档 ${slotId} 为空`);
                }
                await loadCurrentState();
            } else {
                showToast("加载失败: " + (result?.error_message || "unknown"));
            }
        } catch (err) {
            showToast("加载失败: " + (err.message || err));
        } finally {
            busy = false;
            requestViewRefresh();
        }
    }

    async function archiveState(slotId) {
        if (!canMutateStateSlots()) {
            return;
        }
        const slot = getSlotById(slotId);
        if (!slot?.exists) {
            return;
        }
        const confirmed = ensureConfirm()(`确认归档存档 ${slotId}？该槽位内容将被清空。`);
        if (!confirmed) {
            return;
        }
        busy = true;
        requestViewRefresh();
        try {
            const result = await sm.archiveState(slotId);
            if (result?.status === "ok") {
                showToast(result.payload?.deleted ? `存档 ${slotId} 已归档` : `存档 ${slotId} 本来就是空的`);
                await loadCurrentState();
            } else {
                showToast("归档失败: " + (result?.error_message || "unknown"));
            }
        } catch (err) {
            showToast("归档失败: " + (err.message || err));
        } finally {
            busy = false;
            requestViewRefresh();
        }
    }

    function renderPersonaSelect(inputName, selectedModelKey) {
        if (!castOptionsLoaded) {
            return `<div class="text-muted text-xs">正在加载人格模型列表...</div>`;
        }
        if (castOptionsError) {
            return `<div class="text-muted text-xs">加载人格模型失败: ${esc(castOptionsError)}</div>`;
        }
        if (availablePersonaModels.length === 0) {
            return `<div class="text-muted text-xs">当前没有可用 persona 模型。请先在模型库中配置 persona.md。</div>`;
        }
        let optionsHtml = "";
        for (const model of availablePersonaModels) {
            const selected = model.model_key === selectedModelKey ? "selected" : "";
            optionsHtml += `<option value="${esc(model.model_key)}" ${selected}>${esc(buildModelOptionLabel(model))}</option>`;
        }
        return `<select data-input="${esc(inputName)}">${optionsHtml}</select>`;
    }

    function renderVoiceSelect(inputName, selectedVoiceProfileKey) {
        let optionsHtml = "";
        for (const voice of availableVoiceProfiles) {
            const selected = voice.voice_profile_key === selectedVoiceProfileKey ? "selected" : "";
            optionsHtml += `<option value="${esc(voice.voice_profile_key)}" ${selected}>${esc(buildVoiceOptionLabel(voice))}</option>`;
        }
        return `<select data-input="${esc(inputName)}">${optionsHtml}</select>`;
    }

    function renderStateSlots() {
        if (!Array.isArray(storySlots) || storySlots.length === 0) {
            return `<div class="text-muted text-xs">暂无可用存档槽。</div>`;
        }
        const slotActionsDisabled = !canMutateStateSlots();
        let html = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">`;
        for (const slot of storySlots) {
            const exists = slot.exists === true;
            const castSummary = Array.isArray(slot.cast_names) && slot.cast_names.length > 0
                ? slot.cast_names.join(" / ")
                : "无角色信息";
            const chapterSummary = summarizeText(slot.chapter_summary || "", 88) || "当前还没有章节摘要";
            const latestEventPreview = summarizeText(slot.latest_event_preview || "", 88) || "当前还没有最近进展";
            const focusCastName = summarizeText(slot.focus_cast_name || "", 32) || "无";
            const saveLabel = exists ? "覆盖" : "保存";
            html += `<div class="card" style="margin:0;padding:0;border:1px solid rgba(255,255,255,0.08);overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))">`;
            html += `<div style="padding:10px 12px;background:linear-gradient(135deg,rgba(255,123,132,0.16),rgba(103,199,255,0.12));border-bottom:1px solid rgba(255,255,255,0.08)">`;
            html += `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">`;
            html += `<div><div style="font-weight:700">${esc(slot.slot_title || `存档 ${slot.slot_id}`)}</div>`;
            html += `<div class="text-muted text-xs">槽位 ${slot.slot_id} · ${esc(formatSavedAt(slot.saved_at))}</div></div>`;
            html += exists ? `<span class="text-muted text-xs">rev ${slot.story_revision || 0}</span>` : `<span class="text-muted text-xs">Empty</span>`;
            html += `</div>`;
            html += `</div>`;
            html += `<div style="padding:12px">`;
            html += `<div style="font-size:12px;color:rgba(255,255,255,0.72)">${esc(slot.thread_title || "空槽位")}</div>`;
            html += `<div style="margin-top:8px;font-size:12px;line-height:1.5"><strong>章节摘要</strong><div class="text-muted">${esc(chapterSummary)}</div></div>`;
            html += `<div style="margin-top:8px;font-size:12px;line-height:1.5"><strong>最近进展</strong><div class="text-muted">${esc(latestEventPreview)}</div></div>`;
            html += `<div class="text-muted text-xs" style="margin-top:8px">焦点角色 ${esc(focusCastName)} · ${esc(castSummary)}</div>`;
            html += `<div style="display:flex;gap:8px;margin-top:12px">`;
            html += `<button class="btn btn--primary" data-slot-save="${slot.slot_id}" ${!thread || slotActionsDisabled ? "disabled" : ""}>${saveLabel}</button>`;
            html += `<button class="btn" data-slot-load="${slot.slot_id}" ${!exists || slotActionsDisabled ? "disabled" : ""}>载入</button>`;
            html += `<button class="btn" data-slot-archive="${slot.slot_id}" ${!exists || slotActionsDisabled ? "disabled" : ""}>归档</button>`;
            html += `</div>`;
            html += `</div>`;
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    function captureRenderState(root) {
        pendingTimelineScrollState = captureTimelineScrollState(
            root?.querySelector(".story-timeline") || null
        );
        const storyInput = root?.querySelector("#storyInput") || null;
        if (storyInput) {
            storyInputDraft = storyInput.value;
            pendingStoryInputFocus = document.activeElement === storyInput;
            pendingStoryInputSelection = pendingStoryInputFocus
                ? {
                    start: storyInput.selectionStart,
                    end: storyInput.selectionEnd
                }
                : null;
        }
    }

    function renderThreadSummaryHtml() {
        let html = `<div class="card">`;
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">`;
        html += `<strong>${esc(thread.title)}</strong>`;
        html += `<span class="text-muted text-xs">rev ${thread.revision} · ${thread.status || "active"}</span>`;
        if (orchestratorStatus.running) {
            html += `<span style="color:#4caf50;font-size:12px">● 运行中</span>`;
        }
        html += `</div>`;
        html += `<div class="text-muted text-xs" style="margin-bottom:8px">角色: ${(thread.cast_member_ids || []).length} 名</div>`;
        html += `<div style="display:flex;gap:8px">`;
        html += `<button class="btn" data-action="refresh">🔄 刷新</button>`;
        html += `<button class="btn" data-action="interrupt" style="background:#c73c4d;color:#fff;border-color:#c73c4d" ${orchestratorStatus.running && !busy ? "" : "disabled"}>打断</button>`;
        html += `</div>`;
        html += `</div>`;
        return html;
    }

    function renderCastConfigHtml() {
        if (castMembers.length === 0) {
            return "";
        }
        let html = `<div class="card">`;
        html += `<div class="section-title" style="margin-top:0">角色配置</div>`;
        html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">`;
        castMembers.forEach((castMember, castIndex) => {
            const subtitleColor = getEffectiveCastColor(castMember, "subtitle_color", castIndex);
            const timelineColor = getEffectiveCastColor(castMember, "timeline_color", castIndex);
            html += `<div class="card" style="margin:0;padding:12px;border:1px solid ${alphaHex(subtitleColor, 0.44)};background:${alphaHex(timelineColor, 0.48)}">`;
            html += `<div style="font-weight:700;color:${esc(subtitleColor)}">${esc(castMember.display_name)}</div>`;
            html += `<div class="text-muted text-xs" style="margin-top:4px">模型 ${esc(castMember.model_profile_ref || "-")}</div>`;
            html += `<div class="text-muted text-xs">音色 ${esc(castMember.voice_profile_ref || "跟随全局")}</div>`;
            html += `</div>`;
        });
        html += `</div>`;
        html += `</div>`;
        return html;
    }

    function renderTimelineBodyHtml() {
        const castMemberMap = getCastMemberMap();
        if (timeline.length === 0) {
            return `<div class="text-muted">暂无事件</div>`;
        }
        let html = `<div class="story-timeline">`;
        for (const event of getRenderableTimelineEvents(timeline)) {
            const isUser = event.event_kind === "user_input";
            const isNarrator = event.event_kind === "director_note" || event.event_kind === "scene_transition";
            const castMember = !isUser ? castMemberMap.get(event.cast_member_id) || null : null;
            const subtitleColor = isNarrator
                ? getNarratorSubtitleColor()
                : castMember ? getEffectiveCastColor(castMember, "subtitle_color", 0) : "#f5f5f5";
            const timelineColor = isNarrator
                ? "#5c4621"
                : castMember ? getEffectiveCastColor(castMember, "timeline_color", 0) : "#2c2c2c";
            const label = isUser
                ? "👤 用户介入"
                : isNarrator
                    ? "✦ 旁白"
                    : `🎭 ${esc(castMember?.display_name || event.cast_member_id?.substring(0, 8) || "cast")}`;
            const textPreview = esc((event.text || "").substring(0, 120));
            const revBadge = event.story_revision != null ? `<span class="text-muted text-xs">rev ${event.story_revision}</span>` : "";
            const entryStyle = isUser
                ? ""
                : isNarrator
                    ? `style="border:1px solid ${alphaHex(subtitleColor, 0.36)};background:${alphaHex(timelineColor, 0.28)}"`
                    : `style="border:1px solid ${alphaHex(subtitleColor, 0.34)};background:${alphaHex(timelineColor, 0.56)}"`;
            html += `<div class="story-timeline__entry ${isUser ? "story-timeline__entry--user" : "story-timeline__entry--cast"}" ${entryStyle}>`;
            html += `<div style="display:flex;align-items:center;gap:6px"><strong ${isUser ? "" : `style="color:${esc(subtitleColor)}"`}>${label}</strong> ${revBadge}</div>`;
            html += `<div style="margin-top:2px">${textPreview || "<em>无文本</em>"}</div>`;
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    function renderStageStateHtml() {
        if (!stageState) {
            return "";
        }
        return `<div class="card"><div class="section-title" style="margin-top:0">舞台状态</div><div class="text-muted text-xs">焦点: ${esc(stageState.camera_focus || "无")} · 修订: ${stageState.revision || 0}</div></div>`;
    }

    function renderNarratorStateHtml() {
        if (!narratorState) {
            return "";
        }

        let html = `<div class="card">`;
        html += `<div class="section-title" style="margin-top:0">叙事面板</div>`;
        html += `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">`;
        html += `<span class="text-muted text-xs">场景: ${esc(narratorState.scene_label || "-")}</span>`;
        html += `<span class="text-muted text-xs">时间: ${esc(narratorState.current_time_label || "-")}</span>`;
        html += `<span class="text-muted text-xs">Beat: ${Number.isInteger(narratorState.beat_counter) ? narratorState.beat_counter : 0}</span>`;
        html += `<span class="text-muted text-xs">停滞: ${formatScorePercent(narratorState.stagnation_score)}</span>`;
        html += `<span class="text-muted text-xs">收束: ${formatScorePercent(narratorState.closure_pressure_score)}</span>`;
        html += `</div>`;
        html += `<div style="margin-bottom:10px"><strong>叙事焦点</strong><div style="margin-top:4px">${esc(narratorState.narrative_focus || "-")}</div></div>`;
        html += `<div style="margin-bottom:10px"><strong>章节摘要</strong><div class="text-muted" style="margin-top:4px">${esc(narratorState.chapter_summary || "-")}</div></div>`;

        if (Array.isArray(narratorState.relationship_summary_lines) && narratorState.relationship_summary_lines.length > 0) {
            html += `<div style="margin-bottom:10px"><strong>关系摘要</strong>`;
            html += `<div class="text-muted text-xs" style="margin-top:4px;display:grid;gap:4px">`;
            for (const line of narratorState.relationship_summary_lines.slice(0, 4)) {
                html += `<div>• ${esc(line)}</div>`;
            }
            html += `</div></div>`;
        }

        if (Array.isArray(narratorState.pending_events) && narratorState.pending_events.length > 0) {
            html += `<div style="margin-bottom:10px"><strong>待触发事件</strong>`;
            html += `<div class="text-muted text-xs" style="margin-top:4px;display:grid;gap:4px">`;
            for (const line of narratorState.pending_events.slice(0, 4)) {
                html += `<div>• ${esc(line)}</div>`;
            }
            html += `</div></div>`;
        }

        if (narratorState.last_director_note) {
            html += `<div style="margin-bottom:10px"><strong>当前导演指令</strong><div class="text-muted text-xs" style="margin-top:4px">${esc(narratorState.last_director_note)}</div></div>`;
        }

        html += `<div style="margin-bottom:10px;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">`;
        html += `<div class="field" style="margin:0"><label class="field__label">旁白字幕色</label><input type="color" data-input="narrator_subtitle_color" value="${esc(getNarratorSubtitleColor())}" /></div>`;
        html += `<button class="btn" type="button" data-action="save-narrator-color">应用旁白颜色</button>`;
        html += `</div>`;

        if (Array.isArray(narratorState.suggested_choices) && narratorState.suggested_choices.length > 0) {
            html += `<div><strong>建议动作</strong><div class="text-muted text-xs" style="margin:4px 0 8px 0">点击后会填入输入框，你可以直接发出，也可以继续改写。</div>`;
            html += `<div style="display:grid;gap:8px">`;
            for (const choice of narratorState.suggested_choices.slice(0, 3)) {
                html += `<button class="btn" type="button" data-choice-prompt="${esc(choice.prompt_text || choice.label || "")}" style="text-align:left;justify-content:flex-start">${esc(choice.label || "建议动作")}</button>`;
                if (choice.rationale) {
                    html += `<div class="text-muted text-xs" style="margin-top:-4px">${esc(choice.rationale)}</div>`;
                }
            }
            html += `</div></div>`;
        }

        html += `</div>`;
        return html;
    }

    function renderComposerSuggestionsHtml() {
        if (!narratorState) {
            return "";
        }
        const choices = Array.isArray(narratorState.suggested_choices)
            ? narratorState.suggested_choices.slice(0, 3)
            : [];
        const beatCounter = Number.isInteger(narratorState.beat_counter) ? narratorState.beat_counter : null;
        const isWaitingForUser = narratorState.last_user_wait_policy === STORY_WAIT_POLICY.YIELD_TO_USER;
        if (isWaitingForUser && beatCounter !== null && acknowledgedYieldBeat === beatCounter) {
            return "";
        }
        if (!isWaitingForUser && choices.length === 0) {
            return "";
        }

        let html = "";
        if (isWaitingForUser) {
            html += `<div style="margin-top:12px;padding:14px 16px;border:1px solid rgba(255,215,130,0.42);border-radius:12px;background:linear-gradient(180deg,rgba(255,215,130,0.16),rgba(255,215,130,0.06))">`;
            html += `<div style="font-size:14px;font-weight:800;margin-bottom:6px;color:#ffd782">轮到你决定下一步</div>`;
            html += `<div class="text-muted text-xs">请选择一个 narrator 给出的推进方向，或者使用“其他：（请输入）”自由发挥。5 秒无操作会默认执行第一项。</div>`;
            html += `</div>`;
        }
        if (choices.length > 0) {
            html += `<div style="display:grid;gap:8px;margin-top:10px">`;
            for (const choice of choices) {
                const choiceId = choice.choice_id || "";
                html += `<button class="btn" type="button" data-choice-id="${esc(choiceId)}" data-choice-prompt="${esc(choice.prompt_text || choice.label || "")}" style="text-align:left;justify-content:flex-start;padding:10px 12px;border-color:rgba(255,215,130,0.22);background:rgba(255,255,255,0.03)">${esc(choice.label || "建议动作")}</button>`;
            }
            html += `<button class="btn" type="button" data-choice-freeform="true" style="text-align:left;justify-content:flex-start;padding:10px 12px;border-style:dashed;border-color:rgba(255,255,255,0.18);background:rgba(255,255,255,0.02)">其他：（请输入）</button>`;
            html += `</div>`;
        } else if (isWaitingForUser) {
            html += `<div style="display:grid;gap:8px;margin-top:10px">`;
            html += `<button class="btn" type="button" data-choice-freeform="true" style="text-align:left;justify-content:flex-start;padding:10px 12px;border-style:dashed;border-color:rgba(255,255,255,0.18);background:rgba(255,255,255,0.02)">其他：（请输入）</button>`;
            html += `</div>`;
        }
        return html;
    }

    function applySuggestedChoice(root, promptText, { freeform = false, choiceMetadata = null } = {}) {
        cancelYieldAutoSelectForCurrentBeat();
        const normalized = typeof promptText === "string" ? promptText.trim() : "";
        if (!normalized && !freeform) {
            return;
        }
        pendingChoiceMetadata = choiceMetadata;
        const beatCounter = Number.isInteger(narratorState?.beat_counter) ? narratorState.beat_counter : null;
        if (beatCounter !== null) {
            acknowledgedYieldBeat = beatCounter;
        }
        const nextValue = freeform ? "" : normalized;
        storyInputDraft = nextValue;
        const storyInput = root?.querySelector("#storyInput") || null;
        if (storyInput) {
            storyInput.value = nextValue;
            pendingStoryInputSelection = {
                start: nextValue.length,
                end: nextValue.length
            };
            pendingStoryInputFocus = storyInput.disabled !== true;
            if (storyInput.disabled !== true) {
                storyInput.focus();
                storyInput.setSelectionRange(nextValue.length, nextValue.length);
                storyInput.scrollIntoView({ block: "center", behavior: "smooth" });
            }
        }
        showToast(freeform ? "已切换到自由输入" : "已填入建议动作");
    }

    function scheduleYieldAutoSelect() {
        if (!narratorState || narratorState.last_user_wait_policy !== STORY_WAIT_POLICY.YIELD_TO_USER) {
            clearYieldAutoSelectTimer();
            return;
        }
        if (busy || orchestratorStatus.running) {
            clearYieldAutoSelectTimer();
            return;
        }
        const beatCounter = Number.isInteger(narratorState.beat_counter) ? narratorState.beat_counter : null;
        const choices = Array.isArray(narratorState.suggested_choices)
            ? narratorState.suggested_choices.slice(0, 3)
            : [];
        if (beatCounter === null || choices.length === 0 || acknowledgedYieldBeat === beatCounter) {
            clearYieldAutoSelectTimer();
            return;
        }
        if (yieldAutoSelectBeat === beatCounter && yieldAutoSelectTimer !== null) {
            return;
        }
        clearYieldAutoSelectTimer();
        yieldAutoSelectBeat = beatCounter;
        yieldAutoSelectTimer = globalThis.setTimeout(() => {
            if (!narratorState || narratorState.last_user_wait_policy !== STORY_WAIT_POLICY.YIELD_TO_USER) {
                clearYieldAutoSelectTimer();
                return;
            }
            if (acknowledgedYieldBeat === beatCounter || busy || orchestratorStatus.running) {
                clearYieldAutoSelectTimer();
                return;
            }
            const firstChoice = Array.isArray(narratorState.suggested_choices) ? narratorState.suggested_choices[0] : null;
            const promptText = String(firstChoice?.prompt_text || firstChoice?.label || "").trim();
            clearYieldAutoSelectTimer();
            if (!promptText) {
                return;
            }
            acknowledgedYieldBeat = beatCounter;
            storyInputDraft = promptText;
            if (firstChoice?.choice_id) {
                pendingChoiceMetadata = {
                    choice_id: firstChoice.choice_id,
                    target_speaker_id: firstChoice.target_speaker_id || null,
                    directive_kind: firstChoice.directive_kind || null,
                    source_revision: firstChoice.source_revision ?? null,
                    choice_batch_id: firstChoice.choice_batch_id || null,
                };
            } else {
                pendingChoiceMetadata = null;
            }
            requestViewRefresh();
            showToast("已按默认选项继续剧情");
            void submitTurn(promptText);
        }, 5000);
    }

    function maybeHighlightYieldPrompt(root) {
        if (!narratorState || narratorState.last_user_wait_policy !== STORY_WAIT_POLICY.YIELD_TO_USER) {
            clearYieldAutoSelectTimer();
            return;
        }
        const beatCounter = Number.isInteger(narratorState.beat_counter) ? narratorState.beat_counter : null;
        if (beatCounter === null || beatCounter === lastYieldBeatPrompted) {
            return;
        }
        lastYieldBeatPrompted = beatCounter;
        acknowledgedYieldBeat = null;
        const storyInput = root?.querySelector("#storyInput") || null;
        if (!storyInput || storyInput.disabled) {
            return;
        }
        pendingStoryInputFocus = true;
        pendingStoryInputSelection = {
            start: storyInputDraft.length,
            end: storyInputDraft.length
        };
        storyInput.scrollIntoView({ block: "center", behavior: "smooth" });
        showToast("剧情已停在你的选择点");
    }

    function updateComposerState(root) {
        const storyInput = root.querySelector("#storyInput") || null;
        const submitButton = root.querySelector("#btnSubmitTurn") || null;
        const helpText = root.querySelector("#storyComposerHelp") || null;
        const inputDisabled = busy || orchestratorStatus.running;

        if (storyInput) {
            if (!storyInputComposing && storyInput.value !== storyInputDraft) {
                storyInput.value = storyInputDraft;
            }
            storyInput.disabled = inputDisabled;
            storyInput.placeholder = orchestratorStatus.running
                ? "故事自动推进中，先打断再输入"
                : "输入消息...";
        }

        if (submitButton) {
            submitButton.disabled = inputDisabled;
            submitButton.textContent = busy ? "处理中..." : orchestratorStatus.running ? "推进中" : "发送";
        }

        if (helpText) {
            helpText.textContent = orchestratorStatus.running
                ? "当前正在自动推进剧情。先点击“打断”，然后才能发送新的用户消息。"
                : narratorState?.last_user_wait_policy === STORY_WAIT_POLICY.YIELD_TO_USER
                    ? "当前轮次已经停在等待你介入的位置。可以直接输入，或使用下方建议动作；5 秒无操作会默认执行第一项。"
                    : "发送消息后，故事模式会自动继续推进，直到需要你再次介入。";
        }
    }

    function updateThreadView(root) {
        if (!thread) {
            return;
        }

        const threadSummary = root.querySelector("#storyThreadSummary");
        if (threadSummary) {
            threadSummary.innerHTML = renderThreadSummaryHtml();
        }

        const castConfig = root.querySelector("#storyCastConfig");
        if (castConfig) {
            castConfig.innerHTML = renderCastConfigHtml();
        }

        const slotList = root.querySelector("#storySlotList");
        if (slotList) {
            slotList.innerHTML = renderStateSlots();
        }

        const timelineTitle = root.querySelector("#storyTimelineTitle");
        if (timelineTitle) {
            timelineTitle.innerHTML = `时间线 <span class="text-muted text-xs">(${timeline.length} 条)</span>`;
        }

        const timelineBody = root.querySelector("#storyTimelineBody");
        if (timelineBody) {
            const scrollState = pendingTimelineScrollState || captureTimelineScrollState(
                root.querySelector(".story-timeline") || null
            );
            timelineBody.innerHTML = renderTimelineBodyHtml();
            restoreTimelineScrollStateDeferred(
                root.querySelector(".story-timeline"),
                scrollState
            );
            pendingTimelineScrollState = null;
        }

        const stageStateMount = root.querySelector("#storyStageState");
        if (stageStateMount) {
            stageStateMount.innerHTML = renderStageStateHtml();
        }

        const narratorStateMount = root.querySelector("#storyNarratorState");
        if (narratorStateMount) {
            narratorStateMount.innerHTML = renderNarratorStateHtml();
        }

        const composerSuggestionsMount = root.querySelector("#storyComposerSuggestions");
        if (composerSuggestionsMount) {
            composerSuggestionsMount.innerHTML = renderComposerSuggestionsHtml();
        }

        updateComposerState(root);
        maybeHighlightYieldPrompt(root);
        scheduleYieldAutoSelect();
        applyPendingComposerFocus(root);
    }

    function ensureRootBindings(root) {
        if (root.dataset.storyModeBound === "true") {
            return;
        }
        root.dataset.storyModeBound = "true";

        root.addEventListener("input", (event) => {
            const target = event.target;
            if (target?.id === "storyInput") {
                storyInputDraft = target.value;
                cancelYieldAutoSelectForCurrentBeat();
                return;
            }
            if (target?.dataset?.input === "narrator_subtitle_color") {
                narratorSubtitleColorDraft = normalizeHexColor(target.value, narratorSubtitleColorDraft);
            }
        });

        root.addEventListener("compositionstart", (event) => {
            if (event.target?.id === "storyInput") {
                storyInputComposing = true;
                cancelYieldAutoSelectForCurrentBeat();
            }
        });

        root.addEventListener("compositionend", (event) => {
            if (event.target?.id === "storyInput") {
                storyInputComposing = false;
                storyInputDraft = event.target.value;
                cancelYieldAutoSelectForCurrentBeat();
            }
        });

        root.addEventListener("keydown", (event) => {
            if (event.target?.id !== "storyInput") {
                return;
            }
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !storyInputComposing) {
                event.preventDefault();
                const input = root.querySelector("#storyInput");
                if (input?.value) {
                    void submitTurn(input.value);
                }
            }
        });

        root.addEventListener("click", (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const button = target ? target.closest("button") : null;
            if (!button || !root.contains(button)) {
                return;
            }

            if (button.dataset.action === "create-thread") {
                const vals = readDraftInputs(root);
                castDraftA.displayName = vals.castA_name || castDraftA.displayName;
                castDraftB.displayName = vals.castB_name || castDraftB.displayName;
                applyModelSelectionToDraft(castDraftA, vals.castA_model || castDraftA.modelKey);
                applyModelSelectionToDraft(castDraftB, vals.castB_model || castDraftB.modelKey);
                castDraftA.voiceProfileKey = vals.castA_voice || "";
                castDraftA.subtitleColor = vals.castA_subtitle_color || castDraftA.subtitleColor;
                castDraftA.timelineColor = vals.castA_timeline_color || castDraftA.timelineColor;
                castDraftB.voiceProfileKey = vals.castB_voice || "";
                castDraftB.subtitleColor = vals.castB_subtitle_color || castDraftB.subtitleColor;
                castDraftB.timelineColor = vals.castB_timeline_color || castDraftB.timelineColor;
                sceneGoalDraft = vals.scene_goal || sceneGoalDraft;
                sceneLabelDraft = vals.scene_label || sceneLabelDraft;
                currentTimeLabelDraft = vals.current_time_label || currentTimeLabelDraft;
                narratorSubtitleColorDraft = normalizeHexColor(vals.narrator_subtitle_color, narratorSubtitleColorDraft);
                void saveNarratorSubtitleColor();
                void createThread();
                return;
            }

            if (button.dataset.action === "save-narrator-color") {
                const vals = readDraftInputs(root);
                narratorSubtitleColorDraft = normalizeHexColor(vals.narrator_subtitle_color, narratorSubtitleColorDraft);
                void saveNarratorSubtitleColor().then(() => {
                    showToast("已更新旁白字幕色");
                    requestViewRefresh();
                }).catch((error) => {
                    showToast("更新旁白字幕色失败: " + (error?.message || error));
                });
                return;
            }

            if (button.dataset.action === "submit-turn") {
                const input = root.querySelector("#storyInput");
                if (input?.value) {
                    void submitTurn(input.value);
                }
                return;
            }

            if (button.dataset.action === "refresh") {
                void loadCurrentState();
                return;
            }

            if (button.dataset.action === "interrupt") {
                void stopStoryTurn();
                return;
            }

            if (typeof button.dataset.choicePrompt === "string" && button.dataset.choicePrompt.trim() !== "") {
                const choiceId = button.dataset.choiceId || null;
                let choiceMetadata = null;
                if (choiceId && narratorState?.suggested_choices) {
                    const matchedChoice = narratorState.suggested_choices.find((c) => c.choice_id === choiceId);
                    if (matchedChoice) {
                        choiceMetadata = {
                            choice_id: matchedChoice.choice_id,
                            target_speaker_id: matchedChoice.target_speaker_id || null,
                            directive_kind: matchedChoice.directive_kind || null,
                            source_revision: matchedChoice.source_revision ?? null,
                            choice_batch_id: matchedChoice.choice_batch_id || null,
                        };
                    }
                }
                applySuggestedChoice(root, button.dataset.choicePrompt, { choiceMetadata });
                return;
            }

            if (button.dataset.choiceFreeform === "true") {
                applySuggestedChoice(root, "", { freeform: true });
                return;
            }

            const slotSaveId = Number.parseInt(button.dataset.slotSave || "", 10);
            if (Number.isInteger(slotSaveId)) {
                void saveState(slotSaveId);
                return;
            }

            const slotLoadId = Number.parseInt(button.dataset.slotLoad || "", 10);
            if (Number.isInteger(slotLoadId)) {
                void loadState(slotLoadId);
                return;
            }

            const slotArchiveId = Number.parseInt(button.dataset.slotArchive || "", 10);
            if (Number.isInteger(slotArchiveId)) {
                void archiveState(slotArchiveId);
            }
        });
    }

    function renderEmptyView(root) {
        let html = "";
        html += `<div class="section-title">故事模式 <span class="text-muted text-xs">Phase 1</span></div>`;
        html += `<div class="card">`;
        html += `<div class="section-title" style="margin-top:0">创建故事线程</div>`;
        html += `<div class="field"><label class="field__label">角色 A 名称</label>`;
        html += `<input type="text" data-input="castA_name" value="${esc(castDraftA.displayName)}" /></div>`;
        html += `<div class="field"><label class="field__label">角色 A 人设</label>`;
        html += `${renderPersonaSelect("castA_model", castDraftA.modelKey)}</div>`;
        html += `<div class="field"><label class="field__label">角色 A 音色</label>`;
        html += `${renderVoiceSelect("castA_voice", castDraftA.voiceProfileKey)}</div>`;
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`;
        html += `<div class="field"><label class="field__label">角色 A 字幕色</label><input type="color" data-input="castA_subtitle_color" value="${esc(castDraftA.subtitleColor)}" /></div>`;
        html += `<div class="field"><label class="field__label">角色 A 时间线色</label><input type="color" data-input="castA_timeline_color" value="${esc(castDraftA.timelineColor)}" /></div>`;
        html += `</div>`;
        html += `<div class="field"><label class="field__label">角色 B 名称</label>`;
        html += `<input type="text" data-input="castB_name" value="${esc(castDraftB.displayName)}" /></div>`;
        html += `<div class="field"><label class="field__label">角色 B 人设</label>`;
        html += `${renderPersonaSelect("castB_model", castDraftB.modelKey)}</div>`;
        html += `<div class="field"><label class="field__label">角色 B 音色</label>`;
        html += `${renderVoiceSelect("castB_voice", castDraftB.voiceProfileKey)}</div>`;
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`;
        html += `<div class="field"><label class="field__label">角色 B 字幕色</label><input type="color" data-input="castB_subtitle_color" value="${esc(castDraftB.subtitleColor)}" /></div>`;
        html += `<div class="field"><label class="field__label">角色 B 时间线色</label><input type="color" data-input="castB_timeline_color" value="${esc(castDraftB.timelineColor)}" /></div>`;
        html += `</div>`;
        html += `<div class="field"><label class="field__label">场景目标</label>`;
        html += `<textarea data-input="scene_goal" rows="2" style="width:100%;resize:vertical">${esc(sceneGoalDraft)}</textarea></div>`;
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`;
        html += `<div class="field"><label class="field__label">场景名</label><input type="text" data-input="scene_label" value="${esc(sceneLabelDraft)}" /></div>`;
        html += `<div class="field"><label class="field__label">当前时间</label><input type="text" data-input="current_time_label" value="${esc(currentTimeLabelDraft)}" /></div>`;
        html += `</div>`;
        html += `<div class="field"><label class="field__label">旁白字幕色</label><input type="color" data-input="narrator_subtitle_color" value="${esc(getNarratorSubtitleColor())}" /></div>`;
        html += `<div class="text-muted text-xs" style="margin-bottom:8px">开始故事模式后，桌面会同时渲染这两个已选人格对应的 Live2D 模型。</div>`;
        html += `<button class="btn btn--primary mt-8" data-action="create-thread" ${busy || availablePersonaModels.length < 2 ? "disabled" : ""}>`;
        html += busy ? "创建中..." : "创建故事线程";
        html += `</button>`;
        html += `</div>`;
        html += `<div class="card">`;
        html += `<div class="section-title" style="margin-top:0">存档选单</div>`;
        html += renderStateSlots();
        html += `</div>`;
        root.innerHTML = html;
        mountedViewMode = "empty";
    }

    function renderThreadView(root) {
        let html = "";
        html += `<div class="section-title">故事模式 <span class="text-muted text-xs">Phase 1</span></div>`;
        html += `<div id="storyThreadSummary"></div>`;
        html += `<div id="storyNarratorState"></div>`;
        html += `<div id="storyCastConfig"></div>`;
        html += `<div class="card">`;
        html += `<div class="section-title" style="margin-top:0">发送消息</div>`;
        html += `<div style="display:flex;gap:8px">`;
        html += `<input type="text" id="storyInput" value="${esc(storyInputDraft)}" placeholder="输入消息..." style="flex:1" />`;
        html += `<button class="btn btn--primary" id="btnSubmitTurn" data-action="submit-turn">发送</button>`;
        html += `</div>`;
        html += `<div class="text-muted text-xs" style="margin-top:8px" id="storyComposerHelp"></div>`;
        html += `<div id="storyComposerSuggestions"></div>`;
        html += `</div>`;
        html += `<div class="card">`;
        html += `<div class="section-title" style="margin-top:0">存档选单</div>`;
        html += `<div id="storySlotList"></div>`;
        html += `</div>`;
        html += `<div class="card">`;
        html += `<div class="section-title" style="margin-top:0" id="storyTimelineTitle"></div>`;
        html += `<div id="storyTimelineBody"></div>`;
        html += `</div>`;
        html += `<div id="storyStageState"></div>`;
        root.innerHTML = html;
        mountedViewMode = "thread";
        updateThreadView(root);
    }

    function renderTab(root) {
        mountedRoot = root;
        ensureRootBindings(root);
        if (!thread) {
            renderEmptyView(root);
            return;
        }
        renderThreadView(root);
    }

    function readDraftInputs(container) {
        const values = {};
        container.querySelectorAll("[data-input]").forEach((el) => {
            values[el.dataset.input] = el.value;
        });
        return values;
    }

    void ensureAvailablePersonaModels();
    void loadCurrentState();
    setInterval(() => {
        if (!thread && !orchestratorStatus.running) {
            return;
        }
        void loadCurrentState();
    }, STATUS_POLL_INTERVAL_MS);

    return { renderTab, captureRenderState };
}
