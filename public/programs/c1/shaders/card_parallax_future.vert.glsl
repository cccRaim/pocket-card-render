precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform highp float _CrossFilterUVScale;
uniform highp float _CrossFilterPrimScale;
uniform highp float _ZOffset;

in vec3 position;
in vec2 uv;
out vec4 vs_TEXCOORD0;
flat out uint vs_TEXCOORD1;
vec4 _9;
vec4 _35;
float _104;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main()
{
    highp vec3 pcrUnityInput_position = vec3(-position.x, position.yz);
    highp vec2 pcrUnityInput_uv = vec2(uv.x, 1.0 - uv.y);
    highp mat4 pcrUnityInput_modelMatrix = pcrUnityFromThreeWorld * modelMatrix * pcrUnityFromGlbObject;
    highp mat4 pcrUnityInput_viewMatrix = viewMatrix * pcrUnityFromThreeWorld;
    vec4 _11 = vec4(pcrUnityInput_position, 1.0);
    vec2 _97 = pcrUnityInput_uv;
    mat4 pcrObjectToWorld = pcrUnityInput_modelMatrix;
    mat4 pcrViewProjection = projectionMatrix * pcrUnityInput_viewMatrix;
    _9 = _11.yyyy * pcrObjectToWorld[1];
    _9 = (pcrObjectToWorld[0] * _11.xxxx) + _9;
    _35.x = _11.z + _ZOffset;
    _9 = (pcrObjectToWorld[2] * _35.xxxx) + _9;
    _9 += pcrObjectToWorld[3];
    _35 = _9.yyyy * pcrViewProjection[1];
    _35 = (pcrViewProjection[0] * _9.xxxx) + _35;
    _35 = (pcrViewProjection[2] * _9.zzzz) + _35;
    _9 = (pcrViewProjection[3] * _9.wwww) + _35;
    gl_Position = _9;
    vec2 _101 = _97 + vec2(-0.5);
    _9 = vec4(_101.x, _101.y, _9.z, _9.w);
    _104 = 1.0 / _CrossFilterPrimScale;
    vec2 _113 = vec2(_104) * _9.xy;
    _9 = vec4(_113.x, _113.y, _9.z, _9.w);
    vec2 _130 = (_9.xy * vec2(vec2(_CrossFilterUVScale, _CrossFilterUVScale))) + vec2(0.5);
    vs_TEXCOORD0 = vec4(vs_TEXCOORD0.x, vs_TEXCOORD0.y, _130.x, _130.y);
    vs_TEXCOORD0 = vec4(_97.x, _97.y, vs_TEXCOORD0.z, vs_TEXCOORD0.w);
    vs_TEXCOORD1 = uint(gl_VertexID);

}
