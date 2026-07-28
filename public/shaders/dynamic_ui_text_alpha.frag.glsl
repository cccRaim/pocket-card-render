precision mediump float;
precision highp int;

uniform mediump float _AlphaThreshold;
uniform highp float _Alpha;
uniform mediump sampler2D _13;

in highp vec2 vs_TEXCOORD0;
layout(location = 1) out highp vec4 _65;
layout(location = 0) out highp vec4 _69;
vec4 _9;
highp float _21;
bool _31;
highp vec4 _51;

void main()
{
    _9 = texture(_13, vs_TEXCOORD0);
    _21 = (-_9.w) + 1.0;
    _31 = _21 < _AlphaThreshold;
    if ((int(_31) * (-1)) != 0)
    {
        discard;
    }
    _51 = (_9 * vec4(1.0, 1.0, 1.0, -1.0)) + vec4(0.0, 0.0, 0.0, 1.0);
    _51 *= vec4(_Alpha);
    _65 = _51.wwww * vec4(0.0, 0.0, 0.0, 1.0);
    _69 = _51;
}
