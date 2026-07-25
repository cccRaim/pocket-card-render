# BlueStacks / RenderDoc host experiment

This route was tested and rejected. BlueStacks runs the game's ARM64 process
through host translation, while RenderDoc attaches to the host
graphics/presentation process. A host capture does not prove the official guest
draw dispatch, descriptors, uniforms, attachments, or vertex bindings.

The unsuccessful probe scripts are intentionally not retained. This note exists
only to prevent repeating the route and must never contribute to official
fidelity or `exact` claims. Native ARM64 GFXReconstruct on a process that can
load the Vulkan capture layer remains the next bounded runtime-capture
experiment.
