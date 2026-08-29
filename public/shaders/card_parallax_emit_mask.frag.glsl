precision mediump float;
precision highp int;

uniform highp float _EmitMasking;

uniform mediump sampler2D _13;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _29;
layout(location = 1) out highp vec4 _40;
vec4 _9;
vec3 _22;

void main()
{
    _9 = texture(_13, vs_TEXCOORD0);
    _22 = _9.www * _9.xyz;
    _29 = vec4(_22.x, _22.y, _22.z, _29.w);
    _29.w = _9.w;
    _40.w = _9.w * _EmitMasking;
    _40 = vec4(vec3(0.0).x, vec3(0.0).y, vec3(0.0).z, _40.w);
}
