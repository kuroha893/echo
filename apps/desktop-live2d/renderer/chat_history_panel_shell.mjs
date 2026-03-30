const MAX_UPLOAD_IMAGES = 4;
const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function parseDataURL(dataURL) {
  const match = dataURL.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) return null;
  return { media_type: match[1], data: match[2], detail: "auto" };
}

function buildImageDataUrl(image) {
  if (!image || typeof image.media_type !== "string" || typeof image.data !== "string") {
    return null;
  }
  return `data:${image.media_type};base64,${image.data}`;
}

function buildMessageElement(message) {
  const item = document.createElement("article");
  item.className = `chat-panel__message chat-panel__message--${message.role}`;
  item.dataset.entryId = message.entryId;

  const header = document.createElement("div");
  header.className = "chat-panel__message-header";
  header.textContent = message.roleLabel;

  const body = document.createElement("p");
  body.className = "chat-panel__message-body";
  body.textContent = message.text;

  item.append(header, body);

  if (Array.isArray(message.images) && message.images.length > 0) {
    const images = document.createElement("div");
    images.className = "chat-panel__message-images";
    for (const image of message.images) {
      const src = buildImageDataUrl(image);
      if (!src) continue;
      const img = document.createElement("img");
      img.src = src;
      img.alt = message.role === "user" ? "sent image" : "message image";
      img.loading = "lazy";
      images.appendChild(img);
    }
    if (images.childElementCount > 0) {
      item.appendChild(images);
    }
  }

  if (message.isStreaming) {
    const streamingBadge = document.createElement("span");
    streamingBadge.className = "chat-panel__message-streaming";
    streamingBadge.textContent = "streaming";
    item.append(streamingBadge);
  }

  return item;
}

export class DesktopLive2DChatHistoryPanelShell {
  constructor({
    mountElement,
    desktopApi = null
  }) {
    this._mountElement = mountElement;
    this._desktopApi = desktopApi;
    this._changeHandler = null;
    this._submitHandler = null;
    this._rootElement = document.createElement("aside");
    this._rootElement.className = "chat-panel";

    this._headerElement = document.createElement("header");
    this._headerElement.className = "chat-panel__header";

    this._titleElement = document.createElement("h2");
    this._titleElement.className = "chat-panel__title";
    this._titleElement.textContent = "Current Session";

    this._sessionBadgeElement = document.createElement("span");
    this._sessionBadgeElement.className = "chat-panel__session";

    const windowControls = document.createElement("div");
    windowControls.className = "chat-panel__window-controls";

    this._minimizeButton = document.createElement("button");
    this._minimizeButton.className = "chat-panel__window-btn";
    this._minimizeButton.type = "button";
    this._minimizeButton.textContent = "\u2014";
    this._minimizeButton.title = "Minimize";
    this._minimizeButton.addEventListener("click", () => {
      this._desktopApi?.minimizeCurrentWindow?.();
    });

    this._closeButton = document.createElement("button");
    this._closeButton.className = "chat-panel__window-btn chat-panel__window-btn--close";
    this._closeButton.type = "button";
    this._closeButton.textContent = "\u00D7";
    this._closeButton.title = "Close";
    this._closeButton.addEventListener("click", () => {
      this._desktopApi?.closeCurrentWindow?.();
    });

    windowControls.append(this._minimizeButton, this._closeButton);

    this._headerElement.append(this._titleElement, this._sessionBadgeElement, windowControls);

    this._historyElement = document.createElement("section");
    this._historyElement.className = "chat-panel__history";
    this._historyElement.setAttribute("aria-live", "polite");

    this._emptyStateElement = document.createElement("div");
    this._emptyStateElement.className = "chat-panel__empty";
    this._emptyStateElement.textContent =
      "This desktop session will show user and assistant turns here.";

    this._statusElement = document.createElement("div");
    this._statusElement.className = "chat-panel__status";

    this._formElement = document.createElement("form");
    this._formElement.className = "chat-panel__composer";

    this._textareaElement = document.createElement("textarea");
    this._textareaElement.className = "chat-panel__input";
    this._textareaElement.rows = 3;
    this._textareaElement.autofocus = true;
    this._textareaElement.placeholder = "Type to Echo...";

    this._submitButton = document.createElement("button");
    this._submitButton.className = "chat-panel__send";
    this._submitButton.type = "submit";
    this._submitButton.textContent = "Send";

    this._imageInput = document.createElement("input");
    this._imageInput.type = "file";
    this._imageInput.accept = ALLOWED_IMAGE_TYPES.join(",");
    this._imageInput.multiple = true;
    this._imageInput.hidden = true;

    this._imageButton = document.createElement("button");
    this._imageButton.className = "chat-panel__image-btn";
    this._imageButton.type = "button";
    this._imageButton.title = "Attach image";
    this._imageButton.textContent = "\uD83D\uDDBC";

    this._imageCounter = document.createElement("span");
    this._imageCounter.className = "chat-panel__image-counter";

    this._imagePreview = document.createElement("div");
    this._imagePreview.className = "chat-panel__image-preview";

    this._pendingImages = [];
    this._imageChangeHandler = null;
    this._createSessionHandler = null;
    this._switchSessionHandler = null;
    this._deleteSessionHandler = null;
    this._forkSessionHandler = null;

    this._sessionListElement = document.createElement("nav");
    this._sessionListElement.className = "chat-panel__session-list";

    this._newSessionButton = document.createElement("button");
    this._newSessionButton.className = "chat-panel__new-session-btn";
    this._newSessionButton.type = "button";
    this._newSessionButton.textContent = "+ New Session";
    this._newSessionButton.addEventListener("click", () => {
      this._createSessionHandler?.();
    });

    this._sessionListContainer = document.createElement("div");
    this._sessionListContainer.className = "chat-panel__session-items";

    this._sessionListElement.append(this._newSessionButton, this._sessionListContainer);

    const toolbar = document.createElement("div");
    toolbar.className = "chat-panel__composer-toolbar";
    toolbar.append(this._imageButton, this._imageCounter, this._submitButton);

    this._formElement.append(this._imagePreview, this._textareaElement, toolbar, this._imageInput);
    this._rootElement.append(
      this._headerElement,
      this._sessionListElement,
      this._historyElement,
      this._emptyStateElement,
      this._statusElement,
      this._formElement
    );
    this._mountElement.appendChild(this._rootElement);
  }

  attach({
    onComposerChange,
    onSubmit,
    onImagesChange,
    onCreateSession,
    onSwitchSession,
    onDeleteSession,
    onForkSession
  }) {
    this._changeHandler = onComposerChange;
    this._submitHandler = onSubmit;
    this._imageChangeHandler = onImagesChange || null;
    this._createSessionHandler = onCreateSession || null;
    this._switchSessionHandler = onSwitchSession || null;
    this._deleteSessionHandler = onDeleteSession || null;
    this._forkSessionHandler = onForkSession || null;
    this._textareaElement.addEventListener("input", (event) => {
      this._changeHandler?.(event.currentTarget.value);
    });
    this._formElement.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this._submitHandler?.();
    });

    this._imageButton.addEventListener("click", () => {
      this._imageInput.click();
    });

    this._imageInput.addEventListener("change", () => {
      const files = Array.from(this._imageInput.files || []);
      this._addImageFiles(files);
      this._imageInput.value = "";
    });

    this._textareaElement.addEventListener("paste", (event) => {
      const clipboardItems = event.clipboardData?.items;
      if (!clipboardItems) return;
      const imageFiles = [];
      for (const item of clipboardItems) {
        if (item.kind === "file" && ALLOWED_IMAGE_TYPES.includes(item.type)) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        event.preventDefault();
        this._addImageFiles(imageFiles);
      }
    });

    this._formElement.addEventListener("dragover", (event) => {
      event.preventDefault();
      this._formElement.classList.add("chat-panel__composer--dragover");
    });

    this._formElement.addEventListener("dragleave", () => {
      this._formElement.classList.remove("chat-panel__composer--dragover");
    });

    this._formElement.addEventListener("drop", (event) => {
      event.preventDefault();
      this._formElement.classList.remove("chat-panel__composer--dragover");
      const files = Array.from(event.dataTransfer?.files || []).filter(
        (f) => ALLOWED_IMAGE_TYPES.includes(f.type)
      );
      this._addImageFiles(files);
    });
  }

  async _addImageFiles(files) {
    for (const file of files) {
      if (this._pendingImages.length >= MAX_UPLOAD_IMAGES) break;
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) continue;
      if (file.size > MAX_UPLOAD_IMAGE_BYTES) continue;
      try {
        const dataURL = await readFileAsDataURL(file);
        const parsed = parseDataURL(dataURL);
        if (!parsed) continue;
        this._pendingImages.push({ ...parsed, previewURL: dataURL });
      } catch {
        continue;
      }
    }
    this._renderImagePreview();
    this._imageChangeHandler?.(this.getPendingImageAttachments());
  }

  _renderImagePreview() {
    this._imagePreview.replaceChildren();
    for (let i = 0; i < this._pendingImages.length; i++) {
      const entry = this._pendingImages[i];
      const thumb = document.createElement("div");
      thumb.className = "chat-panel__image-thumb";

      const img = document.createElement("img");
      img.src = entry.previewURL;
      img.alt = "upload preview";

      const removeBtn = document.createElement("button");
      removeBtn.className = "chat-panel__image-remove";
      removeBtn.type = "button";
      removeBtn.textContent = "\u00D7";
      removeBtn.addEventListener("click", () => {
        this._pendingImages.splice(i, 1);
        this._renderImagePreview();
        this._imageChangeHandler?.(this.getPendingImageAttachments());
      });

      thumb.append(img, removeBtn);
      this._imagePreview.appendChild(thumb);
    }
    this._imageCounter.textContent =
      this._pendingImages.length > 0
        ? `${this._pendingImages.length}/${MAX_UPLOAD_IMAGES}`
        : "";
    this._imageButton.disabled = this._pendingImages.length >= MAX_UPLOAD_IMAGES;
  }

  getPendingImageAttachments() {
    return this._pendingImages.map(({ media_type, data, detail }) => ({
      media_type,
      data,
      detail,
    }));
  }

  getPendingImages() {
    return this._pendingImages.map(({ media_type, data, detail, previewURL }) => ({
      media_type,
      data,
      detail,
      previewURL,
    }));
  }

  clearPendingImages() {
    this._pendingImages = [];
    this._renderImagePreview();
  }

  render(viewModel) {
    this._sessionBadgeElement.textContent = viewModel.sessionId
      ? `session ${String(viewModel.sessionId).slice(0, 8)}`
      : "no session yet";
    this._statusElement.textContent = viewModel.statusText;
    this._statusElement.hidden = !viewModel.statusText;
    this._textareaElement.value = viewModel.composerText;
    this._textareaElement.disabled = !viewModel.serviceReady || viewModel.isSubmitting;
    this._submitButton.disabled = !viewModel.canSubmit;
    this._submitButton.textContent = viewModel.isSubmitting ? "Sending..." : "Send";

    this._historyElement.replaceChildren();
    for (const message of viewModel.messages) {
      this._historyElement.appendChild(buildMessageElement(message));
    }
    this._emptyStateElement.hidden = viewModel.messages.length > 0;

    this._renderSessionList(viewModel.sessions, viewModel.activeSessionId);
  }

  _renderSessionList(sessions, activeSessionId) {
    this._sessionListContainer.replaceChildren();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return;
    }
    for (const session of sessions) {
      const item = document.createElement("div");
      const isActive = session.session_id === activeSessionId;
      item.className = `chat-panel__session-item${isActive ? " chat-panel__session-item--active" : ""}`;
      item.dataset.sessionId = session.session_id;

      const titleSpan = document.createElement("span");
      titleSpan.className = "chat-panel__session-item-title";
      titleSpan.textContent = session.title || `Session ${session.session_id.slice(0, 8)}`;
      titleSpan.addEventListener("click", () => {
        if (!isActive) {
          this._switchSessionHandler?.(session.session_id);
        }
      });

      const actionsContainer = document.createElement("span");
      actionsContainer.className = "chat-panel__session-item-actions";

      const forkBtn = document.createElement("button");
      forkBtn.className = "chat-panel__session-action-btn";
      forkBtn.type = "button";
      forkBtn.title = "Fork";
      forkBtn.textContent = "\u2442";
      forkBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._forkSessionHandler?.(session.session_id);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "chat-panel__session-action-btn chat-panel__session-action-btn--delete";
      deleteBtn.type = "button";
      deleteBtn.title = "Delete";
      deleteBtn.textContent = "\u00D7";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._deleteSessionHandler?.(session.session_id);
      });

      actionsContainer.append(forkBtn, deleteBtn);
      item.append(titleSpan, actionsContainer);
      this._sessionListContainer.appendChild(item);
    }
  }

  destroy() {
    this._rootElement.remove();
  }
}
