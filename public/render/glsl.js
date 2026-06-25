// Shared GLSL building blocks. Material strategies compose these instead of re-pasting the same
// boilerplate. The math here is byte-identical to what each factory used inline before extraction.

// Flat quad, just UV (effect / flare / glitter).
export const SIMPLE_VS = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Object-space view basis: vVdO = view dir in object/tangent space, vNrm = object normal, vUv.
// Used by every view-dependent foil/holo whose math is in object space (plate / sbHolo / frameHolo).
export const VIEW_BASIS_VS = /* glsl */`
  varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 vdW = normalize(cameraPosition - wp.xyz);
    vVdO = normalize((inverse(modelMatrix) * vec4(vdW, 0.0)).xyz);
    vNrm = normalize(normal); vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// As VIEW_BASIS_VS but also exposes the WORLD view dir + world normal (for cube reflections that
// need world space). Used by the rarity diamond and the EX UI foil.
export const VIEW_BASIS_WORLD_VS = /* glsl */`
  varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vVdW; varying vec3 vNrmW;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vVdW = normalize(cameraPosition - wp.xyz); vNrmW = normalize(mat3(modelMatrix) * normal);
    vVdO = normalize((inverse(modelMatrix) * vec4(vVdW, 0.0)).xyz);
    vNrm = normalize(normal); vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
