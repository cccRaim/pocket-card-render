precision mediump float;
precision highp int;

uniform highp float _RemoveTextureArtifact;
uniform int _EmissivePattern;
uniform highp vec4 _EmissiveColor;
uniform int uBloomOnly;

uniform mediump sampler2D _13;

in highp vec2 vs_TEXCOORD0;
in vec4 vs_TEXCOORD1;
layout(location = 0) out highp vec4 _56;
layout(location = 1) out highp vec4 _72;
vec4 _9;
highp vec4 _20;
bool _66;

void main()
{
    _9 = texture(_13, vs_TEXCOORD0);
    _20 = _9 + (-vec4(vec4(_RemoveTextureArtifact, _RemoveTextureArtifact, _RemoveTextureArtifact, _RemoveTextureArtifact)));
    _20 = clamp(_20, vec4(0.0), vec4(1.0));
    _20 *= vs_TEXCOORD1;
    _56 = _20;
    _20 *= _EmissiveColor;
    _66 = _EmissivePattern == 1;
    bvec4 _77 = bvec4(_66);
    _72 = vec4(_77.x ? _20.x : vec4(0.0).x, _77.y ? _20.y : vec4(0.0).y, _77.z ? _20.z : vec4(0.0).z, _77.w ? _20.w : vec4(0.0).w);
    if (uBloomOnly != 0)
    {
        _56 = _72;
    }
}
