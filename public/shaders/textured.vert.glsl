precision highp float;
precision highp int;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
out vec2 vs_TEXCOORD0;
in vec2 uv;
vec4 _9;
vec4 _48;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _87 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9 = _11.yyyy * _ObjectToWorld[1];
    _9 = (_ObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (_ObjectToWorld[2] * _11.zzzz) + _9;
    _9 += _ObjectToWorld[3];
    _48 = _9.yyyy * _ViewProjection[1];
    _48 = (_ViewProjection[0] * _9.xxxx) + _48;
    _48 = (_ViewProjection[2] * _9.zzzz) + _48;
    _9 = (_ViewProjection[3] * _9.wwww) + _48;
    gl_Position = _9;
    vs_TEXCOORD0 = _87;
}
