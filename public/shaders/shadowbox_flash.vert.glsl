precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;

in vec3 position;
out vec4 vs_TEXCOORD0;
in vec2 uv;
in vec2 uv1;
in vec3 normal;
out vec3 vs_TEXCOORD1;
out float vs_TEXCOORD2;
in vec4 color;
vec4 _9;
vec4 _49;
float _119;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _97 = normal;
    vec2 _87 = uv;
    vec2 _91 = uv1;
    vec4 _136 = color;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9 = _11.yyyy * modelMatrix[1];
    _9 = (modelMatrix[0] * _11.xxxx) + _9;
    _9 = (modelMatrix[2] * _11.zzzz) + _9;
    _9 += modelMatrix[3];
    _49 = _9.yyyy * _ViewProjection[1];
    _49 = (_ViewProjection[0] * _9.xxxx) + _49;
    _49 = (_ViewProjection[2] * _9.zzzz) + _49;
    _9 = (_ViewProjection[3] * _9.wwww) + _49;
    gl_Position = _9;
    vs_TEXCOORD0 = vec4(_87.x, _87.y, vs_TEXCOORD0.z, vs_TEXCOORD0.w);
    vs_TEXCOORD0 = vec4(vs_TEXCOORD0.x, vs_TEXCOORD0.y, _91.x, _91.y);
    _9.x = dot(_97, _WorldToObject[0].xyz);
    _9.y = dot(_97, _WorldToObject[1].xyz);
    _9.z = dot(_97, _WorldToObject[2].xyz);
    _119 = dot(_9.xyz, _9.xyz);
    _119 = inversesqrt(_119);
    vs_TEXCOORD1 = vec3(_119) * _9.xyz;
    vs_TEXCOORD2 = (-_136.w) + 1.0;
}
