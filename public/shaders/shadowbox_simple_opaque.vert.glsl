precision highp float;
precision highp int;

uniform highp mat4 modelViewMatrix;
uniform highp mat4 projectionMatrix;
in vec3 position;
out vec2 vs_TEXCOORD0;
in vec2 uv;
vec4 _9;
vec4 _48;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _87 = uv;
    mat4 pcrObjectToWorld = mat4(1.0);
    mat4 pcrViewProjection = projectionMatrix * modelViewMatrix;
    _9 = _11.yyyy * pcrObjectToWorld[1];
    _9 = (pcrObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (pcrObjectToWorld[2] * _11.zzzz) + _9;
    _9 += pcrObjectToWorld[3];
    _48 = _9.yyyy * pcrViewProjection[1];
    _48 = (pcrViewProjection[0] * _9.xxxx) + _48;
    _48 = (pcrViewProjection[2] * _9.zzzz) + _48;
    _9 = (pcrViewProjection[3] * _9.wwww) + _48;
    gl_Position = _9;
    vs_TEXCOORD0 = _87;
}
