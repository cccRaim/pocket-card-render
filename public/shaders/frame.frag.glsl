precision mediump float;
precision highp int;

uniform mediump sampler2D _13;

layout(location = 0) out highp vec4 _21;
in highp vec2 vs_TEXCOORD0;
layout(location = 1) out highp vec4 _45;
vec4 _9;

void main()
{
    _9 = texture(_13, vs_TEXCOORD0);
    _21 = _9;
    _9.x = 0.0;
    _9.y = 0.0;
    _9.z = 0.0;
    _45 = _9;
}
