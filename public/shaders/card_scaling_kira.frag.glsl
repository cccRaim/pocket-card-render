precision mediump float;
precision highp int;

uniform float _ScrollScale;
uniform float _Anim;
uniform mediump sampler2D _39;
uniform mediump sampler2D _48;
uniform mediump sampler2D _85;

in highp float vs_TEXCOORD1;
in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _98;
layout(location = 1) out highp vec4 _101;
highp vec2 _9;
vec4 _35;
vec4 _47;
vec3 _55;

void main()
{
    _9.x = (_Anim * _ScrollScale) + vs_TEXCOORD1;
    _9.y = 0.5;
    vec3 _44 = texture(_39, _9).xyz;
    _35 = vec4(_44.x, _44.y, _44.z, _35.w);
    _47 = texture(_48, vs_TEXCOORD0);
    _55.x = (-_47.w) + 1.0;
    _55 = _35.xyz * _55.xxx;
    vec3 _74 = (_47.xyz * _47.www) + _55;
    _35 = vec4(_74.x, _74.y, _74.z, _35.w);
    vec3 _82 = clamp(_35.xyz, vec3(0.0), vec3(1.0));
    _35 = vec4(_82.x, _82.y, _82.z, _35.w);
    _47.x = texture(_85, vs_TEXCOORD0).x;
    _35.w = max(_47.x, _47.w);
    _98 = _35;
    _35.x = 0.0;
    _101 = _35.xxxw;
}
