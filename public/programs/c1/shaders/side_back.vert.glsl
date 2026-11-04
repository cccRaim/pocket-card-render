precision highp float;
precision highp int;



uniform highp mat4 modelMatrix;

uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;

layout(location = 0) in vec3 position;
out vec2 vs_TEXCOORD0;
layout(location = 1) in vec2 uv;


vec4 _26;
vec4 _68;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main()
{
    highp vec3 pcrUnityInput_position = vec3(-position.x, position.yz);
    highp vec2 pcrUnityInput_uv = vec2(uv.x, 1.0 - uv.y);
    highp mat4 pcrUnityInput_modelMatrix = pcrUnityFromThreeWorld * modelMatrix * pcrUnityFromGlbObject;
    highp mat4 pcrUnityInput_viewMatrix = viewMatrix * pcrUnityFromThreeWorld;
    vec4 _28 = vec4(pcrUnityInput_position, 1.0);
    vec2 _117 = pcrUnityInput_uv;
    mat4 _ObjectToWorld = pcrUnityInput_modelMatrix;
    mat4 _ViewProjection = projectionMatrix * pcrUnityInput_viewMatrix;
    _26 = _28.yyyy * _ObjectToWorld[1];
    _26 = (_ObjectToWorld[0] * _28.xxxx) + _26;
    _26 = (_ObjectToWorld[2] * _28.zzzz) + _26;
    _68 = _26 + _ObjectToWorld[3];
    _26 = _68.yyyy * _ViewProjection[1];
    _26 = (_ViewProjection[0] * _68.xxxx) + _26;
    _26 = (_ViewProjection[2] * _68.zzzz) + _26;
    _68 = (_ViewProjection[3] * _68.wwww) + _26;
    gl_Position = _68;
    vs_TEXCOORD0 = _117;
}
