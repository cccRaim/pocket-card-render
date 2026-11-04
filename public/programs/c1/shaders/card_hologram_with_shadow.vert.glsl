precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform int _UseUv;
uniform int _UseMaskUv;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;

in vec3 position;
out vec4 vs_TEXCOORD0;
in vec2 uv;
in vec2 uv1;
out vec2 vs_TEXCOORD1;
in vec3 normal;
out vec3 vs_TEXCOORD2;
vec4 _9;
vec4 _49;
float _166;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main()
{
    highp vec3 pcrUnityInput_position = vec3(-position.x, position.yz);
    highp vec3 pcrUnityInput_normal = vec3(-normal.x, normal.yz);
    highp vec2 pcrUnityInput_uv = vec2(uv.x, 1.0 - uv.y);
    highp vec2 pcrUnityInput_uv1 = vec2(uv1.x, 1.0 - uv1.y);
    highp mat4 pcrUnityInput_modelMatrix = pcrUnityFromThreeWorld * modelMatrix * pcrUnityFromGlbObject;
    highp mat4 pcrUnityInput_viewMatrix = viewMatrix * pcrUnityFromThreeWorld;
    vec4 _11 = vec4(pcrUnityInput_position, 1.0);
    vec2 _116 = pcrUnityInput_uv;
    vec2 _120 = pcrUnityInput_uv1;
    vec3 _144 = pcrUnityInput_normal;
    mat4 _WorldToObject = inverse(pcrUnityInput_modelMatrix);
    mat4 _ViewProjection = projectionMatrix * pcrUnityInput_viewMatrix;
    _9 = _11.yyyy * pcrUnityInput_modelMatrix[1];
    _9 = (pcrUnityInput_modelMatrix[0] * _11.xxxx) + _9;
    _9 = (pcrUnityInput_modelMatrix[2] * _11.zzzz) + _9;
    _9 += pcrUnityInput_modelMatrix[3];
    _49 = _9.yyyy * _ViewProjection[1];
    _49 = (_ViewProjection[0] * _9.xxxx) + _49;
    _49 = (_ViewProjection[2] * _9.zzzz) + _49;
    _9 = (_ViewProjection[3] * _9.wwww) + _49;
    gl_Position = _9;
    vec2 _90 = _11.xy + vec2(0.314999997615814208984375, 0.439999997615814208984375);
    _9 = vec4(_90.x, _90.y, _9.z, _9.w);
    vec2 _99 = _9.xy * vec2(1.58730161190032958984375, 1.13636362552642822265625);
    vs_TEXCOORD0 = vec4(vs_TEXCOORD0.x, vs_TEXCOORD0.y, _99.x, _99.y);
    _9 = vec4(ivec4(_UseUv, _UseUv, _UseMaskUv, _UseMaskUv));
    _49 = (-_116.xyxy) + _120.xyxy;
    vec2 _130 = (_9.xy * _49.xy) + _116;
    vs_TEXCOORD0 = vec4(_130.x, _130.y, vs_TEXCOORD0.z, vs_TEXCOORD0.w);
    vs_TEXCOORD1 = (_9.zw * _49.zw) + _116;
    _9.x = dot(_144, _WorldToObject[0].xyz);
    _9.y = dot(_144, _WorldToObject[1].xyz);
    _9.z = dot(_144, _WorldToObject[2].xyz);
    _166 = dot(_9.xyz, _9.xyz);
    _166 = inversesqrt(_166);
    vs_TEXCOORD2 = vec3(_166) * _9.xyz;

}
