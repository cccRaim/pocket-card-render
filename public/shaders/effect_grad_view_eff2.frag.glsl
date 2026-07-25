precision mediump float;
precision highp int;

uniform mediump float _MainPower;
uniform mediump float _MaskPower;
uniform mediump float _AnglePower;
uniform mediump float _Edge;
uniform mediump float _Progress;
uniform mediump float _AlphaBlend;

uniform mediump sampler2D _13;
uniform mediump sampler2D _116;

in vec2 vs_TEXCOORD0;
in vec3 vs_TEXCOORD1;
layout(location = 0) out highp vec4 _192;
layout(location = 1) out highp vec4 _194;
vec4 _9;
vec4 _26;
float _41;
float _74;
vec2 _143;
float _160;

void main()
{
    _9.w = texture(_13, vs_TEXCOORD0).y;
    _26.x = _9.w + (-_Edge);
    _41 = _9.w + _Edge;
    _26.x = (-_41) + _26.x;
    _26.x = (_Progress * _26.x) + _41;
    _41 = (-_Edge) + _Progress;
    _26.x = (-_41) + _26.x;
    _74 = _Edge + _Progress;
    _41 = (-_41) + _74;
    _41 = 1.0 / _41;
    _26.x = _41 * _26.x;
    _26.x = clamp(_26.x, 0.0, 1.0);
    _41 = (_26.x * (-2.0)) + 3.0;
    _26.x *= _26.x;
    _26.w = _26.x * _41;
    _9.x = 0.5;
    vec3 _122 = texture(_116, _9.wx).xyz;
    _9 = vec4(_122.x, _122.y, _122.z, _9.w);
    vec3 _131 = _9.xyz * vec3(_MainPower);
    _26 = vec4(_131.x, _131.y, _131.z, _26.w);
    _9 = (_9 * vec4(_MainPower)) + (-_26);
    _143 = (vs_TEXCOORD1.xy * vec2(vec2(_AnglePower, _AnglePower))) + vs_TEXCOORD0;
    _160 = texture(_13, _143).w;
    _143.x = _160 * _MaskPower;
    _9 = (_143.xxxx * _9) + _26;
    vec3 _181 = _9.www * _9.xyz;
    _26 = vec4(_181.x, _181.y, _181.z, _26.w);
    _26.w = _9.w * _AlphaBlend;
    _192 = _26;
    _194 = vec4(0.0);
}
