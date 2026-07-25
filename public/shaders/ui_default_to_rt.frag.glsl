precision mediump float;
precision highp int;

uniform highp vec4 _TextureSampleAdd;

uniform mediump sampler2D _MainTex;

in highp vec2 vUv;
layout(location = 0) out highp vec4 outColor;
in mediump vec4 vColor;
layout(location = 1) out highp vec4 outAux;
vec4 _9;
highp vec4 _20;

void main()
{
    _9 = texture(_MainTex, vUv);
    _20 = _9 + _TextureSampleAdd;
    outColor = _20 * vColor;
    outAux = vec4(0.0);
}
