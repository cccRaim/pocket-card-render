precision mediump float;
precision highp int;

uniform highp vec2 _GlobalMipBias;
uniform mediump sampler2D _MainTex;

in highp vec3 vUv;
in highp vec4 vColor;
layout(location = 0) out vec4 outColor;
vec4 _9;
highp vec4 _32;

void main()
{
    _9 = texture(_MainTex, vUv.xy, _GlobalMipBias.x);
    _32 = _9 * vColor;
    highp vec3 _42 = _32.xyz * vUv.zzz;
    _32 = vec4(_42.x, _42.y, _42.z, _32.w);
    outColor = _32;
}
