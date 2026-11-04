precision highp float;
precision highp int;

in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float _DepthOffset;
uniform highp vec4 _MainTex_ST;
out mediump vec2 vs_TEXCOORD0;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main()
{
    highp vec3 pcrUnityInput_position = vec3(-position.x, position.yz);
    highp vec2 pcrUnityInput_uv = vec2(uv.x, 1.0 - uv.y);
    highp mat4 pcrUnityInput_modelViewMatrix = modelViewMatrix * pcrUnityFromGlbObject;
    vec4 viewPosition = pcrUnityInput_modelViewMatrix * vec4(pcrUnityInput_position, 1.0);
    viewPosition.z -= _DepthOffset;
    gl_Position = projectionMatrix * viewPosition;
    vs_TEXCOORD0 = (pcrUnityInput_uv * _MainTex_ST.xy) + _MainTex_ST.zw;
}
