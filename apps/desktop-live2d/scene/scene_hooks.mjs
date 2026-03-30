export class DesktopLive2DSceneHooks {
  constructor() {
    this._events = [];
  }

  record(eventName, payload) {
    this._events.push({
      event_name: eventName,
      payload
    });
  }

  getEvents() {
    return Object.freeze(this._events.slice());
  }

  async onModelLoaded(modelManifest) {
    this.record("model_loaded", {
      model_key: modelManifest.model_key,
      presentation_mode: modelManifest.presentation_mode
    });
  }

  async onStateApplied(stateName, command) {
    this.record("state_applied", {
      state_name: stateName,
      command_id: command.command_id
    });
  }

  async onExpressionApplied(expressionName, command) {
    this.record("expression_applied", {
      expression_name: expressionName,
      command_id: command.command_id
    });
  }

  async onExpressionCleared(command) {
    this.record("expression_cleared", {
      command_id: command.command_id
    });
  }

  async onMotionPlayed(motionName, command) {
    this.record("motion_played", {
      motion_name: motionName,
      command_id: command.command_id
    });
  }
}
