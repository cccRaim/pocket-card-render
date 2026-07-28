precision mediump float;
precision highp int;

uniform highp float _IllustAlpha;

uniform mediump sampler2D _13;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _21;
layout(location = 1) out highp vec4 _43;
vec4 _9;

void main()
{
    _9 = texture(_13, vs_TEXCOORD0);
    _21.w = _9.w * _IllustAlpha;
    _21 = vec4(_9.xyz.x, _9.xyz.y, _9.xyz.z, _21.w);
    _43 = vec4(0.0);
}
