precision mediump float;
precision highp int;
uniform highp vec4 _HighlightColor;
uniform highp float _HighlightColorPower;
uniform highp float _HighlightEmissiveIntensity;
uniform float _AlphaBlend;
uniform float _EmissiveIntensity;
uniform mediump sampler2D _13;
uniform mediump sampler2D _25;

in highp vec4 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _109;
layout(location = 1) out highp vec4 _142;
vec3 _9;
float _24;
highp vec3 _33;
highp float _38;
highp vec4 _58;
vec4 _64;
vec4 _75;
vec4 _134;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main() {


    _9 = texture(_13, pcrStoredUv( vs_TEXCOORD0.zw)).xyz;
    _24 = texture(_25, pcrStoredUv( vs_TEXCOORD0.xy)).x;
    _33 = vec3(_24) * _9;
    _38 = _24;
    _38 = clamp(_38, 0.0, 1.0);
    _33 = log2(_33);
    _33 *= vec3(_HighlightColorPower);
    highp vec3 _61 = exp2(_33.yzx);
    _58 = vec4(_61.x, _61.y, _58.z, _61.z);
    highp vec3 _72 = _58.wxy + _HighlightColor.xyz;
    _64 = vec4(_72.x, _72.y, _72.z, _64.w);
    highp vec3 _80 = _58.www * _64.xyz;
    _75 = vec4(_80.x, _80.y, _80.z, _75.w);
    vec3 _97 = _64.xyz * vec3(vec3(_EmissiveIntensity, _EmissiveIntensity, _EmissiveIntensity));
    _64 = vec4(_97.x, _97.y, _97.z, _64.w);
    _75.w = _58.w * _AlphaBlend;
    _109 = _75;
    highp vec3 _125 = _58.wxy * vec3(vec3(_HighlightEmissiveIntensity, _HighlightEmissiveIntensity, _HighlightEmissiveIntensity));
    _58 = vec4(_125.x, _125.y, _125.z, _58.w);
    _64.w = _58.w * _EmissiveIntensity;
    _134 = _58 + _64;
    _134 = clamp(_134, vec4(0.0), vec4(1.0));
    _142 = vec4(_38) * _134;
}
