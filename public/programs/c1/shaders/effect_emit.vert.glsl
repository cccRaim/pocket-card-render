precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform highp float _UVScale;

in vec3 position;
in vec2 uv;
out mediump vec2 vs_TEXCOORD0;
vec4 _9;
vec4 _48;

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
    vec2 _84 = pcrUnityInput_uv;
    mat4 _ViewProjection = projectionMatrix * pcrUnityInput_viewMatrix;
    _9 = _11.yyyy * pcrUnityInput_modelMatrix[1];
    _9 = (pcrUnityInput_modelMatrix[0] * _11.xxxx) + _9;
    _9 = (pcrUnityInput_modelMatrix[2] * _11.zzzz) + _9;
    _9 += pcrUnityInput_modelMatrix[3];
    _48 = _9.yyyy * _ViewProjection[1];
    _48 = (_ViewProjection[0] * _9.xxxx) + _48;
    _48 = (_ViewProjection[2] * _9.zzzz) + _48;
    gl_Position = (_ViewProjection[3] * _9.wwww) + _48;
    mediump vec2 _91 = (_84 * vec2(2.0)) + vec2(-1.0);
    _9 = vec4(_91.x, _91.y, _9.z, _9.w);
    vec2 _100 = _9.xy / vec2(_UVScale);
    _9 = vec4(_100.x, _100.y, _9.z, _9.w);
    vec2 _108 = (_9.xy * vec2(0.5)) + vec2(0.5);
    _9 = vec4(_108.x, _108.y, _9.z, _9.w);
    vs_TEXCOORD0 = _9.xy;

}
