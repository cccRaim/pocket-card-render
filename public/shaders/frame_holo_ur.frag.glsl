precision mediump float;
precision highp int;

uniform highp vec3 cameraPosition;
uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform float _Shininess;
uniform float _BaseColorIntensity;
uniform float _SpecularIntensity;
uniform float _DiffractionIntensity;
uniform float _DiffractionPower;
uniform float _RampRepeat;
uniform float _RampSpeed;
uniform float _RampOffset;
uniform float _RampInterval;
uniform int _UseSimpleRampMaskAndRotation;
uniform float _RemoveMetalic;
uniform int _FakeSpecularEnabled;
uniform vec3 _FakeSpecularColor;
uniform int _DarknessEnabled;
uniform vec3 _DarknessColor;
uniform float _DarknessOffset;
uniform int _EmissivePattern;
uniform vec4 _EmissiveColor;
uniform vec3 _Rotation;
uniform int uBloomOnly;

uniform mediump sampler2D _13;
uniform mediump sampler2D _302;
uniform mediump samplerCube _333;
uniform mediump sampler2D _388;
uniform mediump sampler2D _396;
uniform mediump sampler2D _410;
uniform mediump sampler2D _570;
uniform mediump sampler2D _721;

in highp vec2 vs_TEXCOORD0;
in highp vec3 vs_TEXCOORD3;
in highp vec3 vs_TEXCOORD2;
in highp float vs_TEXCOORD5;
in highp vec4 vs_TEXCOORD4;
layout(location = 1) out highp vec4 _1053;
layout(location = 0) out highp vec4 _1059;
vec4 _9;
highp vec4 _20;
highp vec4 _41;
highp float _59;
highp vec4 _74;
highp float _92;
highp vec3 _108;
highp vec3 _115;
highp vec4 _128;
highp vec4 _145;
highp vec2 _151;
highp float _178;
highp vec3 _182;
highp vec4 _239;
vec2 _301;
highp float _307;
vec3 _329;
vec3 _359;
vec4 _387;
vec2 _395;
highp vec2 _407;
float _409;
vec3 _423;
float _428;
vec2 _436;
highp float _527;
highp float _542;
vec3 _569;
vec3 _575;
vec4 _640;
highp vec3 _781;
float _814;
float _821;
highp float _863;
bool _869;
bool _891;
bool _921;
bool _1003;

highp vec3 pcrUnityObjectToWorldAxisZ(highp mat4 threeModelMatrix)
{
    return vec3(threeModelMatrix[2].x, threeModelMatrix[2].y, -threeModelMatrix[2].z);
}

void main()
{
    _9 = texture(_13, vs_TEXCOORD0);
    _20.x = dot(vs_TEXCOORD3, vs_TEXCOORD3);
    _20.x = inversesqrt(_20.x);
    highp vec3 _38 = _20.xxx * vs_TEXCOORD3;
    _20 = vec4(_38.x, _38.y, _38.z, _20.w);
    highp vec3 _56 = (-vs_TEXCOORD2) + cameraPosition;
    _41 = vec4(_56.x, _56.y, _56.z, _41.w);
    _59 = dot(_41.xyz, _41.xyz);
    _59 = inversesqrt(_59);
    highp vec3 _71 = vec3(_59) * _41.xyz;
    _41 = vec4(_71.x, _71.y, _71.z, _41.w);
    _74.x = -viewMatrix[0].z;
    _74.y = -viewMatrix[1].z;
    _74.z = -viewMatrix[2].z;
    _92 = dot(_74.xyz, _74.xyz);
    _92 = inversesqrt(_92);
    highp vec3 _104 = vec3(_92) * _74.xyz;
    _74 = vec4(_104.x, _104.y, _104.z, _74.w);
    _108 = _Rotation * vec3(-0.01745329238474369049072265625);
    _115.x = cos(_108.x);
    _108.x = sin(_108.x);
    _115.y = -_108.x;
    _128.y = dot(_115.xy, _20.yz);
    _115.z = _108.x;
    _20.w = dot(_115.zx, _20.yz);
    _145.x = sin(_108.y);
    _151.x = cos(_108.y);
    _151.y = _145.x;
    _128.x = dot(_151, _20.xw);
    highp vec2 _166 = -_145.xx;
    _145 = vec4(_166.x, _145.y, _145.z, _166.y);
    _145.z = _151.x;
    _20.z = dot(_145.xz, _20.xw);
    _178 = sin(_108.z);
    _182.x = cos(_108.z);
    _182.y = -_178;
    _20.x = dot(_182.xy, _128.xy);
    _182.z = _178;
    _20.y = dot(_182.zx, _128.xy);
    _128.x = _115.x;
    highp vec2 _209 = -_108.xx;
    _128 = vec4(_128.x, _209.x, _128.z, _209.y);
    _108.y = dot(_128.xy, _41.yz);
    _41.w = dot(_115.zx, _41.yz);
    _108.x = dot(_151, _41.xw);
    _145 = vec4(_145.xz.x, _145.xz.y, _145.z, _145.w);
    _41.z = dot(_145.wy, _41.xw);
    _239.x = _182.x;
    highp vec2 _245 = -vec2(_178);
    _239 = vec4(_239.x, _245.x, _239.z, _245.y);
    _41.x = dot(_239.xy, _108.xy);
    _41.y = dot(_182.zx, _108.xy);
    _128.z = _128.x;
    _108.y = dot(_128.zw, _74.yz);
    _74.w = dot(_115.zx, _74.yz);
    _108.x = dot(_151, _74.xw);
    _74.z = dot(_145.xy, _74.xw);
    _239.z = _239.x;
    _74.x = dot(_239.zw, _108.xy);
    _74.y = dot(_182.zx, _108.xy);
    _301 = texture(_302, vs_TEXCOORD0).xy;
    _307 = dot(-_41.xyz, _20.xyz);
    _307 += _307;
    highp vec3 _326 = (_20.zxy * (-vec3(_307))) + (-_41.zxy);
    _41 = vec4(_326.x, _326.y, _326.z, _41.w);
    _329 = texture(_333, _41.yzx).xyz;
    _41.x = -_41.x;
    _41.x = clamp(_41.x, 0.0, 1.0);
    _307 = log2(_41.x);
    _307 *= _Shininess;
    _307 = exp2(_307);
    _359.x = _307 * _SpecularIntensity;
    _359 = (_359.xxx * _329) + vec3(vec3(_BaseColorIntensity, _BaseColorIntensity, _BaseColorIntensity));
    _359 = _9.xyz * _359;
    vec2 _392 = texture(_388, vs_TEXCOORD0).xy;
    _387 = vec4(_392.x, _392.y, _387.z, _387.w);
    _395 = texture(_396, vs_TEXCOORD0).xy;
    _115.x = vs_TEXCOORD5;
    _115.y = 0.5;
    _407.y = 0.5;
    _409 = texture(_410, _115.xy).x;
    highp vec3 _420 = (_20.xyz * vec3(0.5)) + vec3(0.5);
    _20 = vec4(_420.x, _420.y, _420.z, _20.w);
    _423 = (_74.xyz * vec3(0.5)) + vec3(0.5);
    _428 = (-_387.y) + 1.0;
    _428 = (_428 * 0.5) + 0.5;
    _436.x = _387.x * 0.25;
    _436.y = _428 * 0.5;
    _436 += vec2(0.25);
    _41.x = dot(_20.xy, _423.xy);
    highp vec2 _458 = (-_436) + _41.xx;
    _41 = vec4(_458.x, _458.y, _41.z, _41.w);
    highp vec2 _465 = min(abs(_41.xy), vec2(1.0));
    _41 = vec4(_465.x, _465.y, _41.z, _41.w);
    highp vec2 _471 = (-_41.xy) + vec2(1.0);
    _41 = vec4(_471.x, _471.y, _41.z, _41.w);
    highp vec2 _476 = log2(_41.xy);
    _41 = vec4(_476.x, _476.y, _41.z, _41.w);
    highp vec2 _485 = _41.xy * vec2(_DiffractionPower);
    _41 = vec4(_485.x, _485.y, _41.z, _41.w);
    highp vec2 _490 = exp2(_41.xy);
    _41 = vec4(_490.x, _490.y, _41.z, _41.w);
    highp vec2 _496 = _395 * _41.xy;
    _41 = vec4(_496.x, _496.y, _41.z, _41.w);
    _387.w = _41.y + _41.x;
    highp vec3 _519 = _20.xyz * vec3(vec3(_RampSpeed, _RampSpeed, _RampSpeed));
    _20 = vec4(_519.x, _519.y, _519.z, _20.w);
    _20.x = dot(_20.xyz, _423);
    _527 = (-_409) + _20.x;
    _527 = (_527 * _RampRepeat) + _RampOffset;
    _542 = floor(_527);
    _527 = (-_542) + _527;
    _428 = _RampInterval + 1.0;
    _423.x = _RampInterval * 0.5;
    _407.x = (_527 * _428) + (-_423.x);
    _407.x = clamp(_407.x, 0.0, 1.0);
    _569 = texture(_570, _407).xyz;
    _575 = _569 * vec3(vec3(_DiffractionIntensity, _DiffractionIntensity, _DiffractionIntensity));
    vec3 _593 = _387.www * _575;
    _387 = vec4(_593.x, _593.y, _593.z, _387.w);
    _569.x = texture(_410, vs_TEXCOORD0).x;
    _20.x = (-_569.x) + _20.x;
    _20.x = (_20.x * _RampRepeat) + _RampOffset;
    _527 = floor(_20.x);
    _20.x = (-_527) + _20.x;
    _20.x = (_20.x * _428) + (-_423.x);
    _20.x = clamp(_20.x, 0.0, 1.0);
    _20.y = 0.5;
    vec3 _645 = texture(_570, _20.xy).xyz;
    _640 = vec4(_645.x, _645.y, _645.z, _640.w);
    _423 = _640.xyz * vec3(vec3(_DiffractionIntensity, _DiffractionIntensity, _DiffractionIntensity));
    vec3 _665 = _387.www * _423;
    _640 = vec4(_665.x, _665.y, _665.z, _640.w);
    _640.w = _387.w;
    bvec4 _680 = bvec4(_UseSimpleRampMaskAndRotation != 0);
    _640 = vec4(_680.x ? _387.x : _640.x, _680.y ? _387.y : _640.y, _680.z ? _387.z : _640.z, _680.w ? _387.w : _640.w);
    _428 = _640.w * _DiffractionIntensity;
    _428 *= _RemoveMetalic;
    _359 = (vec3(_428) * (-_359)) + _359;
    _359 = _640.xyz + _359;
    _359 = (-_9.xyz) + _359;
    _359 = (_301.xxx * _359) + _9.xyz;
    if (_FakeSpecularEnabled != 0)
    {
        _9.x = texture(_721, vs_TEXCOORD4.xy).x;
        _428 = _9.x * vs_TEXCOORD4.z;
        _428 = log2(_428);
        _428 *= vs_TEXCOORD4.w;
        _428 = exp2(_428);
        vec3 _753 = vec3(_428) * vec3(_FakeSpecularColor.x, _FakeSpecularColor.y, _FakeSpecularColor.z);
        _640 = vec4(_753.x, _753.y, _753.z, _640.w);
        _423.x = dot(_640.xyz, vec3(0.298911988735198974609375, 0.586610972881317138671875, 0.114477999508380889892578125));
        _423.x += (-_DarknessOffset);
        _423.x = clamp(_423.x, 0.0, 1.0);
        _423.x = (-_423.x) + 1.0;
        _781.x = dot(-pcrUnityObjectToWorldAxisZ(modelMatrix), -pcrUnityObjectToWorldAxisZ(modelMatrix));
        _781.x = inversesqrt(_781.x);
        _781 = _781.xxx * (-pcrUnityObjectToWorldAxisZ(modelMatrix));
        _575.x = dot(_781.xy, _781.xy);
        _575.x = sqrt(_575.x);
        _814 = min(abs(_781.z), _575.x);
        _821 = max(abs(_781.z), _575.x);
        _821 = 1.0 / _821;
        _814 = _821 * _814;
        _821 = _814 * _814;
        _781.x = (_821 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
        _781.x = (_821 * _781.x) + 0.1801410019397735595703125;
        _781.x = (_821 * _781.x) + (-0.33029949665069580078125);
        _781.x = (_821 * _781.x) + 0.999866008758544921875;
        _863 = _781.x * _814;
        _869 = abs(_781.z) < _575.x;
        _863 = (_863 * (-2.0)) + 1.57079637050628662109375;
        _863 = _869 ? _863 : 0.0;
        _781.x = (_814 * _781.x) + _863;
        _891 = _781.z < (-_781.z);
        _863 = _891 ? (-3.1415927410125732421875) : 0.0;
        _781.x = _863 + _781.x;
        _814 = min(_781.z, _575.x);
        _575.x = max(_781.z, _575.x);
        _891 = _814 < (-_814);
        _921 = _575.x >= (-_575.x);
        _891 = _921 && _891;
        highp float _933;
        if (_891)
        {
            _933 = -_781.x;
        }
        else
        {
            _933 = _781.x;
        }
        _781.x = _933;
        _781.x *= 3.0;
        _575.x = sin(_781.x);
        _575.x *= _575.x;
        _423.x = _575.x * _423.x;
        _575 = (_359 * _DarknessColor) + (-_359);
        _423 = (_423.xxx * _575) + _359;
        vec3 _984;
        if (_DarknessEnabled != 0)
        {
            _984 = _423;
        }
        else
        {
            _984 = _359;
        }
        _423 = _984;
        _359 = (vec3(_FakeSpecularColor.x, _FakeSpecularColor.y, _FakeSpecularColor.z) * vec3(_428)) + _423;
        _1003 = _EmissivePattern == 1;
        _640.w = 1.0;
        _640 = _9.wwww * _640;
        _640 *= _EmissiveColor;
        _640 = _301.yyyy * _640;
        bvec4 _1025 = bvec4(_1003);
        _20 = vec4(_1025.x ? _640.x : vec4(0.0).x, _1025.y ? _640.y : vec4(0.0).y, _1025.z ? _640.z : vec4(0.0).z, _1025.w ? _640.w : vec4(0.0).w);
    }
    else
    {
        _20.x = 0.0;
        _20.y = 0.0;
        _20.z = 0.0;
        _20.w = 0.0;
    }
    _1003 = _EmissivePattern == 2;
    vec3 _1039 = _359 * _EmissiveColor.xyz;
    _387 = vec4(_1039.x, _1039.y, _1039.z, _387.w);
    _387.w = _9.w * _EmissiveColor.w;
    _387 = _301.yyyy * _387;
    bvec4 _1057 = bvec4(_1003);
    _1053 = vec4(_1057.x ? _387.x : _20.x, _1057.y ? _387.y : _20.y, _1057.z ? _387.z : _20.z, _1057.w ? _387.w : _20.w);
    _1059 = vec4(_359.x, _359.y, _359.z, _1059.w);
    _1059.w = _9.w;
    if (uBloomOnly != 0)
    {
        _1059 = _1053;
    }
}
