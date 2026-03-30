function createSpeakerNode() {
  const label = document.createElement("div");
  label.className = "bubble-shell__speaker";
  return label;
}

export class DesktopLive2DBubbleShell {
  constructor({
    mountElement
  }) {
    this._mountElement = mountElement;
    this._rootElement = document.createElement("aside");
    this._rootElement.className = "bubble-shell bubble-shell--hidden";
    this._speakerElement = createSpeakerNode();
    this._linesElement = document.createElement("div");
    this._linesElement.className = "bubble-shell__lines";
    this._streamingBadge = document.createElement("span");
    this._streamingBadge.className = "bubble-shell__streaming";
    this._streamingBadge.textContent = "streaming";
    this._rootElement.append(
      this._speakerElement,
      this._linesElement,
      this._streamingBadge
    );
    this._mountElement.appendChild(this._rootElement);
    this._lastVisible = false;
  }

  render(snapshot) {
    const effectiveVisible =
      snapshot.bubble_visible === true &&
      typeof snapshot.bubble_text === "string" &&
      snapshot.bubble_text.length > 0;
    this._speakerElement.textContent = snapshot.speaker_label || "Echo";
    this._renderLines(effectiveVisible ? snapshot.bubble_text || "" : "");
    this._rootElement.classList.toggle(
      "bubble-shell--hidden",
      !effectiveVisible
    );
    if (effectiveVisible && !this._lastVisible) {
      this._rootElement.classList.remove("bubble-shell--pop-in");
      void this._rootElement.offsetHeight;
      this._rootElement.classList.add("bubble-shell--pop-in");
      setTimeout(() => {
        this._rootElement.classList.remove("bubble-shell--pop-in");
      }, 140);
    }
    this._rootElement.classList.toggle(
      "bubble-shell--streaming",
      effectiveVisible && snapshot.is_streaming
    );
    this._streamingBadge.hidden = !(effectiveVisible && snapshot.is_streaming);
    this._rootElement.dataset.lastAction = snapshot.last_action;
    this._rootElement.dataset.segmentCount = String(snapshot.segment_count);
    globalThis.__echoDesktopBubbleSetDebugState?.({
      shellClassName: this._rootElement.className,
      shellLineCount: this._linesElement.childElementCount,
      shellRenderedText: this._collectRenderedText()
    });
    this._lastVisible = effectiveVisible;
  }

  _renderLines(text) {
    this._linesElement.replaceChildren();
    const normalizedText = String(text)
      .replaceAll("<br/>", "\n")
      .replaceAll("<br />", "\n")
      .replaceAll("<br>", "\n");
    const allLines = normalizedText.split("\n").filter((l) => l.trim().length > 0);
    const visibleLines = allLines.slice(-2);
    for (let i = 0; i < visibleLines.length; i++) {
      const lineElement = document.createElement("div");
      lineElement.className = "bubble-shell__line";
      if (i < visibleLines.length - 1) {
        lineElement.style.opacity = "0.42";
        lineElement.style.fontSize = "32px";
        lineElement.style.fontWeight = "600";
      }
      lineElement.textContent = visibleLines[i].replaceAll(" ", "\u00a0") || "\u00a0";
      this._linesElement.appendChild(lineElement);
    }
  }

  _collectRenderedText() {
    return Array.from(this._linesElement.children)
      .map((element) => element.textContent || "")
      .join(" | ");
  }

  destroy() {
    this._rootElement.remove();
  }
}
