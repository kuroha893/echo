export function buildDeprecatedOnboardingViewModel() {
  return {
    title: "Onboarding moved to Config v2",
    message:
      "Provider setup and voice enrollment now live together in the active Config v2 page. This route remains only as a deprecated compatibility notice.",
    statusText: "Deprecated entrypoint",
    primaryHref: "/config-v2.html",
    checklist: [
      "Open Config v2 to configure the required cloud primary LLM and Qwen TTS.",
      "Run voice enrollment from the Config v2 voice-enrollment panel.",
      "Return to chat after provider readiness is validated."
    ]
  };
}

export async function bootDeprecatedOnboardingSurface(documentObject) {
  const viewModel = buildDeprecatedOnboardingViewModel();
  documentObject.body?.setAttribute("data-onboarding-state", "deprecated");
  const titleElement = documentObject.getElementById("onboardingTitle");
  const messageElement = documentObject.getElementById("onboardingMessage");
  const statusElement = documentObject.getElementById("onboardingStatusText");
  const primaryLinkElement = documentObject.getElementById("onboardingPrimaryLink");
  const checklistElement = documentObject.getElementById("onboardingChecklist");

  if (titleElement) {
    titleElement.textContent = viewModel.title;
  }
  if (messageElement) {
    messageElement.textContent = viewModel.message;
  }
  if (statusElement) {
    statusElement.textContent = viewModel.statusText;
  }
  if (primaryLinkElement) {
    primaryLinkElement.setAttribute("href", viewModel.primaryHref);
  }
  if (checklistElement) {
    checklistElement.innerHTML = viewModel.checklist
      .map((item) => `<li>${item}</li>`)
      .join("");
  }

  return viewModel;
}
