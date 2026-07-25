precision mediump float;
precision highp int;

uniform float _AdjustAddAlpha;
uniform float _AdjustAddMinAlpha;
uniform float _PrimMorphing[20];
uniform int _PrimTypes[20];
uniform float _EmissiveIntensity;
uniform float _AdjustEmissiveAlpha;

uniform mediump sampler2D _13;
uniform mediump sampler2D _23;
uniform mediump sampler2D _56;
uniform mediump sampler2D _62;
uniform mediump sampler2D _105;
uniform mediump sampler2D _110;

in highp vec3 vs_TEXCOORD0;
flat in int vs_TEXCOORD2;
layout(location = 0) out highp vec4 _164;
layout(location = 1) out highp vec4 _183;
vec4 _9;
vec4 _22;
highp vec4 _28;
int _35;
vec4 _61;
highp vec4 _67;
bvec2 _83;
bool _150;
float _169;
highp float _175;

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
    bvec4 _103 = bvec4(_83.y);
    _28 = vec4(_103.x ? _28.x : _67.x, _103.y ? _28.y : _67.y, _103.z ? _28.z : _67.z, _103.w ? _28.w : _67.w);
    _22 = texture(_105, vs_TEXCOORD0.xy);
    _61 = texture(_110, vs_TEXCOORD0.xy);
    _67 = _22 + (-_61);
    _67 = (vec4(_PrimMorphing[_35]) * _67) + _61;
    bvec4 _132 = bvec4(_83.x);
    _28 = vec4(_132.x ? _67.x : _28.x, _132.y ? _67.y : _28.y, _132.z ? _67.z : _28.z, _132.w ? _67.w : _28.w);
    _67.x = (_28.w * vs_TEXCOORD0.z) + (-0.00390625);
    _28 *= vs_TEXCOORD0.zzzz;
    _150 = _67.x < 0.0;
    if ((int(_150) * (-1)) != 0)
    {
        discard;
    }
    _164 = vec4(_28.xyz.x, _28.xyz.y, _28.xyz.z, _164.w);
    _169 = (-_AdjustAddMinAlpha) + 1.0;
    _175 = (_28.w * _169) + _AdjustAddMinAlpha;
    highp vec3 _190 = _28.xyz * vec3(_EmissiveIntensity);
    _183 = vec4(_190.x, _190.y, _190.z, _183.w);
    _28.x = _175 * _AdjustAddAlpha;
    _164.w = _28.x;
    _183.w = _28.x * _AdjustEmissiveAlpha;
}
