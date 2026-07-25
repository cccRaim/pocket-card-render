precision mediump float;
precision highp int;

uniform mediump sampler2D _MainTex;

in highp vec2 vUv;
layout(location = 0) out vec4 outColor;
vec4 _9;
highp vec3 _22;

void main()
{
    _9 = texture(_MainTex, vUv);
    _22 = (_9.xyz * vec3(0.305306017398834228515625)) + vec3(0.6821711063385009765625);
    _22 = (_9.xyz * _22) + vec3(0.01252287812530994415283203125);
    highp vec3 _41 = _9.xyz * _22;
    _9 = vec4(_41.x, _41.y, _41.z, _9.w);
    outColor = _9;
}
