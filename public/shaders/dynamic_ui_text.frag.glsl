precision mediump float;
precision highp int;

uniform highp float _AlphaThreshold;
uniform highp float _EmitMasking;

uniform mediump sampler2D _13;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _58;
layout(location = 1) out highp vec4 _74;
vec4 _9;
float _21;
bool _31;
vec4 _51;

void main()
{
    _9 = texture(_13, vs_TEXCOORD0);
    _21 = (-_9.w) + 1.0;
    _31 = _21 < _AlphaThreshold;
    if ((int(_31) * (-1)) != 0)
    {
        discard;
    }
    _51.w = _21 * _EmitMasking;
    _58 = vec4(_9.xyz.x, _9.xyz.y, _9.xyz.z, _58.w);
    _58.w = _21;
    _51.x = 0.0;
    _51.y = 0.0;
    _51.z = 0.0;
    _74 = _51;
}
