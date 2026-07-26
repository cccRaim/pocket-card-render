precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform int _UseUv;
uniform int _UseMaskUv;

in vec3 position;
in vec2 uv;
in vec2 uv1;
in vec3 normal;
out vec3 vs_TEXCOORD2;
out vec2 vs_TEXCOORD0;
out vec2 vs_TEXCOORD1;
vec4 _9;
vec4 _49;
vec4 _107;
float _138;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _99 = uv;
    vec2 _103 = uv1;
    vec3 _116 = normal;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9 = _11.yyyy * _ObjectToWorld[1];
    _9 = (_ObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (_ObjectToWorld[2] * _11.zzzz) + _9;
    _9 += _ObjectToWorld[3];
    _49 = _9.yyyy * _ViewProjection[1];
    _49 = (_ViewProjection[0] * _9.xxxx) + _49;
    _49 = (_ViewProjection[2] * _9.zzzz) + _49;
    _9 = (_ViewProjection[3] * _9.wwww) + _49;
    gl_Position = _9;
    _9 = vec4(ivec4(_UseUv, _UseUv, _UseMaskUv, _UseMaskUv));
    _49 = (-_99.xyxy) + _103.xyxy;
    _107 = (_9 * _49) + _99.xyxy;
    _9.x = dot(_116, _WorldToObject[0].xyz);
    _9.y = dot(_116, _WorldToObject[1].xyz);
    _9.z = dot(_116, _WorldToObject[2].xyz);
    _138 = dot(_9.xyz, _9.xyz);
    _138 = inversesqrt(_138);
    vs_TEXCOORD2 = vec3(_138) * _9.xyz;
    vs_TEXCOORD0 = _107.xy;
    vs_TEXCOORD1 = _107.zw;
}
