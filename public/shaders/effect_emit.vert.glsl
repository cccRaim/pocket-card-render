precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform highp float _UVScale;

in vec3 position;
in vec2 uv;
out mediump vec2 vs_TEXCOORD0;
vec4 _9;
vec4 _48;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _84 = uv;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9 = _11.yyyy * modelMatrix[1];
    _9 = (modelMatrix[0] * _11.xxxx) + _9;
    _9 = (modelMatrix[2] * _11.zzzz) + _9;
    _9 += modelMatrix[3];
    _48 = _9.yyyy * _ViewProjection[1];
    _48 = (_ViewProjection[0] * _9.xxxx) + _48;
    _48 = (_ViewProjection[2] * _9.zzzz) + _48;
    gl_Position = (_ViewProjection[3] * _9.wwww) + _48;
    mediump vec2 _91 = (_84 * vec2(2.0)) + vec2(-1.0);
    _9 = vec4(_91.x, _91.y, _9.z, _9.w);
    vec2 _100 = _9.xy / vec2(_UVScale);
    _9 = vec4(_100.x, _100.y, _9.z, _9.w);
    vec2 _108 = (_9.xy * vec2(0.5)) + vec2(0.5);
    _9 = vec4(_108.x, _108.y, _9.z, _9.w);
    vs_TEXCOORD0 = _9.xy;
}
