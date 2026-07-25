// Unity TimeManager contract used by the currently visible shader clocks.
// The evidence addresses are pinned by build/audit-official-animation-timing.mjs.

const f32 = Math.fround;

export const OFFICIAL_TIME_EVIDENCE = Object.freeze({
  timeManagerDefaults: Object.freeze({
    timeScale: f32(1),
    maximumDeltaTime: f32(0.3333333432674408),
  }),
  libil2cppRvas: Object.freeze({
    getTime: "0x6529698",
    getDeltaTime: "0x65296e8",
    getTimeScale: "0x6529850",
    setTimeScale: "0x6529878",
  }),
  libunityShaderGlobalsRva: "0x5e0328",
  shaderTimeFactors: Object.freeze([f32(0.05), f32(1), f32(2), f32(3)]),
});

export const OFFICIAL_TIME_DEFAULTS = OFFICIAL_TIME_EVIDENCE.timeManagerDefaults;

export function syncOfficialClockVisibility(clock, hidden) {
  if (!clock || typeof clock.suspend !== "function" || typeof clock.resume !== "function") {
    throw new TypeError("clock must provide suspend() and resume()");
  }
  if (typeof hidden !== "boolean") throw new TypeError("hidden must be boolean");
  if (hidden) clock.suspend();
  else clock.resume();
}

export function officialShaderTimeVector(globalTime) {
  const t = f32(globalTime);
  const [x, y, z, w] = OFFICIAL_TIME_EVIDENCE.shaderTimeFactors;
  return [f32(t * x), f32(t * y), f32(t * z), f32(t * w)];
}

export class OfficialClock {
  constructor({
    timeScale = OFFICIAL_TIME_DEFAULTS.timeScale,
    maximumDeltaTime = OFFICIAL_TIME_DEFAULTS.maximumDeltaTime,
    initialGlobalTime = 0,
  } = {}) {
    if (!(maximumDeltaTime > 0) || !Number.isFinite(maximumDeltaTime)) {
      throw new RangeError("maximumDeltaTime must be positive and finite");
    }
    if (!Number.isFinite(initialGlobalTime) || initialGlobalTime < 0) {
      throw new RangeError("initialGlobalTime must be finite and non-negative");
    }
    this.maximumDeltaTime = f32(maximumDeltaTime);
    this._elapsed = initialGlobalTime;
    this.globalTime = f32(initialGlobalTime);
    this.scaledDeltaTime = f32(0);
    this.rawDeltaTime = f32(0);
    this.previousTimestampMs = null;
    this.suspended = false;
    this.setTimeScale(timeScale);
  }

  setTimeScale(value) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError("timeScale must be finite and non-negative");
    this.timeScale = f32(value);
  }

  _frame(shouldUpdate) {
    return Object.freeze({
      shouldUpdate,
      rawDeltaTime: this.rawDeltaTime,
      scaledDeltaTime: this.scaledDeltaTime,
      globalTime: this.globalTime,
      timeScale: this.timeScale,
      suspended: this.suspended,
    });
  }

  _advance(rawDeltaTime) {
    const raw = Math.max(0, rawDeltaTime);
    this.rawDeltaTime = f32(raw);
    this.scaledDeltaTime = f32(Math.min(raw * this.timeScale, this.maximumDeltaTime));
    this._elapsed += this.scaledDeltaTime;
    this.globalTime = f32(this._elapsed);
    return this._frame(true);
  }

  tick(timestampMs) {
    if (!Number.isFinite(timestampMs)) throw new TypeError("timestampMs must be finite");
    if (this.suspended) {
      this.rawDeltaTime = f32(0);
      this.scaledDeltaTime = f32(0);
      return this._frame(false);
    }
    const rawDeltaTime = this.previousTimestampMs == null
      ? 0
      : Math.max(0, (timestampMs - this.previousTimestampMs) * 0.001);
    this.previousTimestampMs = timestampMs;
    return this._advance(rawDeltaTime);
  }

  advance(deltaTimeSeconds) {
    if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds < 0) {
      throw new RangeError("deltaTimeSeconds must be finite and non-negative");
    }
    if (this.suspended) {
      this.rawDeltaTime = f32(0);
      this.scaledDeltaTime = f32(0);
      return this._frame(false);
    }
    this.previousTimestampMs = null;
    return this._advance(deltaTimeSeconds);
  }

  suspend() {
    this.suspended = true;
    this.previousTimestampMs = null;
    this.rawDeltaTime = f32(0);
    this.scaledDeltaTime = f32(0);
  }

  resume() {
    this.suspended = false;
    this.previousTimestampMs = null;
    this.rawDeltaTime = f32(0);
    this.scaledDeltaTime = f32(0);
  }
}
