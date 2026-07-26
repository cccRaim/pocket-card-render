precision mediump float;
precision highp int;

uniform highp vec4 _TextureSampleAdd;

uniform mediump sampler2D _MainTex;

in mediump vec2 vUv;
in mediump vec4 vColor;
layout(location = 0) out highp vec4 outColor;
layout(location = 1) out highp vec4 outAux;
vec4 _9;
highp vec4 _20;
vec3 _38;

void main()
{
    _9 = texture(_MainTex, vUv);
    _20 = _9 + _TextureSampleAdd;
    _20 *= vColor;
    _38 = _20.www * _20.xyz;
    outColor.w = _20.w;
    outColor = vec4(_38.x, _38.y, _38.z, outColor.w);
    outAux = vec4(0.0);
}
