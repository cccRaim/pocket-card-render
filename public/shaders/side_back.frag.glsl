precision mediump float;
precision highp int;

uniform mediump vec4 _Blend;

uniform mediump sampler2D _BaseTex;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _59;
layout(location = 1) out highp vec4 _67;
vec3 _9;
vec3 _30;
vec4 _40;

void main()
{
    _9.x = (-_Blend.w) + 1.0;
    _30 = _Blend.www * _Blend.xyz;
    _40 = texture(_BaseTex, vs_TEXCOORD0);
    _9 = (_40.xyz * _9.xxx) + _30;
    _59.w = _40.w;
    _59 = vec4(_9.x, _9.y, _9.z, _59.w);
    _67 = vec4(0.0);
}
