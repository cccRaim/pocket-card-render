precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform mediump vec4 _Color;

layout(location = 0) in vec3 position;
layout(location = 1) in vec4 color;
out mediump vec4 vColor;
out mediump vec2 vUv;
layout(location = 2) in vec2 uv;
out highp vec4 vSourcePosition;
vec4 _9;
vec4 _48;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec4 _82 = color;
    vec2 _93 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9 = _11.yyyy * _ObjectToWorld[1];
    _9 = (_ObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (_ObjectToWorld[2] * _11.zzzz) + _9;
    _9 += _ObjectToWorld[3];
    _48 = _9.yyyy * _ViewProjection[1];
    _48 = (_ViewProjection[0] * _9.xxxx) + _48;
    _48 = (_ViewProjection[2] * _9.zzzz) + _48;
    gl_Position = (_ViewProjection[3] * _9.wwww) + _48;
    _9 = _82 * _Color;
    vColor = _9;
    vUv = _93;
    vSourcePosition = _11;
}
