precision mediump float;
precision highp int;

uniform highp vec2 _GlobalMipBias;
uniform mediump sampler2D _MainTex;

in highp vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outEmissive;
vec4 _9;

void main()
{
    _9 = texture(_MainTex, vUv, _GlobalMipBias.x);
    outColor = _9;
    outEmissive = vec4(0.0);
}
