precision mediump float;
precision highp int;

uniform highp vec4 _Time;
uniform highp float _FaceUVSpeedX;
uniform highp float _FaceUVSpeedY;
uniform highp vec4 _FaceColor;
uniform highp float _OutlineSoftness;
uniform highp float _OutlineUVSpeedX;
uniform highp float _OutlineUVSpeedY;
uniform highp vec4 _OutlineColor;
uniform highp float _OutlineWidth;
uniform highp float _ScaleRatioA;

uniform mediump sampler2D _MainTex;
uniform mediump sampler2D _OutlineTex;
uniform mediump sampler2D _FaceTex;

in highp vec2 vs_TEXCOORD0;
in highp vec4 vs_TEXCOORD1;
in highp vec4 vs_TEXCOORD5;
in mediump vec4 vColor;
layout(location = 0) out vec4 outColor;
vec4 _9;
highp float _26;
highp vec3 _38;
bool _49;
float _80;
float _84;
float _90;
highp vec4 _134;
vec3 _140;
vec4 _164;
highp float _174;
vec4 _184;
highp float _232;

void main()
{
    _9.x = texture(_MainTex, vs_TEXCOORD0).w;
    _26 = _9.x + (-vs_TEXCOORD1.x);
    _38.x = (-_9.x) + vs_TEXCOORD1.z;
    _49 = _26 < 0.0;
    if ((int(_49) * (-1)) != 0)
    {
        discard;
    }
    _26 = _OutlineWidth * _ScaleRatioA;
    _26 *= vs_TEXCOORD1.y;
    _80 = min(_26, 1.0);
    _84 = _26 * 0.5;
    _80 = sqrt(_80);
    _90 = (_38.x * vs_TEXCOORD1.y) + _84;
    _90 = clamp(_90, 0.0, 1.0);
    _84 = (_38.x * vs_TEXCOORD1.y) + (-_84);
    _80 *= _90;
    highp vec2 _126 = (vec2(_OutlineUVSpeedX, _OutlineUVSpeedY) * _Time.yy) + vs_TEXCOORD5.zw;
    _38 = vec3(_126.x, _126.y, _38.z);
    _9 = texture(_OutlineTex, _38.xy);
    _134 = _9 * _OutlineColor;
    _140 = vColor.xyz * _FaceColor.xyz;
    highp vec2 _161 = (vec2(_FaceUVSpeedX, _FaceUVSpeedY) * _Time.yy) + vs_TEXCOORD5.xy;
    _38 = vec3(_161.x, _161.y, _38.z);
    _164 = texture(_FaceTex, _38.xy);
    _38 = _140 * _164.xyz;
    _174 = _164.w * _FaceColor.w;
    _140 = _38 * vec3(_174);
    highp vec3 _192 = (_134.xyz * _134.www) + (-_140);
    _184 = vec4(_192.x, _192.y, _192.z, _184.w);
    _184.w = (_OutlineColor.w * _9.w) + (-_174);
    _184 = vec4(_80) * _184;
    highp vec3 _214 = (_38 * vec3(_174)) + _184.xyz;
    _9 = vec4(_214.x, _214.y, _214.z, _9.w);
    _9.w = (_FaceColor.w * _164.w) + _184.w;
    _174 = _OutlineSoftness * _ScaleRatioA;
    _232 = _174 * vs_TEXCOORD1.y;
    _80 = (_174 * vs_TEXCOORD1.y) + 1.0;
    _84 = (_232 * 0.5) + _84;
    _80 = _84 / _80;
    _80 = clamp(_80, 0.0, 1.0);
    _80 = (-_80) + 1.0;
    _9 *= vec4(_80);
    outColor = _9 * vColor.wwww;
}
