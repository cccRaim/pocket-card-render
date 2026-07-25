precision mediump float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp float _LightSensitive;
uniform highp float _LightCurvePower;
uniform highp vec4 _LightingColor;
uniform int _Debug;
uniform int _EmissiveEnabled;
uniform highp float _EmissiveIntensity;
uniform highp vec4 _EmissiveColor;
uniform mediump sampler2D _56;
uniform mediump sampler2D _63;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _228;
layout(location = 1) out highp vec4 _230;
highp vec2 _9;
float _52;
vec4 _62;
bool _74;
vec4 _79;
vec2 _87;
bool _114;
bool _189;
highp vec4 _194;
vec4 _198;

void main()
{
    _9.x = dot(-modelMatrix[2].xyz, -modelMatrix[2].xyz);
    _9.x = inversesqrt(_9.x);
    _9 = _9.xx * (-modelMatrix[2].xy);
    _9 = (_9 * vec2(0.449999988079071044921875)) + vec2(0.5);
    _52 = texture(_56, _9).x;
    vec2 _69 = texture(_63, vs_TEXCOORD0).xy;
    _62 = vec4(_69.x, _69.y, _62.z, _62.w);
    _74 = _62.x != 0.0;
    _79.x = (-_52) + _62.y;
    _87 = vec2(_52) + vec2(-1.0, 1.0);
    _87 = _62.yy + (-_87);
    _79.x = min(abs(_87.x), abs(_79.x));
    _79.x = min(abs(_87.y), _79.x);
    _114 = _79.x < _LightSensitive;
    _62 = _62.xxxx * _LightingColor;
    _79.x /= _LightSensitive;
    _79.x = (-_79.x) + 1.0;
    _79.x = log2(_79.x);
    _79.x *= _LightCurvePower;
    _79.x = exp2(_79.x);
    _62 *= _79.xxxx;
    bvec4 _161 = bvec4(_114);
    _62 = vec4(_161.x ? _62.x : vec4(0.0).x, _161.y ? _62.y : vec4(0.0).y, _161.z ? _62.z : vec4(0.0).z, _161.w ? _62.w : vec4(0.0).w);
    bvec4 _165 = bvec4(_74);
    _62 = vec4(_165.x ? _62.x : vec4(0.0).x, _165.y ? _62.y : vec4(0.0).y, _165.z ? _62.z : vec4(0.0).z, _165.w ? _62.w : vec4(0.0).w);
    if (_Debug != 0)
    {
        _79 = texture(_56, vs_TEXCOORD0);
        _9 = (-_9) + vs_TEXCOORD0;
        _9.x = dot(_9, _9);
        _9.x = sqrt(_9.x);
        _189 = _9.x < 0.00999999977648258209228515625;
        _194 = _79 * vec4(0.5);
        bvec4 _202 = bvec4(_189);
        _198 = vec4(_202.x ? vec4(0.5, 0.0, 0.0, 0.5).x : _194.x, _202.y ? vec4(0.5, 0.0, 0.0, 0.5).y : _194.y, _202.z ? vec4(0.5, 0.0, 0.0, 0.5).z : _194.z, _202.w ? vec4(0.5, 0.0, 0.0, 0.5).w : _194.w);
        _62 = (_62 * vec4(0.5)) + _198;
    }
    _198 = vec4(_EmissiveIntensity) * _EmissiveColor;
    _198 = _62.wwww * _198;
    bvec4 _225 = bvec4(_EmissiveEnabled != 0);
    _198 = vec4(_225.x ? _198.x : vec4(0.0).x, _225.y ? _198.y : vec4(0.0).y, _225.z ? _198.z : vec4(0.0).z, _225.w ? _198.w : vec4(0.0).w);
    _228 = _62;
    _230 = _198;
}
