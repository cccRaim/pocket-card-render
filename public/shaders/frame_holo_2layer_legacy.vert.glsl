precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;

in vec3 position;
out vec3 vs_TEXCOORD2;
out vec2 vs_TEXCOORD0;
in vec2 uv;
in vec3 normal;
out vec3 vs_TEXCOORD3;
vec4 _9;
vec4 _44;
float _125;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _103 = normal;
    vec2 _100 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9 = _11.yyyy * _ObjectToWorld[1];
    _9 = (_ObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (_ObjectToWorld[2] * _11.zzzz) + _9;
    _44 = _9 + _ObjectToWorld[3];
    vs_TEXCOORD2 = (_ObjectToWorld[3].xyz * _11.www) + _9.xyz;
    _9 = _44.yyyy * _ViewProjection[1];
    _9 = (_ViewProjection[0] * _44.xxxx) + _9;
    _9 = (_ViewProjection[2] * _44.zzzz) + _9;
    _9 = (_ViewProjection[3] * _44.wwww) + _9;
    gl_Position = _9;
    vs_TEXCOORD0 = _100;
    _9.x = dot(_103, _WorldToObject[0].xyz);
    _9.y = dot(_103, _WorldToObject[1].xyz);
    _9.z = dot(_103, _WorldToObject[2].xyz);
    _125 = dot(_9.xyz, _9.xyz);
    _125 = inversesqrt(_125);
    vs_TEXCOORD3 = vec3(_125) * _9.xyz;
}
