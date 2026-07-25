precision highp float;
precision highp int;



uniform highp mat4 modelMatrix;

uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;

layout(location = 0) in vec3 position;
out vec2 vs_TEXCOORD0;
layout(location = 1) in vec2 uv;


vec4 _26;
vec4 _68;

void main()
{
    vec4 _28 = vec4(position, 1.0);
    vec2 _117 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _26 = _28.yyyy * _ObjectToWorld[1];
    _26 = (_ObjectToWorld[0] * _28.xxxx) + _26;
    _26 = (_ObjectToWorld[2] * _28.zzzz) + _26;
    _68 = _26 + _ObjectToWorld[3];
    _26 = _68.yyyy * _ViewProjection[1];
    _26 = (_ViewProjection[0] * _68.xxxx) + _26;
    _26 = (_ViewProjection[2] * _68.zzzz) + _26;
    _68 = (_ViewProjection[3] * _68.wwww) + _26;
    gl_Position = _68;
    vs_TEXCOORD0 = _117;
}
