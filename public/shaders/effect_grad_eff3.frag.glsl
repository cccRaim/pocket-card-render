precision mediump float;
precision highp int;

uniform mediump float _MainPower;
uniform mediump float _AlphaBlend;

uniform mediump sampler2D _18;
uniform mediump sampler2D _29;

in vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _65;
layout(location = 1) out highp vec4 _67;
vec4 _9;
vec4 _49;

void main()
{
    _9.x = 0.5;
    _9.w = texture(_18, vs_TEXCOORD0).z;
    vec3 _35 = texture(_29, _9.wx).xyz;
    _9 = vec4(_35.x, _35.y, _35.z, _9.w);
    _9 *= vec4(_MainPower);
    vec3 _54 = _9.www * _9.xyz;
    _49 = vec4(_54.x, _54.y, _54.z, _49.w);
    _49.w = _9.w * _AlphaBlend;
    _65 = _49;
    _67 = vec4(0.0);
}
