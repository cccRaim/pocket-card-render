precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform highp float _StrataFaults[6];
uniform highp vec2 _Shake;
uniform int _LayerNum;
uniform highp float _ZOffset;

in vec3 position;
in vec2 uv1;
out vec2 vs_TEXCOORD0;
in vec2 uv;
vec4 _9;
vec4 _37;
int _127;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main()
{
    highp vec3 pcrUnityInput_position = vec3(-position.x, position.yz);
    highp vec2 pcrUnityInput_uv = vec2(uv.x, 1.0 - uv.y);
    highp vec2 pcrUnityInput_uv1 = vec2(uv1.x, 1.0 - uv1.y);
    highp mat4 pcrUnityInput_modelMatrix = pcrUnityFromThreeWorld * modelMatrix * pcrUnityFromGlbObject;
    highp mat4 pcrUnityInput_viewMatrix = viewMatrix * pcrUnityFromThreeWorld;
    vec4 _11 = vec4(pcrUnityInput_position, 1.0);
    vec2 _117 = pcrUnityInput_uv1;
    vec2 _133 = pcrUnityInput_uv;
    mat4 pcrObjectToWorld = pcrUnityInput_modelMatrix;
    mat4 pcrViewProjection = projectionMatrix * pcrUnityInput_viewMatrix;
    vec2 _34 = _11.xy + vec2(_Shake.x, _Shake.y);
    _9 = vec4(_34.x, _34.y, _9.z, _9.w);
    _37 = _9.yyyy * pcrObjectToWorld[1];
    _9 = (pcrObjectToWorld[0] * _9.xxxx) + _37;
    _37.x = _11.z + _ZOffset;
    _9 = (pcrObjectToWorld[2] * _37.xxxx) + _9;
    _9 += pcrObjectToWorld[3];
    _37 = _9.yyyy * pcrViewProjection[1];
    _37 = (pcrViewProjection[0] * _9.xxxx) + _37;
    _37 = (pcrViewProjection[2] * _9.zzzz) + _37;
    _9 = (pcrViewProjection[3] * _9.wwww) + _37;
    gl_Position = _9;
    _9.x = float(_LayerNum);
    _9.x *= _117.x;
    _9.x = floor(_9.x);
    _127 = int(_9.x);
    vs_TEXCOORD0.x = _133.x + _StrataFaults[_127];
    vs_TEXCOORD0.y = _133.y;

}
