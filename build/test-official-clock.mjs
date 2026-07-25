import assert from "node:assert/strict";
import {
  OFFICIAL_TIME_DEFAULTS,
  OfficialClock,
  officialShaderTimeVector,
  syncOfficialClockVisibility,
} from "../public/render/official-clock.js";

const close = (actual, expected, epsilon = 1e-7) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);
};

assert.equal(OFFICIAL_TIME_DEFAULTS.timeScale, Math.fround(1));
assert.equal(OFFICIAL_TIME_DEFAULTS.maximumDeltaTime, Math.fround(0.3333333432674408));

const clock = new OfficialClock();
let frame = clock.tick(1000);
assert.equal(frame.scaledDeltaTime, 0);
frame = clock.tick(1100);
close(frame.scaledDeltaTime, 0.1);
close(frame.globalTime, 0.1);

clock.setTimeScale(0.5);
frame = clock.tick(1200);
close(frame.scaledDeltaTime, 0.05);
clock.setTimeScale(2);
frame = clock.tick(1300);
close(frame.scaledDeltaTime, 0.2);
frame = clock.tick(2300);
assert.equal(frame.scaledDeltaTime, OFFICIAL_TIME_DEFAULTS.maximumDeltaTime, "scaled delta must be capped");

clock.setTimeScale(0);
const beforePause = clock.globalTime;
frame = clock.tick(2400);
assert.equal(frame.shouldUpdate, true, "timeScale=0 still runs MonoBehaviour Update");
assert.equal(frame.scaledDeltaTime, 0);
assert.equal(frame.globalTime, beforePause);

clock.suspend();
frame = clock.tick(10000);
assert.equal(frame.shouldUpdate, false, "suspension must stop simulation Update");
assert.equal(frame.globalTime, beforePause);
clock.resume();
clock.setTimeScale(1);
frame = clock.tick(20000);
assert.equal(frame.shouldUpdate, true);
assert.equal(frame.scaledDeltaTime, 0, "first resumed frame must not catch up hidden time");
frame = clock.tick(20100);
close(frame.scaledDeltaTime, 0.1);

syncOfficialClockVisibility(clock, true);
assert.equal(clock.suspended, true);
syncOfficialClockVisibility(clock, false);
assert.equal(clock.suspended, false);
assert.throws(() => syncOfficialClockVisibility(clock, "hidden"), /hidden/);

const deterministic = new OfficialClock({ timeScale: 2 });
frame = deterministic.advance(0.125);
close(frame.scaledDeltaTime, 0.25);
const sharedConsumers = [{ uniforms: { uTime: { value: -1 } } }, { uniforms: { uTime: { value: -2 } } }];
for (const material of sharedConsumers) material.uniforms.uTime.value = frame.globalTime;
assert.equal(sharedConsumers[0].uniforms.uTime.value, sharedConsumers[1].uniforms.uTime.value);
assert.deepEqual(officialShaderTimeVector(2), [Math.fround(0.1), 2, 4, 6]);

assert.throws(() => clock.setTimeScale(-1), /timeScale/);
assert.throws(() => new OfficialClock({ maximumDeltaTime: 0 }), /maximumDeltaTime/);
console.log("Official clock numeric tests: OK");
console.log("  timeScale 0/0.5/1/2, maximumDeltaTime cap, suspend/resume, deterministic advance, shared _Time");
