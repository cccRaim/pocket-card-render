precision mediump float;
precision highp int;

uniform highp float _Switch;
uniform int _UseColor3Mask;
uniform vec4 _Color3;
uniform highp float _AdditiveIntensity;
uniform int _OnColor1Area;
uniform int _UseColor3Blend;
uniform highp float _Color3Blend;
uniform highp float _Color3BlendMax;
uniform int _UseEmissive;
uniform highp float _EmissiveIntensity;
uniform int _UseEmissiveMask;
uniform float _Color1AlphaBlend;
uniform float _NotColor1AreaAlphaBlend;

uniform mediump sampler2D _31;
uniform mediump sampler2D _71;
uniform mediump sampler2D _76;
uniform mediump sampler2D _245;

in vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _200;
layout(location = 1) out highp vec4 _272;
highp vec3 _9;
float _27;
highp vec2 _40;
highp vec2 _45;
vec4 _70;
vec4 _75;
highp vec4 _80;
highp vec4 _104;
highp float _113;
highp vec3 _153;
highp vec3 _164;
float _244;

void main()
{
    _9.x = _Color3Blend * _Color3BlendMax;
    _27 = texture(_31, vs_TEXCOORD0).x;
    _40.x = _27 + (-1.0);
    _45.x = float(_UseColor3Mask);
    _40.x = (_45.x * _40.x) + 1.0;
    _45 = vec2(ivec2(_OnColor1Area, _UseColor3Blend));
    _70 = texture(_71, vs_TEXCOORD0);
    _75 = texture(_76, vs_TEXCOORD0);
    _80 = _70 + (-_75);
    _80 = (vec4(vec4(_Switch, _Switch, _Switch, _Switch)) * _80) + _75;
    _104.x = (-_80.w) + _75.w;
    _113 = _75.w + (-1.0);
    _113 = (_Switch * _113) + 1.0;
    _45.x = (_45.x * _104.x) + _80.w;
    _40.x = _45.x * _40.x;
    _9.x = _40.x * _9.x;
    highp vec3 _150 = _40.xxx * _Color3.xyz;
    _104 = vec4(_150.x, _104.y, _150.y, _150.z);
    _153 = ((-_80.xyz) * _80.www) + _Color3.xyz;
    _164 = _80.www * _80.xyz;
    _9 = (_9.xxx * _153) + _164;
    highp vec3 _184 = (_104.xzw * vec3(_AdditiveIntensity)) + _164;
    _104 = vec4(_184.x, _104.y, _184.y, _184.z);
    _9 += (-_104.xzw);
    _9 = (_45.yyy * _9) + _104.xzw;
    _200 = vec4(_9.x, _9.y, _9.z, _200.w);
    highp vec3 _217 = _9 * vec3(vec3(_EmissiveIntensity, _EmissiveIntensity, _EmissiveIntensity));
    _80 = vec4(_217.x, _217.y, _217.z, _80.w);
    _9.x = (-_NotColor1AreaAlphaBlend) + _Color1AlphaBlend;
    _9.x = (_113 * _9.x) + _NotColor1AreaAlphaBlend;
    _200.w = _9.x * _80.w;
    _244 = texture(_245, vs_TEXCOORD0).x;
    _9.x = _244 + (-1.0);
    _40 = vec2(ivec2(_UseEmissiveMask, _UseEmissive));
    _9.x = (_40.x * _9.x) + 1.0;
    _80 = _9.xxxx * _80;
    _272 = _40.yyyy * _80;
}
