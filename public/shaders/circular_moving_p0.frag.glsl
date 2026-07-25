precision mediump float;
precision highp int;

uniform float _AdjustAlphaBlendAlpha;
uniform float _PrimMorphing[20];
uniform int _PrimTypes[20];
uniform float _EmissiveIntensity;

uniform mediump sampler2D _13;
uniform mediump sampler2D _23;
uniform mediump sampler2D _56;
uniform mediump sampler2D _62;
uniform mediump sampler2D _104;
uniform mediump sampler2D _109;

in highp vec3 vs_TEXCOORD0;
flat in int vs_TEXCOORD2;
layout(location = 0) out highp vec4 _163;
layout(location = 1) out highp vec4 _175;
vec4 _9;
vec4 _22;
highp vec4 _28;
int _35;
vec4 _61;
highp vec4 _67;
bvec2 _83;
bool _149;

void main()
{
    _9 = texture(_13, vs_TEXCOORD0.xy);
    _22 = texture(_23, vs_TEXCOORD0.xy);
    _28 = _9 + (-_22);
    _35 = vs_TEXCOORD2;
    _28 = (vec4(_PrimMorphing[_35]) * _28) + _22;
    _22 = texture(_56, vs_TEXCOORD0.xy);
    _61 = texture(_62, vs_TEXCOORD0.xy);
    _67 = _22 + (-_61);
    _67 = (vec4(_PrimMorphing[_35]) * _67) + _61;
    _83 = lessThan(ivec4(_PrimTypes[_35]), ivec4(1, 2, 0, 0)).xy;
    bvec4 _102 = bvec4(_83.y);
    _28 = vec4(_102.x ? _28.x : _67.x, _102.y ? _28.y : _67.y, _102.z ? _28.z : _67.z, _102.w ? _28.w : _67.w);
    _22 = texture(_104, vs_TEXCOORD0.xy);
    _61 = texture(_109, vs_TEXCOORD0.xy);
    _67 = _22 + (-_61);
    _67 = (vec4(_PrimMorphing[_35]) * _67) + _61;
    bvec4 _131 = bvec4(_83.x);
    _28 = vec4(_131.x ? _67.x : _28.x, _131.y ? _67.y : _28.y, _131.z ? _67.z : _28.z, _131.w ? _67.w : _28.w);
    _67.x = (_28.w * vs_TEXCOORD0.z) + (-0.00390625);
    _28 *= vs_TEXCOORD0.zzzz;
    _149 = _67.x < 0.0;
    if ((int(_149) * (-1)) != 0)
    {
        discard;
    }
    _163.w = _28.w * _AdjustAlphaBlendAlpha;
    _163 = vec4(_28.xyz.x, _28.xyz.y, _28.xyz.z, _163.w);
    highp vec3 _182 = _28.xyz * vec3(_EmissiveIntensity);
    _175 = vec4(_182.x, _182.y, _182.z, _175.w);
    _175.w = 0.0;
}
