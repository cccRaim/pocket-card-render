precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
out vec2 vs_TEXCOORD0;
in vec2 uv;
out vec2 vs_TEXCOORD1;
in vec2 uv1;
in vec3 normal;
out vec3 vs_TEXCOORD2;
out float vs_TEXCOORD3;
in vec4 color;
vec4 _9;
vec4 _49;
float _117;

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
    vec3 _95 = pcrUnityInput_normal;
    vec2 _88 = pcrUnityInput_uv;
    vec2 _91 = pcrUnityInput_uv1;
    vec4 _134 = color;
    mat4 _ObjectToWorld = pcrUnityInput_modelMatrix;
    mat4 _WorldToObject = inverse(pcrUnityInput_modelMatrix);
    mat4 _ViewProjection = projectionMatrix * pcrUnityInput_viewMatrix;
    _9 = _11.yyyy * _ObjectToWorld[1];
    _9 = (_ObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (_ObjectToWorld[2] * _11.zzzz) + _9;
    _9 += _ObjectToWorld[3];
    _49 = _9.yyyy * _ViewProjection[1];
    _49 = (_ViewProjection[0] * _9.xxxx) + _49;
    _49 = (_ViewProjection[2] * _9.zzzz) + _49;
    _9 = (_ViewProjection[3] * _9.wwww) + _49;
    gl_Position = _9;
    vs_TEXCOORD0 = _88;
    vs_TEXCOORD1 = _91;
    _9.x = dot(_95, _WorldToObject[0].xyz);
    _9.y = dot(_95, _WorldToObject[1].xyz);
    _9.z = dot(_95, _WorldToObject[2].xyz);
    _117 = dot(_9.xyz, _9.xyz);
    _117 = inversesqrt(_117);
    vs_TEXCOORD2 = vec3(_117) * _9.xyz;
    vs_TEXCOORD3 = (-_134.w) + 1.0;

}
