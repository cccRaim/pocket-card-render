precision mediump float;
precision highp int;

uniform float _BaseColorIntensity;
uniform float _AdjustAlphaBlendColor;
uniform float _AdjustAlphaBlendAlpha;
uniform float _BaseScaleAdjust;
uniform float _UVOffset;
uniform float _BrightnessPower;
uniform float _BrightnessAffectIntensity;
uniform float _FlickerScale;
uniform float _FlickerSpeed;
uniform float _NoiseTime;

uniform mediump sampler2D _149;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _201;
layout(location = 1) out highp vec4 _220;
highp vec3 _9;
highp float _26;
highp float _60;
highp float _73;
float _109;
vec4 _145;
highp float _154;
bool _162;

void main()
{
    _9.x = _FlickerSpeed * _NoiseTime;
    _26 = fract(_9.x);
    _9.x = floor(_9.x);
    highp vec2 _40 = _9.xx + vec2(12345.6787109375, 12346.6787109375);
    _9 = vec3(_40.x, _9.y, _40.y);
    highp vec2 _45 = sin(_9.xz);
    _9 = vec3(_45.x, _9.y, _45.y);
    highp vec2 _52 = _9.xz * vec2(43758.546875);
    _9 = vec3(_52.x, _9.y, _52.y);
    highp vec2 _57 = fract(_9.xz);
    _9 = vec3(_57.x, _9.y, _57.y);
    _60 = _26 * _26;
    _26 = ((-_26) * 2.0) + 3.0;
    _26 *= _60;
    _73 = (-_9.x) + _9.z;
    _9.x = (_26 * _73) + _9.x;
    _9.x = ((-_9.x) * _FlickerScale) + vs_TEXCOORD0.y;
    _9.x = clamp(_9.x, 0.0, 1.0);
    _109 = _9.x + 0.001000000047497451305389404296875;
    _109 = 1.0 / _109;
    _9.x = vs_TEXCOORD0.x + _UVOffset;
    _9.x += (-0.5);
    _9.x *= _BaseScaleAdjust;
    _9.x = (_9.x * _109) + 0.5;
    _9.y = 0.5;
    _145 = texture(_149, _9.xy);
    _154 = _145.w + (-0.00390625);
    _162 = _154 < 0.0;
    if ((int(_162) * (-1)) != 0)
    {
        discard;
    }
    _60 = _145.w * _AdjustAlphaBlendAlpha;
    _109 = _BrightnessPower + (-1.0);
    _109 = (_BrightnessAffectIntensity * _109) + 1.0;
    _154 = log2(vs_TEXCOORD0.y);
    _154 = _109 * _154;
    _154 = exp2(_154);
    _201.w = _60 * _154;
    _109 = _AdjustAlphaBlendColor * _BaseColorIntensity;
    _9 = _145.xyz * vec3(_109);
    _201 = vec4(_9.x, _9.y, _9.z, _201.w);
    _220 = vec4(_9.x, _9.y, _9.z, _220.w);
    _220.w = 0.0;
}
