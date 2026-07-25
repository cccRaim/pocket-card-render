precision mediump float;
precision highp int;

uniform mediump float _MainPower;
uniform mediump float _MaskPower;
uniform mediump float _AnglePower;
uniform mediump float _Edge;
uniform mediump float _Progress;
uniform mediump float _AlphaBlend;

uniform mediump sampler2D _13;
uniform mediump sampler2D _115;

in vec2 vs_TEXCOORD0;
in vec3 vs_TEXCOORD1;
layout(location = 0) out highp vec4 _191;
layout(location = 1) out highp vec4 _193;
vec4 _9;
vec4 _26;
float _40;
float _73;
vec2 _142;
float _159;

void main()
{
    _9.w = texture(_13, vs_TEXCOORD0).x;
    _26.x = _9.w + (-_Edge);
    _40 = _9.w + _Edge;
    _26.x = (-_40) + _26.x;
    _26.x = (_Progress * _26.x) + _40;
    _40 = (-_Edge) + _Progress;
    _26.x = (-_40) + _26.x;
    _73 = _Edge + _Progress;
    _40 = (-_40) + _73;
    _40 = 1.0 / _40;
    _26.x = _40 * _26.x;
    _26.x = clamp(_26.x, 0.0, 1.0);
    _40 = (_26.x * (-2.0)) + 3.0;
    _26.x *= _26.x;
    _26.w = _26.x * _40;
    _9.x = 0.5;
    vec3 _121 = texture(_115, _9.wx).xyz;
    _9 = vec4(_121.x, _121.y, _121.z, _9.w);
    vec3 _130 = _9.xyz * vec3(_MainPower);
    _26 = vec4(_130.x, _130.y, _130.z, _26.w);
    _9 = (_9 * vec4(_MainPower)) + (-_26);
    _142 = (vs_TEXCOORD1.xy * vec2(vec2(_AnglePower, _AnglePower))) + vs_TEXCOORD0;
    _159 = texture(_13, _142).w;
    _142.x = _159 * _MaskPower;
    _9 = (_142.xxxx * _9) + _26;
    vec3 _180 = _9.www * _9.xyz;
    _26 = vec4(_180.x, _180.y, _180.z, _26.w);
    _26.w = _9.w * _AlphaBlend;
    _191 = _26;
    _193 = vec4(0.0);
}
