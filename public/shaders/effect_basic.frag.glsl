precision mediump float;
precision highp int;

uniform mediump float _MainPower;
uniform mediump float _AlphaBlend;

uniform mediump sampler2D _13;

in vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _51;
layout(location = 1) out highp vec4 _53;
vec4 _9;
vec4 _31;

void main()
{
    _9 = texture(_13, vs_TEXCOORD0);
    _9 *= vec4(_MainPower);
    vec3 _37 = _9.www * _9.xyz;
    _31 = vec4(_37.x, _37.y, _37.z, _31.w);
    _31.w = _9.w * _AlphaBlend;
    _51 = _31;
    _53 = vec4(0.0);
}
