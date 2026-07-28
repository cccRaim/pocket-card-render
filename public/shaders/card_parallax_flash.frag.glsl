precision mediump float;
precision highp int;

uniform highp float _RadialAnim;
uniform highp vec2 _ScaleCenter;
uniform highp float _RadialFlashPow;
uniform highp float _RadialFlashRange;
uniform highp float _FlashIntensity;
uniform highp float _FlashIntensityByMat;
uniform highp vec3 _BrightColor;
uniform highp vec3 _DarkColor;
uniform highp float _AlphaBlend;
uniform highp float _EmissiveIntensity;

uniform mediump sampler2D _82;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _169;
layout(location = 1) out highp vec4 _182;
highp vec4 _9;
float _78;
highp vec3 _108;
highp vec4 _118;

void main()
{
    highp vec2 _28 = vec2(_ScaleCenter.x, _ScaleCenter.y) + vec2(0.5);
    _9 = vec4(_28.x, _28.y, _9.z, _9.w);
    highp vec2 _37 = (-_9.xy) + vs_TEXCOORD0;
    _9 = vec4(_37.x, _37.y, _9.z, _9.w);
    _9.x = dot(_9.xy, _9.xy);
    _9.x = sqrt(_9.x);
    _9.x += (-_RadialAnim);
    _9.x = abs(_9.x) / _RadialFlashRange;
    _9.x = (-_9.x) + 1.0;
    _9.x = clamp(_9.x, 0.0, 1.0);
    _78 = texture(_82, vs_TEXCOORD0).x;
    _9.x *= _78;
    _9.x = log2(_9.x);
    _9.x *= _RadialFlashPow;
    _9.x = exp2(_9.x);
    _108 = _BrightColor + (-_DarkColor);
    highp vec3 _125 = (_9.xxx * _108) + _DarkColor;
    _118 = vec4(_125.x, _125.y, _125.z, _118.w);
    _118.w = 1.0;
    _9 = _9.xxxx * _118;
    _9 *= vec4(vec4(_FlashIntensity, _FlashIntensity, _FlashIntensity, _FlashIntensity));
    _9 *= vec4(vec4(_FlashIntensityByMat, _FlashIntensityByMat, _FlashIntensityByMat, _FlashIntensityByMat));
    _169.w = _9.w * _AlphaBlend;
    _169 = vec4(_9.xyz.x, _9.xyz.y, _9.xyz.z, _169.w);
    _182 = _9 * vec4(_EmissiveIntensity);
}
