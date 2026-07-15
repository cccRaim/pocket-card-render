precision mediump float;
precision highp int;

uniform mediump sampler2D _13;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _29;
layout(location = 1) out highp vec4 _40;

void main()
{
    vec4 sampled = texture(_13, vs_TEXCOORD0);
    _29 = vec4(sampled.rgb * sampled.a, sampled.a);
    _40 = vec4(0.0);
}
