precision mediump float;
precision highp int;

uniform mediump sampler2D _13;

layout(location = 0) out highp vec4 _34;
in highp vec2 vs_TEXCOORD0;
layout(location = 1) out highp vec4 _40;
vec4 _9;
vec3 _22;

void main()
{
    _9 = texture(_13, vs_TEXCOORD0);
    _22 = _9.www * _9.xyz;
    _34.w = _9.w;
    _34 = vec4(_22.x, _22.y, _22.z, _34.w);
    _40 = vec4(0.0);
}
