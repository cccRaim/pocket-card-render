precision mediump float;
precision highp int;

uniform highp vec4 _MainTex_TexelSize;
uniform mediump sampler2D _MainTex;

in highp vec2 vUv;
in highp vec4 vColor;
layout(location = 0) out vec4 outColor;
highp vec3 _9;
vec3 _27;
highp vec4 _42;
vec3 _53;
vec3 _59;

void main()
{
    highp vec2 _24 = vUv + _MainTex_TexelSize.xy;
    _9 = vec3(_24.x, _24.y, _9.z);
    _27 = texture(_MainTex, _9.xy).xyz;
    _9 = max(_27, vec3(0.0));
    _42 = (_MainTex_TexelSize.xyxy * vec4(1.0, -1.0, -1.0, 1.0)) + vUv.xyxy;
    _53 = texture(_MainTex, _42.xy).xyz;
    _59 = texture(_MainTex, _42.zw).xyz;
    _9 = max(_9, _53);
    _9 = max(_59, _9);
    highp vec2 _76 = vUv + (-_MainTex_TexelSize.xy);
    _42 = vec4(_76.x, _76.y, _42.z, _42.w);
    _59 = texture(_MainTex, _42.xy).xyz;
    _9 = max(_9, _59);
    _9 *= vColor.xyz;
    outColor = vec4(_9.x, _9.y, _9.z, outColor.w);
    outColor.w = 1.0;
}
