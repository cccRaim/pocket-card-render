precision mediump float;
precision highp int;

uniform mediump sampler2D _MainTex;
uniform mediump sampler2D _GradationMap;
uniform float _Layer;
uniform float _UseGradationMap;
uniform float _UseViewMask;
uniform float _MainPower;
uniform float _MaskPower;
uniform float _AnglePower;
uniform float _Edge;
uniform float _Progress;
uniform float _AlphaBlend;

in highp vec2 vs_TEXCOORD0;
in highp vec3 vs_TEXCOORD1;
layout(location = 0) out highp vec4 _185;
layout(location = 1) out highp vec4 _194;

float layerValue(vec4 s)
{
    return _Layer < 0.5 ? s.r : (_Layer < 1.5 ? s.g : s.b);
}

float edgeProgress(float raw)
{
    float denom = max(abs(_Edge * 2.0), 0.000001);
    float t = (raw - _Progress + 2.0 * _Edge * (1.0 - _Progress)) / denom;
    t = clamp(t, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

void main()
{
    vec4 e = texture(_MainTex, vs_TEXCOORD0);
    float raw = mix(e.a, layerValue(e), step(0.5, _UseGradationMap));
    float shaped = edgeProgress(raw);
    float gradU = mix(raw, shaped, step(0.5, _UseViewMask));
    vec3 baseRgb = mix(e.rgb, texture(_GradationMap, vec2(gradU, 0.5)).rgb, step(0.5, _UseGradationMap));
    vec3 poweredRgb = baseRgb * _MainPower;
    float poweredAlpha = raw * _MainPower;
    float alphaCore = poweredAlpha;
    if (_UseViewMask > 0.5) {
        float viewMask = texture(_MainTex, vs_TEXCOORD0 + vs_TEXCOORD1.xy * _AnglePower).a * _MaskPower;
        alphaCore = mix(shaped, poweredAlpha, viewMask);
    }
    _185 = vec4(poweredRgb * alphaCore, alphaCore * _AlphaBlend);
    _194 = vec4(0.0);
}
