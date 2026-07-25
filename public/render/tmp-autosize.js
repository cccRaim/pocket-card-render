const WIDTH_EPSILON = 0.0001;
const FONT_SIZE_EPSILON = 0.051;
const MIN_FONT_SIZE_STEP = 0.05;
const FONT_SIZE_ROUNDING = 20;
const DEFAULT_MAX_ITERATIONS = 100;

const f32 = Math.fround;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

// TMP 3.0.6 rounds positive point sizes with `(int)(size * 20 + .5f) / 20f`.
export function roundOfficialTmpPointSize(value) {
  return f32(Math.trunc(f32(f32(value) * FONT_SIZE_ROUNDING + 0.5)) / FONT_SIZE_ROUNDING);
}

function reducePointSize(state) {
  state.maxFontSize = state.fontSize;
  const sizeDelta = Math.max(f32((state.fontSize - state.minFontSize) / 2), MIN_FONT_SIZE_STEP);
  state.fontSize = Math.max(
    roundOfficialTmpPointSize(f32(state.fontSize - sizeDelta)),
    state.fontSizeMin,
  );
}

function increasePointSize(state) {
  if (state.charWidthAdjustment < state.charWidthMaxAdjustment) {
    state.charWidthAdjustment = 0;
  }
  state.minFontSize = state.fontSize;
  const sizeDelta = Math.max(f32((state.maxFontSize - state.fontSize) / 2), MIN_FONT_SIZE_STEP);
  state.fontSize = Math.min(
    roundOfficialTmpPointSize(f32(state.fontSize + sizeDelta)),
    state.fontSizeMax,
  );
}

function result(state, evaluation, termination, trace) {
  return {
    fontSize: state.fontSize,
    charWidthAdjustment: state.charWidthAdjustment,
    lineSpacingDelta: state.lineSpacingDelta,
    iterations: trace.length,
    termination,
    evaluation,
    trace,
  };
}

/**
 * Ports the TMP 3.0.6 UGUI autosize state machine used by the official card UI.
 * `evaluate` performs the existing glyph/wrap layout and returns width, height,
 * lineCount and baseScale for the supplied TMP state.
 */
export function resolveOfficialTmpAutoSize(options, evaluate) {
  if (typeof evaluate !== "function") throw new TypeError("TMP autosize requires an evaluate callback");

  const fontSizeMin = f32(Number(options.fontSizeMin));
  const fontSizeMax = f32(Number(options.fontSizeMax));
  const fontSizeBase = f32(Number(options.fontSizeBase));
  if (!(fontSizeMin > 0) || !(fontSizeMax >= fontSizeMin) || !Number.isFinite(fontSizeBase)) {
    throw new RangeError("invalid TMP autosize font bounds");
  }

  const overflowMode = Number(options.overflowMode || 0);
  if (overflowMode !== 0) {
    throw new RangeError(`unsupported TMP overflow mode ${overflowMode}; official card prefabs use Overflow (0)`);
  }

  const state = {
    fontSize: f32(clamp(fontSizeBase, fontSizeMin, fontSizeMax)),
    fontSizeMin,
    fontSizeMax,
    minFontSize: fontSizeMin,
    maxFontSize: fontSizeMax,
    charWidthAdjustment: 0,
    charWidthMaxAdjustment: f32(Math.max(0, Number(options.charWidthMaxAdj || 0) / 100)),
    lineSpacingDelta: 0,
    lineSpacingMax: f32(Number(options.lineSpacingMax || 0)),
  };
  const maxWidth = Number(options.maxWidth ?? Infinity);
  const maxHeight = Number(options.maxHeight ?? Infinity);
  const justifiedScale = options.justifiedOrFlush ? 1.05 : 1;
  const maxIterations = Number(options.maxIterations || DEFAULT_MAX_ITERATIONS);
  const trace = [];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const evaluation = evaluate({
      fontSize: state.fontSize,
      charWidthAdjustment: state.charWidthAdjustment,
      lineSpacingDelta: state.lineSpacingDelta,
    }) || {};
    const width = Number(evaluation.width || 0);
    const height = Number(evaluation.height || 0);
    const lineCount = Math.max(1, Number(evaluation.lineCount || 1));
    const baseScale = Number(evaluation.baseScale || 1);
    const verticalOverflow = height > maxHeight + WIDTH_EPSILON;
    const horizontalOverflow = width > maxWidth * justifiedScale;

    if (verticalOverflow) {
      if (state.lineSpacingDelta > state.lineSpacingMax && lineCount > 1) {
        const adjustmentDelta = f32((maxHeight - height) / (lineCount - 1));
        state.lineSpacingDelta = Math.max(
          f32(state.lineSpacingDelta + f32(adjustmentDelta / baseScale)),
          state.lineSpacingMax,
        );
        trace.push({ iteration, action: "reduce-line-spacing", ...state });
        continue;
      }
      if (state.fontSize > state.fontSizeMin) {
        reducePointSize(state);
        trace.push({ iteration, action: "reduce-font-vertical", ...state });
        continue;
      }
      trace.push({ iteration, action: "accept-overflow-vertical", ...state });
      return result(state, evaluation, "overflow", trace);
    }

    if (horizontalOverflow) {
      if (state.charWidthAdjustment < state.charWidthMaxAdjustment) {
        const adjustedTextWidth = state.charWidthAdjustment > 0
          ? width / (1 - state.charWidthAdjustment)
          : width;
        const adjustmentDelta = width - (maxWidth - WIDTH_EPSILON) * justifiedScale;
        state.charWidthAdjustment = Math.min(
          f32(state.charWidthAdjustment + f32(adjustmentDelta / adjustedTextWidth)),
          state.charWidthMaxAdjustment,
        );
        trace.push({ iteration, action: "reduce-character-width", ...state });
        continue;
      }
      if (state.fontSize > state.fontSizeMin) {
        reducePointSize(state);
        trace.push({ iteration, action: "reduce-font-horizontal", ...state });
        continue;
      }
      trace.push({ iteration, action: "accept-overflow-horizontal", ...state });
      return result(state, evaluation, "overflow", trace);
    }

    const fontSizeDelta = state.maxFontSize - state.minFontSize;
    if (fontSizeDelta > FONT_SIZE_EPSILON && state.fontSize < state.fontSizeMax) {
      increasePointSize(state);
      trace.push({ iteration, action: "increase-font", ...state });
      continue;
    }

    trace.push({ iteration, action: "fit", ...state });
    return result(state, evaluation, "fit", trace);
  }

  const evaluation = evaluate({
    fontSize: state.fontSize,
    charWidthAdjustment: state.charWidthAdjustment,
    lineSpacingDelta: state.lineSpacingDelta,
  });
  return result(state, evaluation, "max-iterations", trace);
}

export const OFFICIAL_TMP_AUTOSIZE_CONSTANTS = Object.freeze({
  widthEpsilon: WIDTH_EPSILON,
  fontSizeEpsilon: FONT_SIZE_EPSILON,
  minimumFontSizeStep: MIN_FONT_SIZE_STEP,
  fontSizeRounding: FONT_SIZE_ROUNDING,
  maxIterations: DEFAULT_MAX_ITERATIONS,
});
