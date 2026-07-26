export const LAYER_BISECT_SCHEMA = "pocket-card-render/layer-bisect@1";

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

export function parseHiddenLayerNumbers(value) {
  if (!value) return [];
  const numbers = String(value)
    .split(",")
    .map((token) => Number(token.trim()));
  if (numbers.some((number) => !Number.isInteger(number) || number < 1)) {
    throw new RangeError("hideLayer must contain positive 1-based layer numbers");
  }
  return uniqueSorted(numbers);
}

function validateLayerIds(values, field) {
  if (!Array.isArray(values) || values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new TypeError(`${field} must contain non-negative integer layer ids`);
  }
  if (new Set(values).size !== values.length) {
    throw new RangeError(`${field} must not contain duplicate layer ids`);
  }
}

export function createLayerBisectState(candidateLayerIds) {
  validateLayerIds(candidateLayerIds, "candidateLayerIds");
  if (candidateLayerIds.length === 0) throw new RangeError("layer bisection needs at least one candidate");
  return {
    schema: LAYER_BISECT_SCHEMA,
    round: 1,
    candidates: uniqueSorted(candidateLayerIds),
    context: [],
    removed: [],
  };
}

export function layerBisectProbe(state) {
  validateLayerIds(state?.candidates, "state.candidates");
  validateLayerIds(state?.context, "state.context");
  validateLayerIds(state?.removed, "state.removed");
  if (state.candidates.length === 0) throw new RangeError("layer bisection has no candidates");
  if (state.candidates.length === 1) {
    return {
      done: true,
      candidate: state.candidates[0],
      hidden: [...state.removed],
      visible: uniqueSorted([...state.context, ...state.candidates]),
    };
  }
  const midpoint = Math.ceil(state.candidates.length / 2);
  const hidden = state.candidates.slice(0, midpoint);
  const shownCandidates = state.candidates.slice(midpoint);
  return {
    done: false,
    hidden,
    shownCandidates,
    visible: uniqueSorted([...state.context, ...shownCandidates]),
  };
}

// Hide half of the current suspects while keeping previously required context visible.
// A surviving artifact eliminates the hidden half. A disappearing artifact promotes
// the shown half to context and continues splitting the hidden half.
export function answerLayerBisect(state, artifactStillVisible) {
  const probe = layerBisectProbe(state);
  if (probe.done) throw new RangeError("layer bisection is already complete");
  if (typeof artifactStillVisible !== "boolean") {
    throw new TypeError("artifactStillVisible must be boolean");
  }
  return {
    schema: LAYER_BISECT_SCHEMA,
    round: state.round + 1,
    candidates: artifactStillVisible ? probe.shownCandidates : probe.hidden,
    context: uniqueSorted([
      ...state.context,
      ...(artifactStillVisible ? [] : probe.shownCandidates),
    ]),
    removed: uniqueSorted([
      ...state.removed,
      ...(artifactStillVisible ? probe.hidden : []),
    ]),
  };
}
