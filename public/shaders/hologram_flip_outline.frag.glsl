precision mediump float;
precision highp int;

uniform highp vec3 cameraPosition;
uniform highp mat4 viewMatrix;
uniform int _FlipX;
uniform int _FlipY;
uniform highp float _UVScale;
uniform highp float _FlipAnim;
uniform highp float _FlipAnimOffset;
uniform highp float _FlipBlend;
uniform highp float _ReflectIntensity;
uniform highp float _ReflectEmitIntensity;
uniform vec3 _OutlineColor;
uniform float _DiffuseIntensity;
uniform float _Shininess;
uniform float _SpecularIntensity;
uniform float _DiffractionPower;
uniform float _OrientationU;
uniform float _OrientationV;
uniform float _ChangeSpeed;
uniform float _RampOffset;
uniform int _UsePositionAsUV;
uniform int _UseOutlineNormalFilter;
uniform highp float _OutlineNormalFilterThreshold;
uniform float _DiffractionIntensity2;
uniform float _DiffractionPower2;
uniform float _RampRepeat2;
uniform float _RampSpeed2;
uniform float _RampOffset2;
uniform float _RampInterval2;
uniform int _TiltEnabled;
uniform float _TiltPower;
uniform float _TiltOffset;
uniform float _TiltIntensity;
uniform vec3 _Rotation;

uniform mediump sampler2D _13;
uniform mediump sampler2D _32;
uniform mediump sampler2D _163;
uniform mediump samplerCube _499;
uniform mediump sampler2D _540;
uniform mediump sampler2D _622;
uniform mediump sampler2D _874;
uniform mediump sampler2D _1000;
uniform mediump sampler2D _1046;
uniform mediump sampler2D _1052;
uniform mediump sampler2D _1211;

in highp vec4 vs_TEXCOORD0;
in highp vec3 vs_TEXCOORD1;
in highp vec3 vs_TEXCOORD4;
in highp vec3 vs_TEXCOORD3;
in highp vec3 vs_TEXCOORD2;
layout(location = 1) out highp vec4 _1036;
layout(location = 0) out highp vec4 _1254;
vec4 _9;
vec4 _21;
highp float _31;
vec4 _40;
highp vec3 _48;
highp vec4 _64;
highp vec3 _79;
highp vec2 _117;
bool _144;
highp float _150;
highp vec4 _156;
vec3 _162;
vec3 _169;
vec3 _177;
highp float _216;
highp vec3 _231;
highp vec3 _238;
highp vec2 _251;
highp float _267;
highp vec2 _271;
highp vec4 _283;
highp vec3 _301;
highp float _366;
float _407;
highp vec3 _452;
highp vec2 _469;
vec3 _495;
float _539;
vec3 _550;
float _556;
vec3 _621;
int _644;
highp float _654;
highp vec2 _691;
highp float _707;
bool _713;
int _740;
bool _776;
highp vec2 _795;
float _880;
bool _900;
float _1051;
highp float _1165;
float _1193;
vec3 _1210;

void main()
{
    highp vec3 pcrUnityCameraPosition = vec3(cameraPosition.xy, -cameraPosition.z);
    highp vec3 pcrUnityWorldPosition = vec3(vs_TEXCOORD1.xy, -vs_TEXCOORD1.z);
    highp vec3 pcrUnityWorldNormal = vec3(vs_TEXCOORD2.xy, -vs_TEXCOORD2.z);
    highp vec3 pcrUnityWorldTangent = vec3(vs_TEXCOORD3.xy, -vs_TEXCOORD3.z);
    highp vec3 pcrUnityWorldBitangent = vec3(vs_TEXCOORD4.xy, -vs_TEXCOORD4.z);
    _9 = texture(_13, vs_TEXCOORD0.xy);
    vec3 _27 = _9.www * _9.xyz;
    _21 = vec4(_27.x, _27.y, _27.z, _21.w);
    _31 = texture(_32, vs_TEXCOORD0.xy).x;
    _40.w = max(_9.w, _31);
    _48 = (-pcrUnityWorldPosition) + pcrUnityCameraPosition;
    _64.x = dot(_48, _48);
    _64.x = inversesqrt(_64.x);
    highp vec3 _76 = _48 * _64.xxx;
    _64 = vec4(_76.x, _76.y, _76.z, _64.w);
    _79.x = -viewMatrix[0].z;
    _79.y = -viewMatrix[1].z;
    _79.z = viewMatrix[2].z;
    _48.x = dot(_79, _79);
    _48.x = inversesqrt(_48.x);
    _48 = _48.xxx * _79;
    highp vec2 _113 = vs_TEXCOORD0.zw + vec2(-0.5);
    _79 = vec3(_113.x, _113.y, _79.z);
    _117 = _79.xy / vec2(vec2(_UVScale, _UVScale));
    _117 += vec2(0.5);
    highp vec2 _139 = (_79.xy * vec2(0.800000011920928955078125)) + vec2(0.5);
    _79 = vec3(_139.x, _139.y, _79.z);
    _144 = _OutlineNormalFilterThreshold >= _31;
    _150 = float(_UseOutlineNormalFilter);
    _156.x = _144 ? 0.0 : _150;
    _162 = texture(_163, vs_TEXCOORD0.xy).xyz;
    _169 = (_162 * vec3(2.0)) + vec3(-1.0);
    _177 = (-_169) + vec3(0.0, 0.0, 1.0);
    _169 = (_156.xxx * _177) + _169;
    highp vec3 _193 = _169.yyy * pcrUnityWorldBitangent;
    _156 = vec4(_193.x, _193.y, _193.z, _156.w);
    highp vec3 _203 = (pcrUnityWorldTangent * _169.xxx) + _156.xyz;
    _156 = vec4(_203.x, _203.y, _203.z, _156.w);
    highp vec3 _213 = (pcrUnityWorldNormal * _169.zzz) + _156.xyz;
    _156 = vec4(_213.x, _213.y, _213.z, _156.w);
    _216 = dot(_156.xyz, _156.xyz);
    _216 = inversesqrt(_216);
    highp vec3 _228 = vec3(_216) * _156.xyz;
    _156 = vec4(_228.x, _228.y, _228.z, _156.w);
    _231 = _Rotation * vec3(-0.01745329238474369049072265625);
    _238.x = cos(_231.x);
    _231.x = sin(_231.x);
    _238.y = -_231.x;
    _251.y = dot(_238.xy, _156.yz);
    _238.z = _231.x;
    _156.w = dot(_238.zx, _156.yz);
    _267 = sin(_231.y);
    _271.x = cos(_231.y);
    _271.y = _267;
    _251.x = dot(_271, _156.xw);
    highp vec2 _286 = -vec2(_267);
    _283 = vec4(_286.x, _283.y, _286.y, _283.w);
    _283.y = _271.x;
    _156.z = dot(_283.xy, _156.xw);
    _267 = sin(_231.z);
    _301.x = cos(_231.z);
    _301.y = -_267;
    _156.x = dot(_301.xy, _251);
    _301.z = _267;
    _156.y = dot(_301.zx, _251);
    _238.y = -_231.x;
    _231.y = dot(_238.xy, _64.yz);
    _64.w = dot(_238.zx, _64.yz);
    _231.x = dot(_271, _64.xw);
    _283.w = _283.y;
    _64.z = dot(_283.zw, _64.xw);
    _301.y = -_267;
    _64.x = dot(_301.xy, _231.xy);
    _64.y = dot(_301.zx, _231.xy);
    _366 = dot(pcrUnityWorldNormal, pcrUnityWorldNormal);
    _366 = inversesqrt(_366);
    _231 = vec3(_366) * pcrUnityWorldNormal;
    _366 = dot(_231, -_48);
    _366 += (-_TiltOffset);
    _366 = clamp(_366, 0.0, 1.0);
    _366 = log2(_366);
    _366 *= _TiltPower;
    _366 = exp2(_366);
    _366 = (-_366) + 1.0;
    _366 *= _TiltIntensity;
    _366 = clamp(_366, 0.0, 1.0);
    highp float _413;
    if (_TiltEnabled != 0)
    {
        _413 = _366;
    }
    else
    {
        _413 = _SpecularIntensity;
    }
    _407 = _413;
    _177 = ((-_9.xyz) * _9.www) + _OutlineColor;
    vec3 _438 = (vec3(_31) * _177) + _21.xyz;
    _21 = vec4(_438.x, _438.y, _438.z, _21.w);
    _177.x = _DiffuseIntensity + (-1.0);
    _177.x = (_31 * _177.x) + 1.0;
    highp vec2 _458;
    if (_UsePositionAsUV != 0)
    {
        _458 = _79.xy;
    }
    else
    {
        _458 = vs_TEXCOORD0.xy;
    }
    _452 = vec3(_458.x, _458.y, _452.z);
    _469.x = dot(-_64.xyz, _156.xyz);
    _469.x += _469.x;
    highp vec3 _492 = (_156.zxy * (-_469.xxx)) + (-_64.zxy);
    _64 = vec4(_492.x, _492.y, _492.z, _64.w);
    _495 = texture(_499, _64.yzx).xyz;
    _64.x = -_64.x;
    _64.x = clamp(_64.x, 0.0, 1.0);
    _469.x = log2(_64.x);
    _469.x *= _Shininess;
    _469.x = exp2(_469.x);
    _407 = _469.x * _407;
    _177 = (vec3(_407) * _495) + _177.xxx;
    _539 = texture(_540, vs_TEXCOORD0.xy).x;
    _407 = (_539 * 0.5) + 0.25;
    _550 = (_156.xyz * vec3(0.5)) + vec3(0.5);
    _556 = dot(_550.xy, vec2(0.5));
    _407 = (-_407) + _556;
    _407 = min(abs(_407), 1.0);
    _407 = (-_407) + 1.0;
    _407 = log2(_407);
    _407 *= _DiffractionPower;
    _407 = exp2(_407);
    _407 *= _31;
    _556 = dot(_550, vec3(vec3(_ChangeSpeed, _ChangeSpeed, _ChangeSpeed)));
    _452.x = dot(_452.xy, vec2(_OrientationU, _OrientationV));
    _452.x += _556;
    _452.x += _RampOffset;
    _452.y = 0.5;
    _469.y = 0.5;
    _621 = texture(_622, _452.xy).xyz;
    vec3 _631 = vec3(_407) * _621;
    _64 = vec4(_631.x, _631.y, _631.z, _64.w);
    highp vec3 _640 = (_177 * _21.xyz) + _64.xyz;
    _21 = vec4(_640.x, _640.y, _640.z, _21.w);
    _644 = _FlipY * _FlipX;
    _452.x = float(_644);
    _654 = _452.x * _FlipAnimOffset;
    _654 = fract(_654);
    _654 = (_FlipAnimOffset * _452.x) + (-_654);
    _452.x = (_FlipAnim * _452.x) + _654;
    _64.x = fract(_452.x);
    _452.x += (-_64.x);
    _691.x = _452.x + 1.0;
    highp vec3 _704 = vec3(ivec3(_FlipX, _FlipX, _FlipY));
    _156 = vec4(_704.x, _704.y, _704.z, _156.w);
    _707 = _452.x * _156.x;
    _713 = _707 >= (-_707);
    highp float _719;
    if (_713)
    {
        _719 = _156.x;
    }
    else
    {
        _719 = -_156.x;
    }
    _707 = _719;
    _216 = 1.0 / _707;
    _216 = _452.x * _216;
    _216 = fract(_216);
    _707 *= _216;
    _740 = _FlipY + (-1);
    _216 = float(_740);
    _452.x /= _156.x;
    _231.x = fract(_452.x);
    _452.x += (-_231.x);
    _452.x = (-_452.x) + _216;
    _231.x = _691.x * _156.x;
    _776 = _231.x >= (-_231.x);
    highp float _784;
    if (_776)
    {
        _784 = _156.x;
    }
    else
    {
        _784 = -_156.x;
    }
    _231.x = _784;
    _795.x = 1.0 / _231.x;
    _795.x = _691.x * _795.x;
    _795.x = fract(_795.x);
    _231.x = _795.x * _231.x;
    _691.x /= _156.x;
    _795.x = fract(_691.x);
    _691.x += (-_795.x);
    _691.x = (-_691.x) + _216;
    _117 /= _156.yz;
    _238.x = _707 / _156.x;
    _238.y = _452.x / _156.z;
    _795 = _117 + _238.xy;
    _238.x = _231.x / _156.x;
    _238.y = _691.x / _156.z;
    _691 = _117 + _238.xy;
    _9.x = texture(_874, _795).x;
    _880 = texture(_874, _691).x;
    _691.x = (-_9.x) + _880;
    _469.x = (_64.x * _691.x) + _9.x;
    _900 = _FlipBlend >= 0.0;
    if (_900)
    {
        _452.x = _654 * _156.x;
        _900 = _452.x >= (-_452.x);
        highp float _920;
        if (_900)
        {
            _920 = _156.x;
        }
        else
        {
            _920 = -_156.x;
        }
        _452.x = _920;
        _64.x = 1.0 / _452.x;
        _64.x = _654 * _64.x;
        _64.x = fract(_64.x);
        _452.x *= _64.x;
        _654 /= _156.x;
        _64.x = fract(_654);
        _654 += (-_64.x);
        _452.y = (-_654) + _216;
        highp vec2 _971 = _452.xy / _156.xz;
        _64 = vec4(_971.x, _971.y, _64.z, _64.w);
        highp vec2 _977 = _64.xy + _117;
        _452 = vec3(_977.x, _977.y, _452.z);
        _9.x = texture(_874, _452.xy).x;
        _654 = (-_9.x) + _469.x;
        _469.x = (_FlipBlend * _654) + _9.x;
    }
    vec3 _1004 = texture(_1000, _469).xyz;
    _9 = vec4(_1004.x, _1004.y, _1004.z, _9.w);
    _452 = _9.xyz * vec3(vec3(_ReflectIntensity, _ReflectIntensity, _ReflectIntensity));
    highp vec3 _1025 = vec3(_31) * _452;
    _64 = vec4(_1025.x, _1025.y, _1025.z, _64.w);
    _452 = (_452 * vec3(_31)) + _21.xyz;
    highp vec3 _1043 = _64.xyz * vec3(_ReflectEmitIntensity);
    _1036 = vec4(_1043.x, _1043.y, _1043.z, _1036.w);
    _21 = texture(_1046, _79.xy);
    _1051 = texture(_1052, _79.xy).x;
    highp vec3 _1060 = (pcrUnityWorldNormal * vec3(0.5)) + vec3(0.5);
    _64 = vec4(_1060.x, _1060.y, _1060.z, _64.w);
    _177 = (_48 * vec3(0.5)) + vec3(0.5);
    _556 = (-_21.y) + 2.0;
    _550.x = _21.x * 0.25;
    _550.y = _556 * 0.25;
    vec2 _1080 = _550.xy + vec2(0.25);
    _550 = vec3(_1080.x, _1080.y, _550.z);
    _48.x = dot(_64.xy, _177.xy);
    highp vec2 _1094 = (-_550.xy) + _48.xx;
    _48 = vec3(_1094.x, _1094.y, _48.z);
    highp vec2 _1101 = min(abs(_48.xy), vec2(1.0));
    _48 = vec3(_1101.x, _1101.y, _48.z);
    highp vec2 _1107 = (-_48.xy) + vec2(1.0);
    _48 = vec3(_1107.x, _1107.y, _48.z);
    highp vec2 _1112 = log2(_48.xy);
    _48 = vec3(_1112.x, _1112.y, _48.z);
    highp vec2 _1126 = _48.xy * vec2(vec2(_DiffractionPower2, _DiffractionPower2));
    _48 = vec3(_1126.x, _1126.y, _48.z);
    highp vec2 _1131 = exp2(_48.xy);
    _48 = vec3(_1131.x, _1131.y, _48.z);
    highp vec2 _1138 = _21.zw * _48.xy;
    _48 = vec3(_1138.x, _1138.y, _48.z);
    _556 = _48.y + _48.x;
    _48 = _64.xyz * vec3(vec3(_RampSpeed2, _RampSpeed2, _RampSpeed2));
    _48.x = dot(_48, _177);
    _1165 = (-_1051) + _48.x;
    _1165 = (_1165 * _RampRepeat2) + _RampOffset2;
    _48.x = floor(_1165);
    _1165 += (-_48.x);
    _177.x = _RampInterval2 + 1.0;
    _1193 = _RampInterval2 * 0.5;
    _64.x = (_1165 * _177.x) + (-_1193);
    _64.x = clamp(_64.x, 0.0, 1.0);
    _64.y = 0.5;
    _1210 = texture(_1211, _64.xy).xyz;
    _177 = _1210 * vec3(_DiffractionIntensity2);
    _177 = vec3(_556) * _177;
    int _1228 = _TiltEnabled;
    mediump int mp_copy_1228 = _1228;
    _556 = float(mp_copy_1228);
    _550.x = _366 + (-1.0);
    _556 = (_556 * _550.x) + 1.0;
    _177 = vec3(_556) * _177;
    _177 = (vec3(_31) * (-_177)) + _177;
    highp vec3 _1251 = _452 + _177;
    _40 = vec4(_1251.x, _1251.y, _1251.z, _40.w);
    _1254 = _40;
    _1036.w = 1.0;
}
