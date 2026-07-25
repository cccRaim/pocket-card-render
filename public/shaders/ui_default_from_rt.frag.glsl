precision mediump float;
precision highp int;

uniform highp vec4 _TextureSampleAdd;

uniform mediump sampler2D _MainTex;

in highp vec2 vUv;
in mediump vec4 vColor;
layout(location = 0) out highp vec4 outColor;
layout(location = 1) out highp vec4 outAux;
vec4 _9;
vec4 _20;

void main()
{
    _9 = texture(_MainTex, vUv);
    vec3 _33 = _9.xyz + _TextureSampleAdd.xyz;
    _20 = vec4(_33.x, _33.y, _33.z, _20.w);
    _20.w = (-_9.w) + 1.0;
    vec3 _51 = _20.xyz * vColor.xyz;
    _20 = vec4(_51.x, _51.y, _51.z, _20.w);
    _9 = _20 * vColor.wwww;
    outColor = _9;
    outAux = vec4(0.0);
}
