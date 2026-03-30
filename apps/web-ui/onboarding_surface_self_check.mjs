import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
  bootDeprecatedOnboardingSurface,
  buildDeprecatedOnboardingViewModel
} from "./public/onboarding_surface.mjs";

class FakeElement {
  constructor() {
    this.textContent = "";
    this.innerHTML = "";
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement();
    this._elements = new Map([
      ["onboardingTitle", new FakeElement()],
      ["onboardingMessage", new FakeElement()],
      ["onboardingStatusText", new FakeElement()],
      ["onboardingPrimaryLink", new FakeElement()],
      ["onboardingChecklist", new FakeElement()]
    ]);
  }

  getElementById(id) {
    return this._elements.get(id) || null;
  }
}

async function main() {
  const onboardingHtml = await fs.readFile(
    new URL("./public/onboarding.html", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    onboardingHtml,
    /onboardingStep1|onboardingStep2|onboardingStep3|onboardingRunEnrollmentBtn|onboardingSaveProviderBtn|onboardingValidateReadinessBtn/i
  );
  assert.match(onboardingHtml, /Onboarding moved to Config v2/i);
  assert.match(onboardingHtml, /Deprecated entrypoint/i);
  assert.match(onboardingHtml, /Open Config v2/i);

  const viewModel = buildDeprecatedOnboardingViewModel();
  assert.equal(viewModel.primaryHref, "/config-v2.html");
  assert.equal(viewModel.checklist.length, 3);

  const documentObject = new FakeDocument();
  const rendered = await bootDeprecatedOnboardingSurface(documentObject);
  assert.equal(rendered.title, "Onboarding moved to Config v2");
  assert.equal(
    documentObject.body.attributes.get("data-onboarding-state"),
    "deprecated"
  );
  assert.match(
    documentObject.getElementById("onboardingMessage").textContent,
    /no longer part of the active browser product flow|deprecated compatibility notice/i
  );
  assert.equal(
    documentObject.getElementById("onboardingPrimaryLink").attributes.get("href"),
    "/config-v2.html"
  );
  assert.match(
    documentObject.getElementById("onboardingChecklist").innerHTML,
    /voice enrollment/i
  );

  process.stdout.write("echo web-ui onboarding surface self-check passed\n");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
