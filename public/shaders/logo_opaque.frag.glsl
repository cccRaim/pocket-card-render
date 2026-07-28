precision mediump float;
precision highp int;

uniform mediump sampler2D _13;

layout(location = 0) out highp vec4 _9;
in highp vec2 vs_TEXCOORD0;
layout(location = 1) out highp vec4 _20;

void main()
{
    _9 = texture(_13, vs_TEXCOORD0);
    _20 = vec4(0.0);
}
