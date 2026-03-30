import {
  buildLocalFastDraftTemplate,
  describeLocalFastAcceleration,
  buildProviderReadinessItems,
  buildProviderSettingsDraft,
  cloneValue,
  getMaskedSecretLabel,
  getValueByPath,
  setValueByPath,
  summarizeProviderReadiness
} from "./provider_settings_helpers.mjs";

const CONFIG_TABS = [
  { id: "overview", label: "overview" },
  { id: "avatar_model", label: "avatar model" },
  { id: "local_fast_llm", label: "local fast (optional)" },
  { id: "cloud_primary_llm", label: "cloud-primary-llm" },
  { id: "qwen_tts", label: "qwen-tts" },
  { id: "voice_enrollment", label: "voice enrollment" },
  { id: "language_settings", label: "language" },
  { id: "readiness", label: "readiness" }
];

const SUPPORTED_LANGUAGES = [
  { value: "", label: "not set" },
  { value: "中文", label: "中文" },
  { value: "日本語", label: "日本語" },
  { value: "English", label: "English" }
];

const AUDIO_FILE_EXTENSION_PATTERN = /\.(wav|mp3|ogg|flac|m4a|aac|webm|mp4)$/i;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeSecretUpdateMode(mode) {
  return mode === "replace" || mode === "clear" ? mode : "keep";
}

function buildSecretViewModel(sectionSnapshot, sectionDraft, pathPrefix) {
  return {
    statusLabel: getMaskedSecretLabel(sectionSnapshot?.api_key),
    updateMode: normalizeSecretUpdateMode(sectionDraft?.api_key_update?.mode),
    replacementText: sectionDraft?.api_key_update?.replacement_text || "",
    modePath: `${pathPrefix}.api_key_update.mode`,
    replacementPath: `${pathPrefix}.api_key_update.replacement_text`
  };
}

function buildDefaultVoiceEnrollmentDraft(settingsSnapshot, previousDraft = null) {
  return {
    display_name:
      settingsSnapshot?.qwen_tts?.voice_display_name ||
      previousDraft?.display_name ||
      "Desktop Voice",
    selected_audio_file: previousDraft?.selected_audio_file || null,
    selected_audio_name: previousDraft?.selected_audio_name || "",
    selected_audio_type: previousDraft?.selected_audio_type || "",
    selected_audio_size: previousDraft?.selected_audio_size || 0
  };
}

function getErrorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

function formatByteSize(byteSize) {
  const value = Number(byteSize || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "size unavailable";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function validateEnrollmentAudioFile(file) {
  if (!file || typeof file !== "object") {
    throw new Error("Voice enrollment requires an audio file.");
  }
  const fileName = String(file.name || "").trim();
  const mediaType = String(file.type || "").trim();
  const looksLikeAudio =
    mediaType.toLowerCase().startsWith("audio/") ||
    AUDIO_FILE_EXTENSION_PATTERN.test(fileName);
  if (!looksLikeAudio) {
    throw new Error("Voice enrollment only accepts audio files.");
  }
  if (!fileName) {
    throw new Error("Audio upload is missing a file name.");
  }
  if (typeof file.arrayBuffer !== "function") {
    throw new Error("Audio upload could not read the selected file.");
  }
  return {
    file,
    name: fileName,
    mediaType: mediaType || "audio/unknown",
    size: Number(file.size || 0)
  };
}

export class DesktopWebConfigSurfaceController {
  constructor({ shell, client }) {
    this._shell = shell;
    this._client = client;
    this._state = {
      settingsSnapshot: null,
      avatarModelLibrary: null,
      readiness: null,
      draft: null,
      voiceEnrollmentDraft: buildDefaultVoiceEnrollmentDraft(null),
      lastEnrollmentResult: null,
      lastEnrollmentErrorText: "",
      enrollmentSelectionErrorText: "",
      enrollmentBusy: false,
      avatarModelBusy: false,
      avatarModelStatusText: "",
      avatarModelStatusError: false,
      activeTabId: CONFIG_TABS[0].id,
      statusText: "Loading settings...",
      statusError: false,
      themePreference: "dark"
    };
  }

  async boot() {
    this._shell.attach({
      onSelectTab: (tabId) => {
        this._state.activeTabId = tabId;
        this._render();
      },
      onFieldChange: ({ path, value }) => {
        if (path === "voice_enrollment.display_name") {
          this._state.voiceEnrollmentDraft.display_name = value;
        } else {
          setValueByPath(this._state.draft, path, value);
        }
        this._render();
      },
      onEnrollmentFileSelected: (file) => this.selectEnrollmentFile(file),
      onClearEnrollmentFile: () => this.clearEnrollmentFile(),
      onEnableLocalFast: () => {
        this._state.draft.local_fast_llm = buildLocalFastDraftTemplate();
        this._render();
      },
      onDisableLocalFast: () => {
        this._state.draft.local_fast_llm = null;
        this._render();
      },
      onThemeChange: (value) => {
        this._state.themePreference = value;
        this._render();
      },
      onSaveAvatarModelSelection: async (modelKey) => {
        await this.saveAvatarModelSelection(modelKey);
      },
      onRunEnrollment: async () => {
        await this.runEnrollment();
      },
      onLoad: async () => {
        await this.reload();
      },
      onSave: async () => {
        await this.save();
      },
      onValidate: async () => {
        await this.validate();
      }
    });
    await this.reload();
  }

  selectEnrollmentFile(file) {
    try {
      const normalizedFile = validateEnrollmentAudioFile(file);
      this._state.voiceEnrollmentDraft.selected_audio_file = normalizedFile.file;
      this._state.voiceEnrollmentDraft.selected_audio_name = normalizedFile.name;
      this._state.voiceEnrollmentDraft.selected_audio_type = normalizedFile.mediaType;
      this._state.voiceEnrollmentDraft.selected_audio_size = normalizedFile.size;
      this._state.enrollmentSelectionErrorText = "";
      this._state.lastEnrollmentErrorText = "";
    } catch (error) {
      this._state.voiceEnrollmentDraft.selected_audio_file = null;
      this._state.voiceEnrollmentDraft.selected_audio_name = "";
      this._state.voiceEnrollmentDraft.selected_audio_type = "";
      this._state.voiceEnrollmentDraft.selected_audio_size = 0;
      this._state.enrollmentSelectionErrorText = getErrorMessage(error);
    }
    this._render();
  }

  clearEnrollmentFile() {
    this._state.voiceEnrollmentDraft.selected_audio_file = null;
    this._state.voiceEnrollmentDraft.selected_audio_name = "";
    this._state.voiceEnrollmentDraft.selected_audio_type = "";
    this._state.voiceEnrollmentDraft.selected_audio_size = 0;
    this._state.enrollmentSelectionErrorText = "";
    this._render();
  }

  async reload() {
    const [settingsResult, avatarModelLibrary] = await Promise.all([
      this._client.loadProviderSettings(),
      this._client.loadAvatarModelLibrary()
    ]);
    this._syncSettingsState(settingsResult);
    this._syncAvatarModelLibraryState(avatarModelLibrary);
    this._state.statusText = "Settings loaded";
    this._state.statusError = false;
    this._render();
  }

  async save() {
    const result = await this._client.saveProviderSettings(cloneValue(this._state.draft));
    this._syncSettingsState(result);
    this._state.statusText = "Settings saved";
    this._state.statusError = false;
    this._render();
  }

  async validate() {
    const result = await this._client.validateProviderSettings();
    this._state.readiness = result.readiness;
    this._state.statusText = "Readiness validated";
    this._state.statusError = false;
    this._render();
  }

  async runEnrollment() {
    const selectedFile = this._state.voiceEnrollmentDraft.selected_audio_file;
    try {
      validateEnrollmentAudioFile(selectedFile);
    } catch (error) {
      this._state.enrollmentSelectionErrorText = getErrorMessage(error);
      this._state.lastEnrollmentErrorText = "";
      this._state.statusText = "Voice enrollment failed";
      this._state.statusError = true;
      this._render();
      return;
    }

    this._state.enrollmentBusy = true;
    this._state.enrollmentSelectionErrorText = "";
    this._state.lastEnrollmentErrorText = "";
    this._state.statusText = "Uploading audio sample...";
    this._state.statusError = false;
    this._render();
    try {
      const uploadResult = await this._client.uploadVoiceEnrollmentAudio(selectedFile);
      this._state.statusText = "Running voice enrollment...";
      this._render();
      const result = await this._client.runTtsVoiceEnrollment({
        display_name: this._state.voiceEnrollmentDraft.display_name,
        reference_audio_path: uploadResult.persisted_reference_audio_path
      });
      this._state.lastEnrollmentResult = result;
      const refreshed = await this._client.loadProviderSettings();
      this._syncSettingsState(refreshed);
      this._state.statusText = "Voice enrollment finished";
      this._state.statusError = false;
    } catch (error) {
      this._state.lastEnrollmentResult = null;
      this._state.lastEnrollmentErrorText = getErrorMessage(error);
      this._state.statusText = "Voice enrollment failed";
      this._state.statusError = true;
    } finally {
      this._state.enrollmentBusy = false;
      this._render();
    }
  }

  async saveAvatarModelSelection(modelKey) {
    this._state.avatarModelBusy = true;
    this._state.avatarModelStatusText = "Applying avatar model...";
    this._state.avatarModelStatusError = false;
    this._render();
    try {
      const result = await this._client.saveAvatarModelSelection({
        selected_model_key: modelKey
      });
      this._syncAvatarModelLibraryState(result);
      this._state.avatarModelStatusText = "Avatar model applied";
      this._state.avatarModelStatusError = false;
    } catch (error) {
      this._state.avatarModelStatusText = getErrorMessage(error);
      this._state.avatarModelStatusError = true;
    } finally {
      this._state.avatarModelBusy = false;
      this._render();
    }
  }

  _syncSettingsState(result) {
    this._state.settingsSnapshot = result.settings_snapshot;
    this._state.readiness = result.readiness;
    this._state.draft = buildProviderSettingsDraft(result.settings_snapshot);
    this._state.voiceEnrollmentDraft = buildDefaultVoiceEnrollmentDraft(
      result.settings_snapshot,
      this._state.voiceEnrollmentDraft
    );
  }

  _syncAvatarModelLibraryState(result) {
    this._state.avatarModelLibrary = result;
  }

  buildViewModel() {
    const settingsSnapshot = this._state.settingsSnapshot;
    const draft = this._state.draft;
    const readinessSummary = summarizeProviderReadiness(this._state.readiness);
    const localFastSnapshot = settingsSnapshot?.local_fast_llm || null;
    const localFastDraft = draft?.local_fast_llm || null;
    const localFastAcceleration = describeLocalFastAcceleration(
      settingsSnapshot,
      this._state.readiness
    );
    return {
      tabs: CONFIG_TABS,
      activeTabId: this._state.activeTabId,
      statusText: this._state.statusText,
      statusError: this._state.statusError,
      themePreference: this._state.themePreference,
      readinessSummary,
      readinessItems: buildProviderReadinessItems(this._state.readiness),
      overviewCards: settingsSnapshot
        ? [
          {
            label: "Avatar model",
            value:
              this._state.avatarModelLibrary?.models?.find(
                (model) =>
                  model.model_key ===
                  this._state.avatarModelLibrary?.selected_model_key
              )?.display_name || "loading",
            meta: "Registered repo-owned Cubism model selected by stable model_key."
          },
          { label: "Cloud primary LLM", value: "required", meta: "Drives the production primary response path." },
          { label: "Qwen TTS", value: "required", meta: "Required for production speech and voice enrollment." },
          { label: "Local fast LLM", value: localFastAcceleration.value, meta: localFastAcceleration.meta }
        ]
        : [],
      sections:
        settingsSnapshot && draft
          ? {
            avatar_model: {
              title: "Avatar model library",
              helperCopy:
                "Echo only exposes registered repo-owned Cubism model3 packages from the local desktop avatar library. Selection persists by model_key, never by absolute path.",
              statusText: this._state.avatarModelStatusText,
              statusError: this._state.avatarModelStatusError,
              selectionBusy: this._state.avatarModelBusy,
              defaultModelKey:
                this._state.avatarModelLibrary?.default_model_key || null,
              selectedModelKey:
                this._state.avatarModelLibrary?.selected_model_key || null,
              models: (this._state.avatarModelLibrary?.models || []).map((model) => ({
                ...model,
                isSelected:
                  model.model_key ===
                  this._state.avatarModelLibrary?.selected_model_key,
                expressionsLabel:
                  model.supported_expressions.length > 0
                    ? model.supported_expressions.join(", ")
                    : "none",
                motionsLabel:
                  model.supported_motions.length > 0
                    ? model.supported_motions.join(", ")
                    : "none"
              }))
            },
            local_fast_llm: {
              title: "Local fast LLM (optional accelerator)",
              isConfigured: localFastDraft != null,
              emptyStateTitle: "Local fast LLM is currently unconfigured",
              emptyStateCopy:
                "Cloud-only production stays valid by default. Only enable this section if you explicitly want a localhost optional accelerator.",
              fields:
                localFastDraft == null
                  ? []
                  : [
                    ["Base URL", "local_fast_llm.base_url"],
                    ["Auth mode", "local_fast_llm.auth_mode"],
                    ["Intent model", "local_fast_llm.intent_model_name"],
                    ["Quick model", "local_fast_llm.quick_model_name"],
                    ["Local primary model", "local_fast_llm.local_primary_model_name"],
                    ["Timeout (ms)", "local_fast_llm.request_timeout_ms"]
                  ].map(([label, path]) => ({ label, path, value: getValueByPath(draft, path) })),
              secret:
                localFastDraft == null
                  ? null
                  : buildSecretViewModel(localFastSnapshot, localFastDraft, "local_fast_llm")
            },
            cloud_primary_llm: {
              title: "Cloud primary LLM (required)",
              fields: [
                ["Base URL", "cloud_primary_llm.base_url"],
                ["Primary model", "cloud_primary_llm.primary_model_name"],
                ["Timeout (ms)", "cloud_primary_llm.request_timeout_ms"],
                ["Organization ID", "cloud_primary_llm.organization_id"],
                ["Project ID", "cloud_primary_llm.project_id"]
              ].map(([label, path]) => ({ label, path, value: getValueByPath(draft, path) })),
              secret: buildSecretViewModel(
                settingsSnapshot.cloud_primary_llm,
                draft.cloud_primary_llm,
                "cloud_primary_llm"
              )
            },
            qwen_tts: {
              title: "Qwen TTS (required)",
              fields: [
                ["Base URL", "qwen_tts.base_url"],
                ["Timeout (ms)", "qwen_tts.request_timeout_ms"],
                ["Active synthesis model", "qwen_tts.standard_model_id"],
                ["Active system-or-enrolled voice", "qwen_tts.standard_voice_id"],
                ["Preferred media type", "qwen_tts.preferred_media_type"],
                ["Voice profile key", "qwen_tts.voice_profile_key"],
                ["Voice display name", "qwen_tts.voice_display_name"],
                ["Provider profile key", "qwen_tts.provider_profile_key"]
              ].map(([label, path]) => ({ label, path, value: getValueByPath(draft, path) })),
              secret: buildSecretViewModel(settingsSnapshot.qwen_tts, draft.qwen_tts, "qwen_tts")
            },
            voice_enrollment: {
              title: "Voice enrollment",
              fields: [
                {
                  label: "Voice display name",
                  path: "voice_enrollment.display_name",
                  value: this._state.voiceEnrollmentDraft.display_name
                }
              ],
              helperCopy:
                "Drop a local audio sample here or choose one from disk. The browser control plane will persist a bounded app-local temp file before invoking the existing voice-enrollment request.",
              activeVoiceCards: [
                { label: "Active synthesis model", value: settingsSnapshot.qwen_tts.standard_model_id || "not set" },
                { label: "Active system-or-enrolled voice", value: settingsSnapshot.qwen_tts.standard_voice_id || "not set" },
                { label: "Voice display name", value: settingsSnapshot.qwen_tts.voice_display_name || "not set" }
              ],
              selectedAudioSummary:
                this._state.voiceEnrollmentDraft.selected_audio_name
                  ? {
                    name: this._state.voiceEnrollmentDraft.selected_audio_name,
                    mediaType: this._state.voiceEnrollmentDraft.selected_audio_type || "audio/unknown",
                    size: formatByteSize(this._state.voiceEnrollmentDraft.selected_audio_size)
                  }
                  : null,
              selectionErrorText: this._state.enrollmentSelectionErrorText,
              resultItems:
                this._state.lastEnrollmentResult?.voice_profile == null
                  ? []
                  : [
                    { label: "Voice profile key", value: this._state.lastEnrollmentResult.voice_profile.voice_profile_key || "created" },
                    { label: "Display name", value: this._state.lastEnrollmentResult.voice_profile.display_name || this._state.voiceEnrollmentDraft.display_name || "created" }
                  ],
              resultErrorText: this._state.lastEnrollmentErrorText,
              submitLabel: this._state.enrollmentBusy ? "Running enrollment..." : "Run voice enrollment"
            },
            language_settings: {
              title: "Language settings",
              voiceLanguage: draft.voice_language || "",
              subtitleLanguage: draft.subtitle_language || "",
              bilingualActive:
                !!(draft.voice_language) &&
                !!(draft.subtitle_language) &&
                draft.voice_language !== draft.subtitle_language
            }
          }
          : null
    };
  }

  _render() {
    this._shell.render(this.buildViewModel());
  }
}

export class DesktopWebConfigSurfaceShell {
  constructor(documentObject) {
    this._document = documentObject;
    this._handlers = null;
    this._elements = {
      themeSelect: documentObject.getElementById("cv2ThemeSelect"),
      tabBar: documentObject.getElementById("cv2TabBar"),
      panelTitle: documentObject.getElementById("cv2PanelTitle"),
      panelBody: documentObject.getElementById("cv2PanelBody"),
      agentSummary: documentObject.getElementById("cv2AgentSummary"),
      status: documentObject.getElementById("cv2Status"),
      loadBtn: documentObject.getElementById("cv2LoadBtn"),
      saveBtn: documentObject.getElementById("cv2SaveBtn"),
      validateBtn: documentObject.getElementById("cv2ValidateBtn")
    };
  }

  attach(handlers) {
    this._handlers = handlers;
    this._elements.themeSelect?.addEventListener("change", (event) => {
      handlers.onThemeChange(event.target.value);
      this._document.documentElement.setAttribute(
        "data-theme",
        event.target.value === "light" ? "light" : "dark"
      );
    });
    this._elements.loadBtn?.addEventListener("click", async () => {
      await handlers.onLoad();
    });
    this._elements.saveBtn?.addEventListener("click", async () => {
      await handlers.onSave();
    });
    this._elements.validateBtn?.addEventListener("click", async () => {
      await handlers.onValidate();
    });
  }

  render(viewModel) {
    if (this._elements.themeSelect) {
      this._elements.themeSelect.value = viewModel.themePreference;
    }
    if (this._elements.status) {
      this._elements.status.textContent = viewModel.statusText;
      this._elements.status.className = `status ${viewModel.statusError ? "err" : "ok"}`;
    }
    this._renderTabs(viewModel);
    this._renderPanel(viewModel);
    this._renderAgentSummary(viewModel);
  }

  _renderTabs(viewModel) {
    if (!this._elements.tabBar) {
      return;
    }
    this._elements.tabBar.innerHTML = viewModel.tabs
      .map(
        (tab) => `
          <button
            type="button"
            class="cv2-tab"
            data-tab-id="${escapeHtml(tab.id)}"
            aria-selected="${tab.id === viewModel.activeTabId ? "true" : "false"}"
          >${escapeHtml(tab.label)}</button>
        `
      )
      .join("");
    for (const button of this._elements.tabBar.querySelectorAll("[data-tab-id]")) {
      button.addEventListener("click", () => {
        this._handlers.onSelectTab(button.dataset.tabId);
      });
    }
  }

  _renderPanel(viewModel) {
    const activeTab = viewModel.activeTabId;
    if (this._elements.panelTitle) {
      this._elements.panelTitle.textContent =
        activeTab === "overview"
          ? "Desktop provider settings"
          : activeTab === "avatar_model"
            ? "Avatar model library"
            : activeTab === "readiness"
              ? "Runtime readiness"
              : activeTab === "voice_enrollment"
                ? "Voice enrollment"
                : activeTab === "language_settings"
                  ? "Language settings"
                  : viewModel.sections?.[activeTab]?.title || "Desktop provider settings";
    }
    if (!this._elements.panelBody) {
      return;
    }
    if (activeTab === "overview") {
      this._elements.panelBody.innerHTML = `
        <div class="cv2-card-grid">
          ${viewModel.overviewCards
          .map(
            (card) => `
                <article class="cv2-card">
                  <div class="cv2-card-label">${escapeHtml(card.label)}</div>
                  <div class="cv2-card-value">${escapeHtml(card.value)}</div>
                  <div class="cv2-card-meta">${escapeHtml(card.meta)}</div>
                </article>
              `
          )
          .join("")}
        </div>
      `;
      return;
    }
    if (activeTab === "readiness") {
      this._elements.panelBody.innerHTML = `
        <section class="cv2-readiness-summary">
          <div class="cv2-readiness-title">${escapeHtml(viewModel.readinessSummary.runtimeStatus)}</div>
          <div class="cv2-readiness-message">${escapeHtml(viewModel.readinessSummary.runtimeMessage)}</div>
        </section>
        <div class="cv2-card-grid">
          ${viewModel.readinessItems
          .map(
            (item) => `
                <article class="cv2-card ${item.ready ? "is-ready" : "is-warning"}">
                  <div class="cv2-card-label">${escapeHtml(item.label)}</div>
                  <div class="cv2-card-value">${item.ready ? "ready" : "not ready"}</div>
                  <div class="cv2-card-meta">${escapeHtml(item.message)}</div>
                </article>
              `
          )
          .join("")}
        </div>
      `;
      return;
    }

    const section = viewModel.sections?.[activeTab];
    if (!section) {
      this._elements.panelBody.innerHTML = "";
      return;
    }

    if (activeTab === "avatar_model") {
      this._elements.panelBody.innerHTML = `
        <section class="cv2-inline-callout">
          <div class="cv2-inline-copy">${escapeHtml(section.helperCopy)}</div>
          ${section.statusText
          ? `<div class="cv2-inline-copy ${section.statusError ? "status err" : "status ok"}">${escapeHtml(section.statusText)}</div>`
          : ""
        }
        </section>
        <div class="cv2-card-grid">
          ${section.models
          .map(
            (model) => `
                <article class="cv2-card ${model.isSelected ? "is-ready" : ""}">
                  <div class="cv2-card-label">${escapeHtml(model.display_name)}</div>
                  <div class="cv2-card-value">${escapeHtml(model.model_key)}</div>
                  <div class="cv2-card-meta">${escapeHtml(model.presentation_mode)} | ${escapeHtml(model.window_surface)}</div>
                  <div class="cv2-card-meta">Expressions: ${escapeHtml(model.expressionsLabel)}</div>
                  <div class="cv2-card-meta">Motions: ${escapeHtml(model.motionsLabel)}</div>
                  <div class="cv2-upload-actions">
                    <button
                      type="button"
                      class="btn ${model.isSelected ? "" : "btn-send"}"
                      data-avatar-model-key="${escapeHtml(model.model_key)}"
                      ${section.selectionBusy ? "disabled" : ""}
                    >${model.isSelected ? "Current avatar" : "Switch to this avatar"}</button>
                    ${section.defaultModelKey === model.model_key
                ? '<span class="cv2-card-meta">default</span>'
                : ""
              }
                  </div>
                </article>
              `
          )
          .join("")}
        </div>
      `;
      for (const button of this._elements.panelBody.querySelectorAll("[data-avatar-model-key]")) {
        button.addEventListener("click", async () => {
          if (button.disabled) {
            return;
          }
          await this._handlers.onSaveAvatarModelSelection(button.dataset.avatarModelKey);
        });
      }
      return;
    }

    if (activeTab === "voice_enrollment") {
      this._elements.panelBody.innerHTML = `
        <section class="cv2-inline-callout">
          <div class="cv2-inline-copy">${escapeHtml(section.helperCopy)}</div>
        </section>
        <div class="cv2-card-grid">
          ${section.activeVoiceCards
          .map(
            (card) => `
                <article class="cv2-card">
                  <div class="cv2-card-label">${escapeHtml(card.label)}</div>
                  <div class="cv2-card-value">${escapeHtml(card.value)}</div>
                </article>
              `
          )
          .join("")}
        </div>
        <div class="cv2-form-grid cv2-enrollment-grid">
          ${section.fields
          .map(
            (field) => `
                <label class="cv2-field">
                  <span>${escapeHtml(field.label)}</span>
                  <input data-field-path="${escapeHtml(field.path)}" value="${escapeHtml(field.value ?? "")}" />
                </label>
              `
          )
          .join("")}
        </div>
        <section class="cv2-upload-panel">
          <input type="file" accept="audio/*" data-enrollment-file-input class="cv2-upload-file-input" />
          <div class="cv2-upload-dropzone" data-enrollment-drop-target tabindex="0">
            <div class="cv2-upload-title">Drop an audio sample here</div>
            <div class="cv2-upload-copy">or choose a local audio file for voice enrollment</div>
            <div class="cv2-upload-meta">Accepted audio types include wav, mp3, m4a, ogg, flac, aac, and webm.</div>
            <div class="cv2-upload-actions">
              <button type="button" class="btn" data-enrollment-action="browse">Choose audio file</button>
              ${section.selectedAudioSummary ? '<button type="button" class="btn" data-enrollment-action="clear">Clear</button>' : ""}
            </div>
          </div>
        </section>
        ${section.selectedAudioSummary
          ? `
              <section class="cv2-enrollment-result">
                <div class="cv2-secret-head">
                  <div class="cv2-secret-title">Selected audio sample</div>
                </div>
                <div class="cv2-card-grid">
                  <article class="cv2-card is-ready">
                    <div class="cv2-card-label">File name</div>
                    <div class="cv2-card-value">${escapeHtml(section.selectedAudioSummary.name)}</div>
                    <div class="cv2-card-meta">${escapeHtml(section.selectedAudioSummary.mediaType)} | ${escapeHtml(section.selectedAudioSummary.size)}</div>
                  </article>
                </div>
              </section>
            `
          : ""
        }
        ${section.selectionErrorText
          ? `
              <section class="cv2-enrollment-result cv2-enrollment-result-error">
                <div class="cv2-secret-head">
                  <div class="cv2-secret-title">Upload validation error</div>
                </div>
                <div class="cv2-inline-copy">${escapeHtml(section.selectionErrorText)}</div>
              </section>
            `
          : ""
        }
        <section class="cv2-enrollment-actions">
          <button type="button" class="btn btn-send" data-enrollment-action="run">${escapeHtml(section.submitLabel)}</button>
        </section>
        ${section.resultItems.length > 0
          ? `
              <section class="cv2-enrollment-result">
                <div class="cv2-secret-head">
                  <div class="cv2-secret-title">Latest enrollment result</div>
                </div>
                <div class="cv2-card-grid">
                  ${section.resultItems
            .map(
              (item) => `
                        <article class="cv2-card is-ready">
                          <div class="cv2-card-label">${escapeHtml(item.label)}</div>
                          <div class="cv2-card-value">${escapeHtml(item.value)}</div>
                        </article>
                      `
            )
            .join("")}
                </div>
              </section>
            `
          : ""
        }
        ${section.resultErrorText
          ? `
              <section class="cv2-enrollment-result cv2-enrollment-result-error">
                <div class="cv2-secret-head">
                  <div class="cv2-secret-title">Latest enrollment error</div>
                </div>
                <div class="cv2-inline-copy">${escapeHtml(section.resultErrorText)}</div>
              </section>
            `
          : ""
        }
      `;

      const fileInput = this._elements.panelBody.querySelector("[data-enrollment-file-input]");
      const dropTarget = this._elements.panelBody.querySelector("[data-enrollment-drop-target]");
      this._elements.panelBody.querySelector("[data-enrollment-action='browse']")?.addEventListener("click", () => {
        fileInput?.click();
      });
      this._elements.panelBody.querySelector("[data-enrollment-action='clear']")?.addEventListener("click", () => {
        if (fileInput) {
          fileInput.value = "";
        }
        this._handlers.onClearEnrollmentFile();
      });
      this._elements.panelBody.querySelector("[data-enrollment-action='run']")?.addEventListener("click", async () => {
        await this._handlers.onRunEnrollment();
      });
      for (const fieldElement of this._elements.panelBody.querySelectorAll("[data-field-path]")) {
        fieldElement.addEventListener("input", () => {
          this._handlers.onFieldChange({
            path: fieldElement.dataset.fieldPath,
            value: fieldElement.value
          });
        });
      }
      fileInput?.addEventListener("change", () => {
        const file = fileInput.files?.[0] || null;
        if (file) {
          this._handlers.onEnrollmentFileSelected(file);
        }
      });
      dropTarget?.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropTarget.classList.add("is-drag-over");
      });
      dropTarget?.addEventListener("dragleave", () => {
        dropTarget.classList.remove("is-drag-over");
      });
      dropTarget?.addEventListener("drop", (event) => {
        event.preventDefault();
        dropTarget.classList.remove("is-drag-over");
        const file = event.dataTransfer?.files?.[0] || null;
        if (file) {
          this._handlers.onEnrollmentFileSelected(file);
        }
      });
      dropTarget?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          fileInput?.click();
        }
      });
      return;
    }

    if (activeTab === "language_settings") {
      const langSection = section;
      const buildOptions = (selectedValue) =>
        SUPPORTED_LANGUAGES.map(
          (lang) =>
            `<option value="${escapeHtml(lang.value)}" ${lang.value === selectedValue ? "selected" : ""}>${escapeHtml(lang.label)}</option>`
        ).join("");
      this._elements.panelBody.innerHTML = `
        <section class="cv2-inline-callout">
          <div class="cv2-inline-copy">
            Configure voice and subtitle languages for bilingual mode.
            When voice and subtitle languages differ, the character speaks in one language while subtitles display in another.
          </div>
        </section>
        <div class="cv2-form-grid">
          <label class="cv2-field">
            <span>Voice language</span>
            <select data-field-path="voice_language">
              ${buildOptions(langSection.voiceLanguage)}
            </select>
          </label>
          <label class="cv2-field">
            <span>Subtitle language</span>
            <select data-field-path="subtitle_language">
              ${buildOptions(langSection.subtitleLanguage)}
            </select>
          </label>
        </div>
        <section class="cv2-inline-callout">
          <div class="cv2-inline-copy ${langSection.bilingualActive ? "status ok" : "status"}">
            ${langSection.bilingualActive
          ? `Bilingual mode active \u2014 voice: ${escapeHtml(langSection.voiceLanguage)}, subtitle: ${escapeHtml(langSection.subtitleLanguage)}`
          : "Bilingual mode inactive \u2014 set different voice and subtitle languages to activate"}
          </div>
        </section>
      `;
      for (const fieldElement of this._elements.panelBody.querySelectorAll("[data-field-path]")) {
        fieldElement.addEventListener("change", () => {
          this._handlers.onFieldChange({
            path: fieldElement.dataset.fieldPath,
            value: fieldElement.value
          });
        });
      }
      return;
    }

    if (activeTab === "local_fast_llm" && !section.isConfigured) {
      this._elements.panelBody.innerHTML = `
        <section class="cv2-empty-state">
          <div class="cv2-empty-title">${escapeHtml(section.emptyStateTitle)}</div>
          <div class="cv2-empty-copy">${escapeHtml(section.emptyStateCopy)}</div>
          <button type="button" class="btn btn-send" data-local-fast-action="enable">Enable local fast LLM</button>
        </section>
      `;
      this._elements.panelBody.querySelector("[data-local-fast-action='enable']")?.addEventListener("click", () => {
        this._handlers.onEnableLocalFast();
      });
      return;
    }

    this._elements.panelBody.innerHTML = `
      ${activeTab === "local_fast_llm"
        ? `
          <section class="cv2-inline-callout">
            <div class="cv2-inline-copy">This optional accelerator is explicitly enabled. Disable it to preserve a cloud-only production configuration.</div>
            <button type="button" class="btn" data-local-fast-action="disable">Disable</button>
          </section>
        `
        : ""}
      <div class="cv2-form-grid">
        ${section.fields
        .map(
          (field) => `
              <label class="cv2-field">
                <span>${escapeHtml(field.label)}</span>
                <input data-field-path="${escapeHtml(field.path)}" value="${escapeHtml(field.value ?? "")}" />
              </label>
            `
        )
        .join("")}
      </div>
      <section class="cv2-secret-panel">
        <div class="cv2-secret-head">
          <div class="cv2-secret-title">Masked secret</div>
          <div class="cv2-secret-status">${escapeHtml(section.secret.statusLabel)}</div>
        </div>
        <div class="cv2-secret-grid">
          <label class="cv2-field">
            <span>Secret action</span>
            <select data-field-path="${escapeHtml(section.secret.modePath)}">
              <option value="keep" ${section.secret.updateMode === "keep" ? "selected" : ""}>keep</option>
              <option value="replace" ${section.secret.updateMode === "replace" ? "selected" : ""}>replace</option>
              <option value="clear" ${section.secret.updateMode === "clear" ? "selected" : ""}>clear</option>
            </select>
          </label>
          <label class="cv2-field">
            <span>Replacement secret</span>
            <input type="password" data-field-path="${escapeHtml(section.secret.replacementPath)}" value="${escapeHtml(section.secret.replacementText)}" />
          </label>
        </div>
      </section>
    `;
    this._elements.panelBody.querySelector("[data-local-fast-action='disable']")?.addEventListener("click", () => {
      this._handlers.onDisableLocalFast();
    });
    for (const fieldElement of this._elements.panelBody.querySelectorAll("[data-field-path]")) {
      fieldElement.addEventListener("input", () => {
        this._handlers.onFieldChange({
          path: fieldElement.dataset.fieldPath,
          value: fieldElement.value
        });
      });
      fieldElement.addEventListener("change", () => {
        this._handlers.onFieldChange({
          path: fieldElement.dataset.fieldPath,
          value: fieldElement.value
        });
      });
    }
  }

  _renderAgentSummary(viewModel) {
    if (!this._elements.agentSummary) {
      return;
    }
    this._elements.agentSummary.innerHTML = `
      <div class="cv2-agent-card">
        <div class="cv2-agent-title">Desktop avatar + provider path</div>
        <div class="cv2-agent-copy">Echo keeps avatar selection inside a registered repo-owned Cubism model library. The cloud primary LLM and Qwen TTS still drive the production conversation path, while voice enrollment stays in Config v2 and accepts a dropped local audio file instead of a typed filesystem path.</div>
      </div>
      <div class="cv2-agent-card">
        <div class="cv2-agent-title">Runtime status</div>
        <div class="cv2-agent-copy">${escapeHtml(viewModel.readinessSummary.runtimeStatus)} | ${escapeHtml(viewModel.readinessSummary.runtimeMessage)}</div>
      </div>
    `;
  }
}

function encodeArrayBufferToBase64(arrayBuffer) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(arrayBuffer).toString("base64");
  }
  const byteArray = new Uint8Array(arrayBuffer);
  let binary = "";
  for (const byte of byteArray) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function createConfigSurfaceClient() {
  return {
    async loadAvatarModelLibrary() {
      const response = await fetch("/api/avatar-model-library");
      const payload = await response.json();
      if (payload.status !== "ok") {
        throw new Error(payload.message || "avatar model library load failed");
      }
      return payload.payload;
    },
    async saveAvatarModelSelection(selectionPayload) {
      const response = await fetch("/api/avatar-model-library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selectionPayload)
      });
      const payload = await response.json();
      if (payload.status !== "ok") {
        throw new Error(payload.message || "avatar model selection save failed");
      }
      return payload.payload;
    },
    async loadProviderSettings() {
      const response = await fetch("/api/provider-settings");
      const payload = await response.json();
      return payload.payload;
    },
    async saveProviderSettings(settingsPayload) {
      const response = await fetch("/api/provider-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settingsPayload)
      });
      const payload = await response.json();
      return payload.payload;
    },
    async validateProviderSettings() {
      const response = await fetch("/api/provider-settings/validate", { method: "POST" });
      const payload = await response.json();
      return payload.payload;
    },
    async uploadVoiceEnrollmentAudio(file) {
      const normalizedFile = validateEnrollmentAudioFile(file);
      const arrayBuffer = await normalizedFile.file.arrayBuffer();
      const response = await fetch("/api/tts-voice-enrollment-upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file_name: normalizedFile.name,
          media_type: normalizedFile.mediaType,
          data_base64: encodeArrayBufferToBase64(arrayBuffer)
        })
      });
      const payload = await response.json();
      if (payload.status !== "ok") {
        throw new Error(payload.message || "voice enrollment upload failed");
      }
      return payload.payload;
    },
    async runTtsVoiceEnrollment(enrollmentPayload) {
      const response = await fetch("/api/tts-voice-enrollment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(enrollmentPayload)
      });
      const payload = await response.json();
      if (payload.status !== "ok") {
        throw new Error(payload.message || "voice enrollment failed");
      }
      return payload.payload;
    }
  };
}

export async function bootDesktopWebConfigSurface(documentObject) {
  const shell = new DesktopWebConfigSurfaceShell(documentObject);
  const controller = new DesktopWebConfigSurfaceController({
    shell,
    client: createConfigSurfaceClient()
  });
  await controller.boot();
  return controller;
}
