precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform float _RampRotation;
uniform float _RampRepeat;
uniform float _ScrollOffset;
uniform float _KiraScale;
in vec3 position;
in vec2 uv;
out float vs_TEXCOORD1;
out vec2 vs_TEXCOORD0;
vec4 _9;
vec4 _31;
float _129;
mediump vec2 _135;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _95 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    vec3 _28 = _11.xyz * vec3(_KiraScale);
    _9 = vec4(_28.x, _28.y, _28.z, _9.w);
    _31 = _9.yyyy * _ObjectToWorld[1];
    _31 = (_ObjectToWorld[0] * _9.xxxx) + _31;
    _9 = (_ObjectToWorld[2] * _9.zzzz) + _31;
    _9 += _ObjectToWorld[3];
    _31 = _9.yyyy * _ViewProjection[1];
    _31 = (_ViewProjection[0] * _9.xxxx) + _31;
    _31 = (_ViewProjection[2] * _9.zzzz) + _31;
    gl_Position = (_ViewProjection[3] * _9.wwww) + _31;
    _9.x = _95.x + _ScrollOffset;
    _9.y = _95.y;
    vec2 _113 = _9.xy + vec2(-0.5);
    _9 = vec4(_113.x, _113.y, _9.z, _9.w);
    vec2 _126 = _9.xy * vec2(vec2(_RampRepeat, _RampRepeat));
    _9 = vec4(_126.x, _126.y, _9.z, _9.w);
    _129 = _RampRotation * 0.01745329238474369049072265625;
    _135.x = cos(_129);
    _135.y = sin(-_129);
    _9.x = dot(_135, _9.xy);
    vs_TEXCOORD1 = _9.x + 0.5;
    vs_TEXCOORD0 = _95;
}
