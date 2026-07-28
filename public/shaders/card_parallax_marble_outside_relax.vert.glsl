precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;

in vec3 position;
out vec2 vs_TEXCOORD0;
in vec2 uv;
out vec3 vs_TEXCOORD1;
out vec3 vs_TEXCOORD2;
in vec3 normal;
out vec3 vs_TEXCOORD3;
vec4 _9;
vec4 _49;
float _159;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec4 _134 = vec4(normal, 0.0);
    vec2 _87 = uv;
    mat4 pcrObjectToWorld = modelMatrix;
    mat4 pcrWorldToObject = inverse(modelMatrix);
    mat4 pcrViewProjection = projectionMatrix * viewMatrix;
    _9 = _11.yyyy * pcrObjectToWorld[1];
    _9 = (pcrObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (pcrObjectToWorld[2] * _11.zzzz) + _9;
    _9 += pcrObjectToWorld[3];
    _49 = _9.yyyy * pcrViewProjection[1];
    _49 = (pcrViewProjection[0] * _9.xxxx) + _49;
    _49 = (pcrViewProjection[2] * _9.zzzz) + _49;
    gl_Position = (pcrViewProjection[3] * _9.wwww) + _49;
    vs_TEXCOORD0 = _87;
    vs_TEXCOORD1 = _11.xyz;
    vec3 _99 = _11.yyy * pcrObjectToWorld[1].xyz;
    _9 = vec4(_99.x, _99.y, _99.z, _9.w);
    vec3 _110 = (pcrObjectToWorld[0].xyz * _11.xxx) + _9.xyz;
    _9 = vec4(_110.x, _110.y, _110.z, _9.w);
    vec3 _121 = (pcrObjectToWorld[2].xyz * _11.zzz) + _9.xyz;
    _9 = vec4(_121.x, _121.y, _121.z, _9.w);
    vs_TEXCOORD2 = (pcrObjectToWorld[3].xyz * _11.www) + _9.xyz;
    _9.x = dot(_134.xyz, pcrWorldToObject[0].xyz);
    _9.y = dot(_134.xyz, pcrWorldToObject[1].xyz);
    _9.z = dot(_134.xyz, pcrWorldToObject[2].xyz);
    _159 = dot(_9.xyz, _9.xyz);
    _159 = inversesqrt(_159);
    vs_TEXCOORD3 = vec3(_159) * _9.xyz;
}
