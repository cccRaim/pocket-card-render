precision mediump float;
precision highp int;

const uvec4 _66[4] = uvec4[](uvec4(1059481190u, 1044885012u, 0u, 0u), uvec4(1075545375u, 1044482359u, 0u, 0u), uvec4(1082906378u, 1035342132u, 0u, 0u), uvec4(1086995825u, 1021182162u, 0u, 0u));

uniform highp vec2 _GlobalMipBias;
uniform highp vec4 _MainTex_TexelSize;
uniform vec2 _Vector;
uniform mediump sampler2D _MainTex;

in highp vec2 vUv;
layout(location = 0) out vec4 outColor;
highp vec2 _9;
vec3 _27;
highp vec2 _49;
vec3 _81;
highp vec2 _93;
vec3 _105;
vec3 _112;
int _149;
bool _151;

void main()
{
    _9 = _MainTex_TexelSize.xy * _Vector;
    _27.x = 0.0;
    _27.y = 0.0;
    _27.z = 0.0;
    for (int _38 = 0; _38 < 4; _38++)
    {
        _49 = (_9 * uintBitsToFloat(_66[_38].xx)) + vUv;
        _81 = texture(_MainTex, _49, _GlobalMipBias.x).xyz;
        _93 = ((-_9) * uintBitsToFloat(_66[_38].xx)) + vUv;
        _105 = texture(_MainTex, _93, _GlobalMipBias.x).xyz;
        _112 = _81 + _105;
        _27 = (_112 * uintBitsToFloat(_66[_38].yyy)) + _27;
    }
    outColor = vec4(_27.x, _27.y, _27.z, outColor.w);
    outColor.w = 1.0;
}
