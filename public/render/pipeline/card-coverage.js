import * as THREE from "three";

export function createCardCoveragePresenter(scene, camera, displayCamera, displayMesh, coverageSources) {
  const sources = [];
  scene.traverse(object => {
    if (coverageSources.has(object)) sources.push(object);
  });
  if (!sources.length) throw new Error("Card coverage geometry is missing");
  const maskScene = new THREE.Scene();
  const white = new THREE.MeshBasicMaterial({
    color: 0xffffff, side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const masks = sources.map(source => {
    const mesh = new THREE.Mesh(source.geometry, white);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.layers.mask = source.layers.mask;
    maskScene.add(mesh);
    return mesh;
  });
  const target = samples => new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false, samples, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const coverage = target(4);
  const projected = target(0);
  const display = displayMesh.material;
  const alphaAssignment = "outColor.w = inverseAlpha;";
  if (!display.fragmentShader.includes(alphaAssignment)) throw new Error("Unknown homography alpha output");
  const projectionScene = new THREE.Scene();
  const projection = new THREE.Mesh(displayMesh.geometry, new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: display.vertexShader,
    fragmentShader: display.fragmentShader.replace(alphaAssignment, "outColor.w = sampled.w;"),
    uniforms: { ...display.uniforms, _DynamicUITex: { value: coverage.texture } },
    side: display.side, blending: THREE.NoBlending, depthTest: false, depthWrite: false,
  }));
  projection.frustumCulled = false;
  projectionScene.add(projection);
  const finalScene = new THREE.Scene();
  const finalCamera = new THREE.Camera();
  const composite = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, blending: THREE.NoBlending, depthTest: false, depthWrite: false,
    uniforms: { colorTexture: { value: null }, coverageTexture: { value: projected.texture } },
    vertexShader: "in vec3 position; in vec2 uv; out vec2 coord; void main(){coord=uv;gl_Position=vec4(position.xy,0.,1.);}",
    fragmentShader: "precision highp float; uniform sampler2D colorTexture,coverageTexture; in vec2 coord; out vec4 color; void main(){float a=texture(coverageTexture,coord).a;color=vec4(texture(colorTexture,coord).rgb*a,a);}",
  });
  finalScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), composite));
  return (renderer, sourceTarget, displayTarget) => {
    coverage.setSize(sourceTarget.width, sourceTarget.height);
    projected.setSize(displayTarget.width, displayTarget.height);
    scene.updateMatrixWorld(true);
    masks.forEach((mask, index) => mask.matrix.copy(sources[index].matrixWorld));
    projection.scale.copy(displayMesh.scale);
    composite.uniforms.colorTexture.value = displayTarget.textures[0];
    renderer.setClearColor(0, 0);
    renderer.setRenderTarget(coverage);
    renderer.render(maskScene, camera);
    renderer.setRenderTarget(projected);
    renderer.render(projectionScene, displayCamera);
    renderer.setRenderTarget(null);
    renderer.render(finalScene, finalCamera);
  };
}
