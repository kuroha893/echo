// Echo Console Runtime — AIRI-style desktop settings panel.
// Renders tabs: Avatar Model, LLM, TTS, Voice Enrollment, Language, Display, Story Mode.

import {
  buildLocalFastDraftTemplate,
  buildProviderSettingsDraft,
} from "../../web-ui/public/provider_settings_helpers.mjs";
import { createStoryModeTabState } from "./story_mode_console_tab.mjs";

const TABS = [
  { id: "avatar", label: "模型" },
  { id: "llm", label: "LLM" },
  { id: "tts", label: "语音合成" },
  { id: "voice", label: "声音克隆" },
  { id: "language", label: "语言" },
  { id: "display", label: "显示" },
  { id: "storyMode", label: "故事模式" },
];

const LANGUAGES = [
  { value: "", label: "未设置" },
  { value: "zh", label: "中文" },
  { value: "ja", label: "日本語" },
  { value: "en", label: "English" },
];

function esc(text) {
  const d = document.createElement("div");
  d.textContent = String(text ?? "");
  return d.innerHTML;
}

function showToast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("toast--visible");
  clearTimeout(el._tid);
  el._tid = setTimeout(() => el.classList.remove("toast--visible"), 2200);
}

function normalizeSettingsResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("provider settings result is invalid");
  }
  if (!result.settings_snapshot || typeof result.settings_snapshot !== "object") {
    throw new Error("provider settings result missing settings_snapshot");
  }
  return result.settings_snapshot;
}

function buildSecretUpdate(value) {
  if (typeof value === "string" && value.trim() !== "") {
    return {
      mode: "replace",
      replacement_text: value.trim(),
    };
  }
  return { mode: "keep" };
}

function captureElementScrollState(element) {
  if (!element) {
    return null;
  }
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const distanceToBottom = Math.max(0, maxScrollTop - element.scrollTop);
  return {
    scrollTop: Math.max(0, element.scrollTop),
    wasNearBottom: distanceToBottom <= 24,
  };
}

function restoreElementScrollState(element, scrollState) {
  if (!element || !scrollState) {
    return;
  }
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  if (scrollState.wasNearBottom) {
    element.scrollTop = maxScrollTop;
    return;
  }
  element.scrollTop = Math.min(Math.max(0, scrollState.scrollTop), maxScrollTop);
}

function restoreElementScrollStateDeferred(element, scrollState) {
  if (!element || !scrollState) {
    return;
  }
  const applyRestore = () => restoreElementScrollState(element, scrollState);
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => {
      applyRestore();
      globalThis.requestAnimationFrame(applyRestore);
    });
    return;
  }
  globalThis.setTimeout(applyRestore, 0);
}

export function bootConsoleRuntime(api) {
  let settingsSnapshot = null;
  let draft = {};
  let modelLibrary = null;
  let clonedVoices = { active_voice_profile_key: null, voices: [] };
  let activeTab = "avatar";
  let voiceSelectedFilePath = "";
  let voiceEnrollmentBusy = false;
  let voiceEnrollmentMessageHtml = "";
  let personaPanelModelKey = null;
  let personaPanelTitle = "";
  let personaText = "";
  let personaOriginalText = "";
  let personaExists = false;
  let personaBusy = false;

  const storyTabState = createStoryModeTabState(api, showToast, () => renderContent());

  const contentArea = document.getElementById("contentArea");
  const sidebar = document.getElementById("sidebar");

  // ── Close button ──
  document.getElementById("btnClose")?.addEventListener("click", () => {
    api.closeCurrentWindow();
  });

  // ── Tab switching ──
  sidebar.addEventListener("click", (e) => {
    const item = e.target.closest("[data-tab]");
    if (!item) return;
    activeTab = item.dataset.tab;
    sidebar.querySelectorAll(".sidebar__item").forEach((el) => {
      el.classList.toggle("sidebar__item--active", el.dataset.tab === activeTab);
    });
    renderContent();
  });

  // ── Load data ──
  async function loadAll() {
    const [settingsResult, library, voiceLibrary] = await Promise.all([
      api.loadProviderSettings(),
      api.loadAvatarModelLibrary(),
      api.listClonedVoices(),
    ]);
    settingsSnapshot = normalizeSettingsResult(settingsResult);
    draft = buildProviderSettingsDraft(settingsSnapshot);
    modelLibrary = library;
    clonedVoices = voiceLibrary;
    renderContent();
  }

  // ── Save helpers ──
  async function saveSettings(partial) {
    Object.assign(draft, partial);
    const savedResult = await api.saveProviderSettings(draft);
    settingsSnapshot = normalizeSettingsResult(savedResult);
    draft = buildProviderSettingsDraft(settingsSnapshot);
    clonedVoices = await api.listClonedVoices();
    showToast("已保存");
    renderContent();
  }

  async function selectModel(modelKey) {
    const result = await api.saveAvatarModelSelection({ selected_model_key: modelKey });
    modelLibrary = result;
    showToast("模型已切换");
    renderContent();
  }

  async function scanModels() {
    try {
      await api.scanModelLibrary();
      modelLibrary = await api.loadAvatarModelLibrary();
      showToast("扫描完成");
      renderContent();
    } catch (err) {
      showToast("扫描失败: " + (err.message || err));
    }
  }

  async function openPersonaPanel(modelKey) {
    const model = modelLibrary?.models?.find((entry) => entry.model_key === modelKey) || null;
    personaPanelModelKey = modelKey;
    personaPanelTitle = model?.display_name || modelKey;
    personaBusy = true;
    renderContent();
    try {
      const result = await api.loadModelPersona(modelKey);
      if (personaPanelModelKey !== modelKey) {
        return;
      }
      personaText = String(result?.persona_text || "");
      personaOriginalText = personaText;
      personaExists = result?.exists === true;
    } catch (err) {
      if (personaPanelModelKey !== modelKey) {
        return;
      }
      personaText = "";
      personaOriginalText = "";
      personaExists = false;
      showToast("加载人格设定失败: " + (err.message || err));
    } finally {
      if (personaPanelModelKey === modelKey) {
        personaBusy = false;
        renderContent();
      }
    }
  }

  function closePersonaPanel() {
    personaPanelModelKey = null;
    personaPanelTitle = "";
    personaText = "";
    personaOriginalText = "";
    personaExists = false;
    personaBusy = false;
    renderContent();
  }

  async function savePersona() {
    if (!personaPanelModelKey || personaBusy) {
      return;
    }
    personaBusy = true;
    renderContent();
    try {
      const result = await api.saveModelPersona({
        model_key: personaPanelModelKey,
        persona_text: personaText
      });
      personaText = String(result?.persona_text || "");
      personaOriginalText = personaText;
      personaExists = true;
      showToast("人格设定已保存");
    } catch (err) {
      showToast("保存人格设定失败: " + (err.message || err));
    } finally {
      personaBusy = false;
      renderContent();
    }
  }

  // ── Render ──
  function renderContent() {
    if (!contentArea) return;
    const contentScrollState = captureElementScrollState(contentArea);
    if (activeTab === "storyMode") {
      storyTabState.captureRenderState(contentArea);
    }
    const renderer = TAB_RENDERERS[activeTab];
    if (renderer) {
      contentArea.innerHTML = "";
      renderer(contentArea);
      restoreElementScrollStateDeferred(contentArea, contentScrollState);
    }
  }

  // ── Tab Renderers ──
  const TAB_RENDERERS = {
    avatar: renderAvatarTab,
    llm: renderLLMTab,
    tts: renderTTSTab,
    voice: renderVoiceTab,
    language: renderLanguageTab,
    display: renderDisplayTab,
    storyMode: (root) => storyTabState.renderTab(root),
  };

  // ═══════════════════════════════════════
  //  AVATAR TAB
  // ═══════════════════════════════════════
  function renderAvatarTab(root) {
    const selected = modelLibrary?.selected_model_key || "";
    const models = modelLibrary?.models || [];
    let html = `<div class="avatar-workbench">`;
    html += `<section class="avatar-workbench__main">`;
    html += `<div class="section-title">模型库</div>`;
    html += `<div style="margin-bottom:12px">
      <button class="btn btn--primary" id="btnScanModels">⟳ 扫描模型库</button>
    </div>`;
    html += `<div class="model-grid">`;
    for (const m of models) {
      const active = m.model_key === selected;
      const exprCount = m.supported_expressions?.length ?? 0;
      const motionCount = m.supported_motions?.length ?? 0;
      html += `
        <div class="model-card ${active ? "model-card--active" : ""}" data-model-key="${esc(m.model_key)}">
          <div class="model-card__icon">🎭</div>
          <div class="model-card__info">
            <div class="model-card__name">${esc(m.display_name || m.model_key)}</div>
            <div class="model-card__meta">${exprCount} 表情 · ${motionCount} 动作</div>
          </div>
          <button class="model-card__action" data-persona-button="${esc(m.model_key)}" title="编辑人格设定">➜</button>
        </div>`;
    }
    html += `</div>`;
    html += `</section>`;
    html += renderPersonaDrawer();
    html += `</div>`;
    root.innerHTML = html;

    root.querySelector("#btnScanModels")?.addEventListener("click", scanModels);
    root.querySelectorAll(".model-card[data-model-key]").forEach((el) => {
      el.addEventListener("click", () => selectModel(el.dataset.modelKey));
    });
    root.querySelectorAll("[data-persona-button]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        openPersonaPanel(el.dataset.personaButton);
      });
    });
    root.querySelector("#personaBackdrop")?.addEventListener("click", closePersonaPanel);
    root.querySelector("#btnClosePersona")?.addEventListener("click", closePersonaPanel);
    root.querySelector("#btnSavePersona")?.addEventListener("click", savePersona);
    root.querySelector("#personaTextarea")?.addEventListener("input", (event) => {
      personaText = event.target.value;
    });
  }

  function renderPersonaDrawer() {
    const open = personaPanelModelKey != null;
    const dirty = personaText !== personaOriginalText;
    return `
      <div class="persona-layer ${open ? "persona-layer--open" : ""}">
        <button class="persona-layer__backdrop" id="personaBackdrop" aria-label="关闭人格设定面板"></button>
        <aside class="persona-drawer ${open ? "persona-drawer--open" : ""}">
          <div class="persona-drawer__header">
            <div>
              <div class="persona-drawer__eyebrow">Persona</div>
              <div class="persona-drawer__title">${esc(personaPanelTitle || "模型人格设定")}</div>
              <div class="persona-drawer__meta">${open ? (personaExists ? "编辑 persona.md" : "将新建 persona.md") : "点击模型卡片右侧箭头查看"}</div>
            </div>
            <button class="titlebar__btn" id="btnClosePersona" title="关闭">✕</button>
          </div>
          <div class="persona-drawer__body">
            ${open ? `
              <label class="field__label">人格设定 Markdown</label>
              <textarea id="personaTextarea" class="textarea" placeholder="在这里输入该模型对应的 persona.md 内容">${esc(personaText)}</textarea>
            ` : `
              <div class="persona-empty">在模型卡片右侧点击箭头，右侧会展开当前模型的 persona 编辑面板。</div>
            `}
          </div>
          <div class="persona-drawer__footer">
            <div class="text-xs text-muted">${open ? (dirty ? "有未保存修改" : "未修改") : ""}</div>
            <button class="btn btn--primary" id="btnSavePersona" ${open && !personaBusy ? "" : "disabled"}>${personaBusy ? "保存中…" : "保存 persona"}</button>
          </div>
        </aside>
      </div>`;
  }

  // ═══════════════════════════════════════
  //  LLM TAB
  // ═══════════════════════════════════════
  function renderLLMTab(root) {
    const cloud = draft?.cloud_primary_llm || {};
    const local = draft?.local_fast_llm || null;
    const cloudSnapshot = settingsSnapshot?.cloud_primary_llm || {};
    const localSnapshot = settingsSnapshot?.local_fast_llm || null;
    const localEnabled = local !== null;

    let html = `<div class="section-title">Cloud LLM</div>`;
    html += `<div class="card">`;
    html += field("Base URL", textInput("cloud_base_url", cloud.base_url || "https://api.openai.com/v1"));
    html += field("模型", textInput("cloud_model", cloud.primary_model_name || ""));
    html += field("API Key", apiKeyInput("cloud_api_key", cloudSnapshot.api_key?.is_configured));
    html += field("Organization ID", textInput("cloud_org_id", cloud.organization_id || "", "可选"));
    html += field("Project ID", textInput("cloud_project_id", cloud.project_id || "", "可选"));
    html += field("超时 (ms)", numberInput("cloud_timeout", cloud.request_timeout_ms ?? 30000));
    html += `<button class="btn btn--primary mt-8" id="btnSaveCloud">保存</button>`;
    html += `</div>`;

    html += `<div class="section-title mt-16">Local Fast LLM <span class="text-muted text-xs">（可选加速）</span></div>`;
    html += `<div class="card">`;
    html += switchRow("启用本地 LLM", "localLlmEnabled", localEnabled);
    if (localEnabled) {
      html += field("Base URL", textInput("local_base_url", local.base_url || "http://127.0.0.1:30000/v1"));
      html += field("认证模式", selectInput("local_auth_mode", local.auth_mode || "none", [
        { value: "none", label: "无认证" },
        { value: "bearer", label: "Bearer" },
        { value: "x-api-key", label: "X-API-Key" },
      ]));
      html += field("Intent 模型", textInput("local_intent_model", local.intent_model_name || ""));
      html += field("Quick 模型", textInput("local_quick_model", local.quick_model_name || ""));
      html += field("Primary 模型", textInput("local_primary_model", local.local_primary_model_name || ""));
      html += field("API Key", apiKeyInput("local_api_key", localSnapshot?.api_key?.is_configured));
      html += field("超时 (ms)", numberInput("local_timeout", local.request_timeout_ms ?? 4000));
    }
    html += `<button class="btn btn--primary mt-8" id="btnSaveLocal">保存</button>`;
    html += `</div>`;

    root.innerHTML = html;

    root.querySelector("#btnSaveCloud")?.addEventListener("click", () => {
      const val = readInputs(root);
      saveSettings({
        cloud_primary_llm: {
          ...(draft.cloud_primary_llm || {}),
          base_url: val.cloud_base_url,
          api_key_update: buildSecretUpdate(val.cloud_api_key),
          primary_model_name: val.cloud_model,
          organization_id: val.cloud_org_id || null,
          project_id: val.cloud_project_id || null,
          request_timeout_ms: parseInt(val.cloud_timeout) || 30000,
        },
      });
    });

    root.querySelector("#btnSaveLocal")?.addEventListener("click", () => {
      const val = readInputs(root);
      const enabled = root.querySelector("[data-switch=localLlmEnabled]")?.checked ?? false;
      if (!enabled) {
        saveSettings({ local_fast_llm: null });
        return;
      }
      saveSettings({
        local_fast_llm: {
          ...(draft.local_fast_llm || {}),
          base_url: val.local_base_url,
          auth_mode: val.local_auth_mode || "none",
          api_key_update: buildSecretUpdate(val.local_api_key),
          intent_model_name: val.local_intent_model,
          quick_model_name: val.local_quick_model,
          local_primary_model_name: val.local_primary_model,
          request_timeout_ms: parseInt(val.local_timeout) || 4000,
        },
      });
    });

    root.querySelector("[data-switch=localLlmEnabled]")?.addEventListener("change", (e) => {
      if (!e.target.checked) {
        draft.local_fast_llm = null;
      } else {
        draft.local_fast_llm = draft.local_fast_llm || buildLocalFastDraftTemplate();
      }
      renderContent();
    });
  }

  // ═══════════════════════════════════════
  //  TTS TAB
  // ═══════════════════════════════════════
  function renderTTSTab(root) {
    const tts = draft?.qwen_tts || {};
    const ttsSnapshot = settingsSnapshot?.qwen_tts || {};
    let html = `<div class="section-title">Qwen TTS</div>`;
    html += `<div class="card">`;
    html += field("Base URL", textInput("tts_base_url", tts.base_url || ""));
    html += field("标准模型", textInput("tts_standard_model_id", tts.standard_model_id || ""));
    html += field("标准 Voice ID", textInput("tts_standard_voice_id", tts.standard_voice_id || ""));
    html += field("实时模型", textInput("tts_realtime_model_id", tts.realtime_model_id || "", "可选"));
    html += field("实时 Voice ID", textInput("tts_realtime_voice_id", tts.realtime_voice_id || "", "可选"));
    html += field("API Key", apiKeyInput("tts_api_key", ttsSnapshot.api_key?.is_configured));
    html += field("超时 (ms)", numberInput("tts_timeout", tts.request_timeout_ms ?? 30000));
    html += field("Media Type", selectInput("tts_media_type", tts.preferred_media_type || "pcm_s16le", [
      { value: "wav", label: "WAV" },
      { value: "mp3", label: "MP3" },
      { value: "pcm_s16le", label: "PCM S16LE" },
    ]));
    html += field("Voice Profile Key", textInput("tts_voice_profile", tts.voice_profile_key || "", "可选"));
    html += field("Voice Display Name", textInput("tts_voice_display_name", tts.voice_display_name || ""));
    html += field("Provider Profile Key", textInput("tts_provider_profile", tts.provider_profile_key || "", "可选"));
    html += `<button class="btn btn--primary mt-8" id="btnSaveTTS">保存</button>`;
    html += `</div>`;

    root.innerHTML = html;

    root.querySelector("#btnSaveTTS")?.addEventListener("click", () => {
      const val = readInputs(root);
      saveSettings({
        qwen_tts: {
          ...(draft.qwen_tts || {}),
          base_url: val.tts_base_url,
          api_key_update: buildSecretUpdate(val.tts_api_key),
          request_timeout_ms: parseInt(val.tts_timeout) || 30000,
          standard_model_id: val.tts_standard_model_id,
          standard_voice_id: val.tts_standard_voice_id,
          realtime_model_id: val.tts_realtime_model_id || null,
          realtime_voice_id: val.tts_realtime_voice_id || null,
          preferred_media_type: val.tts_media_type,
          voice_profile_key: val.tts_voice_profile || "desktop.qwen3.current_voice",
          voice_display_name: val.tts_voice_display_name || "Desktop Voice",
          provider_profile_key: val.tts_provider_profile || "desktop.qwen3.default_profile",
        },
      });
    });
  }

  // ═══════════════════════════════════════
  //  VOICE ENROLLMENT TAB
  // ═══════════════════════════════════════
  function renderVoiceTab(root) {
    let html = `<div class="section-title">声音克隆</div>`;
    html += `<div class="card">`;
    html += `<div class="enrollment-drop" id="btnPickAudio">点击选择参考音频文件<br><span class="text-xs text-muted">支持 wav, mp3, ogg, flac, m4a, aac</span></div>`;
    html += `<div id="enrollmentFileInfo" class="mt-8 text-sm text-muted">${esc(voiceSelectedFilePath)}</div>`;
    html += field("显示名称", textInput("enroll_display_name", "", "自定义声音名称"), "mt-12");
    html += `<button class="btn btn--primary mt-8" id="btnEnroll" ${voiceSelectedFilePath && !voiceEnrollmentBusy ? "" : "disabled"}>${voiceEnrollmentBusy ? "克隆中…" : "开始克隆"}</button>`;
    html += `<div id="enrollmentResult" class="mt-12">${voiceEnrollmentMessageHtml}</div>`;
    html += `</div>`;
    html += `<div class="section-title mt-16">已克隆声音</div>`;
    html += renderClonedVoiceLibrary();

    root.innerHTML = html;

    root.querySelector("#btnPickAudio")?.addEventListener("click", async () => {
      const result = await api.chooseReferenceAudio();
      if (result.canceled || !result.filePath) return;
      voiceSelectedFilePath = result.filePath;
      renderContent();
    });

    root.querySelector("#btnEnroll")?.addEventListener("click", async () => {
      if (!voiceSelectedFilePath || voiceEnrollmentBusy) return;
      const displayName = root.querySelector("[data-input=enroll_display_name]")?.value || "custom_voice";
      voiceEnrollmentBusy = true;
      renderContent();
      try {
        const result = await api.runTTSVoiceEnrollment({
          reference_audio_path: voiceSelectedFilePath,
          display_name: displayName,
        });
        settingsSnapshot = normalizeSettingsResult(result);
        draft = buildProviderSettingsDraft(settingsSnapshot);
        clonedVoices = await api.listClonedVoices();
        voiceEnrollmentMessageHtml =
          `<div class="badge badge--ok">克隆成功</div>` +
          `<div class="text-sm mt-8">${esc(JSON.stringify(result, null, 2))}</div>`;
        showToast("声音克隆完成");
      } catch (err) {
        voiceEnrollmentMessageHtml =
          `<div class="badge badge--err">失败</div>` +
          `<div class="text-sm text-danger mt-8">${esc(err.message || err)}</div>`;
      } finally {
        voiceEnrollmentBusy = false;
        renderContent();
      }
    });
  }

  function renderClonedVoiceLibrary() {
    const voices = Array.isArray(clonedVoices?.voices) ? clonedVoices.voices : [];
    if (voices.length === 0) {
      return `<div class="card"><div class="text-sm text-muted">当前还没有已保存的克隆声音。完成一次克隆后会出现在这里。</div></div>`;
    }
    let html = `<div class="voice-library">`;
    for (const voice of voices) {
      html += `
        <div class="card voice-entry ${voice.is_active ? "voice-entry--active" : ""}">
          <div class="voice-entry__header">
            <div>
              <div class="voice-entry__title">${esc(voice.display_name || voice.voice_profile_key)}</div>
              <div class="text-xs text-muted">${esc(voice.voice_profile_key)}</div>
            </div>
            ${voice.is_active ? `<span class="badge badge--ok">当前使用中</span>` : ``}
          </div>
          <div class="voice-entry__meta">Provider: ${esc(voice.provider_key)}</div>
          <div class="voice-entry__meta">Voice ID: ${esc(voice.provider_voice_id)}</div>
          ${voice.provider_realtime_voice_id ? `<div class="voice-entry__meta">Realtime Voice ID: ${esc(voice.provider_realtime_voice_id)}</div>` : ``}
          ${voice.reference_audio_path ? `<div class="voice-entry__meta">参考音频: ${esc(voice.reference_audio_path)}</div>` : ``}
          <div class="voice-entry__meta">创建时间: ${esc(voice.created_at || "")}</div>
        </div>`;
    }
    html += `</div>`;
    return html;
  }

  // ═══════════════════════════════════════
  //  LANGUAGE TAB
  // ═══════════════════════════════════════
  function renderLanguageTab(root) {
    const voiceLang = draft?.voice_language || "";
    const subtitleLang = draft?.subtitle_language || "";
    let html = `<div class="section-title">语言设置</div>`;
    html += `<div class="card">`;
    html += field("语音语言", selectInput("voice_language", voiceLang, LANGUAGES));
    html += field("字幕语言", selectInput("subtitle_language", subtitleLang, LANGUAGES));
    html += `<button class="btn btn--primary mt-8" id="btnSaveLang">保存</button>`;
    html += `</div>`;

    root.innerHTML = html;

    root.querySelector("#btnSaveLang")?.addEventListener("click", () => {
      const val = readInputs(root);
      saveSettings({
        voice_language: val.voice_language || "",
        subtitle_language: val.subtitle_language || "",
      });
    });
  }

  // ═══════════════════════════════════════
  //  DISPLAY TAB
  // ═══════════════════════════════════════
  function renderDisplayTab(root) {
    let html = `<div class="section-title">显示与动画</div>`;
    html += `<div class="card">`;
    html += switchRow("说话时身体摇晃", "speakingMotionEnabled", false, "说话时模型会轻微摇晃身体");
    html += `</div>`;

    root.innerHTML = html;

    // Read current state from api
    api.getSpeakingMotionEnabled?.().then?.((enabled) => {
      const sw = root.querySelector("[data-switch=speakingMotionEnabled]");
      if (sw) sw.checked = enabled === true;
    }).catch?.(() => { });

    root.querySelector("[data-switch=speakingMotionEnabled]")?.addEventListener("change", (e) => {
      api.setSpeakingMotionEnabled?.(e.target.checked);
      showToast(e.target.checked ? "已开启身体摇晃" : "已关闭身体摇晃");
    });
  }

  // ═══════════════════════════════════════
  //  FORM HELPERS
  // ═══════════════════════════════════════
  function field(label, inputHtml, extraClass = "") {
    return `<div class="field ${extraClass}"><label class="field__label">${esc(label)}</label>${inputHtml}</div>`;
  }

  function textInput(name, value, placeholder = "") {
    return `<input type="text" data-input="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" />`;
  }

  function numberInput(name, value) {
    return `<input type="number" data-input="${name}" value="${esc(value)}" />`;
  }

  function apiKeyInput(name, configured = false) {
    const masked = configured ? "••••••••" : "";
    return `<div class="apikey-row">
      <input type="password" data-input="${name}" value="" placeholder="${masked || '请输入 API Key'}" />
    </div>`;
  }

  function selectInput(name, currentValue, options) {
    let html = `<select data-input="${name}">`;
    for (const opt of options) {
      const sel = opt.value === currentValue ? "selected" : "";
      html += `<option value="${esc(opt.value)}" ${sel}>${esc(opt.label)}</option>`;
    }
    html += `</select>`;
    return html;
  }

  function switchRow(label, name, checked, sublabel = "") {
    return `<div class="switch-row">
      <div>
        <div class="switch-row__label">${esc(label)}</div>
        ${sublabel ? `<div class="switch-row__sublabel">${esc(sublabel)}</div>` : ""}
      </div>
      <label class="switch">
        <input type="checkbox" data-switch="${name}" ${checked ? "checked" : ""} />
        <span class="switch__track"></span>
      </label>
    </div>`;
  }

  function readInputs(container) {
    const values = {};
    container.querySelectorAll("[data-input]").forEach((el) => {
      values[el.dataset.input] = el.value;
    });
    return values;
  }

  // ── Boot ──
  loadAll();
}
