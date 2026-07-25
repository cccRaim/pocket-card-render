# BlueStacks / RenderDoc host experiments

These scripts preserve a bounded, unsuccessful capture experiment. BlueStacks
runs the game's ARM64 process through host translation, while RenderDoc attaches
to the host graphics/presentation process. The resulting host capture does not
prove the official guest draw dispatch, descriptors, uniforms, attachments, or
vertex bindings.

This directory is not part of `audit:all`, and its output must never contribute
to official fidelity or `exact` claims. Keep it only as historical tooling and
to prevent repeating the same route. Native ARM64 GFXReconstruct on a process
that can load the Vulkan capture layer remains the next bounded runtime-capture
experiment.
