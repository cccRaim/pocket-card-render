precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform mediump float _RampMaskRotation;
uniform mediump float _RampMaskScale;
uniform int _UseSimpleRampMaskAndRotation;
uniform mediump float _RampMaskRotation2;
uniform mediump float _RampMaskScale2;
uniform int _UseSimpleRampMaskAndRotation2;
uniform mediump float _FakeSpecularMaskScale;
uniform mediump float _FakeSpecularIntensity;
uniform mediump float _FakeSpecularPower;
uniform mediump float _FakeSpecularCornerPower;
uniform mediump float _FakeSpecularNotCornerOffset;
uniform mediump float _FakeSpecularMaskScale2;
uniform mediump float _FakeSpecularIntensity2;
uniform mediump float _FakeSpecularPower2;
uniform mediump float _FakeSpecularCornerPower2;
uniform mediump float _FakeSpecularNotCornerOffset2;

in vec3 position;
in vec2 uv;
out vec4 vs_TEXCOORD4;
out vec4 vs_TEXCOORD5;
out vec3 vs_TEXCOORD2;
in vec3 normal;
out vec3 vs_TEXCOORD3;
out float vs_TEXCOORD6;
out float vs_TEXCOORD7;
out vec2 vs_TEXCOORD0;
vec4 _9;
vec4 _44;
vec4 _50;
float _78;
float _108;
vec2 _116;
vec2 _136;
bool _175;
bvec3 _208;
bool _234;
bool _241;
mediump vec4 _262;
mediump float _267;
vec2 _361;
bool _394;
bvec3 _425;
bvec3 _494;
mediump vec2 _596;
mediump float _650;
mediump float _652;
mediump float _674;
vec2 _686;
vec2 _705;
float _714;
vec3 _735;
bool _762;
vec3 _775;
bool _793;
float _800;
float _813;
bool _823;
mediump vec2 _843;
mediump float _848;
mediump vec3 _852;
vec3 _867;
vec2 _883;
bool _897;
bool _929;
bvec3 _952;
bvec3 _958;
mediump float _1062;
mediump float _1065;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _1124 = normal;
    vec2 _858 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9 = _11.yyyy * _ObjectToWorld[1];
    _9 = (_ObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (_ObjectToWorld[2] * _11.zzzz) + _9;
    _44 = _9 + _ObjectToWorld[3];
    _50 = _44.yyyy * _ViewProjection[1];
    _50 = (_ViewProjection[0] * _44.xxxx) + _50;
    _50 = (_ViewProjection[2] * _44.zzzz) + _50;
    _44 = (_ViewProjection[3] * _44.wwww) + _50;
    _78 = dot(-_ObjectToWorld[2].xyz, -_ObjectToWorld[2].xyz);
    _78 = inversesqrt(_78);
    vec3 _97 = vec3(_78) * (-_ObjectToWorld[2].zxy);
    _50 = vec4(_97.x, _97.y, _97.z, _50.w);
    _78 = dot(_50.yz, _50.yz);
    _78 = sqrt(_78);
    _108 = min(abs(_50.x), _78);
    _116.x = max(abs(_50.x), _78);
    _116.x = 1.0 / _116.x;
    _108 *= _116.x;
    _116.x = _108 * _108;
    _136.x = (_116.x * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _136.x = (_116.x * _136.x) + 0.1801410019397735595703125;
    _136.x = (_116.x * _136.x) + (-0.33029949665069580078125);
    _116.x = (_116.x * _136.x) + 0.999866008758544921875;
    _136.x = _108 * _116.x;
    _175 = abs(_50.x) < _78;
    _136.x = (_136.x * (-2.0)) + 1.57079637050628662109375;
    float _190;
    if (_175)
    {
        _190 = _136.x;
    }
    else
    {
        _190 = 0.0;
    }
    _136.x = _190;
    _108 = (_108 * _116.x) + _136.x;
    _208.x = _50.x < (-_50.x);
    _116.x = _208.x ? (-3.1415927410125732421875) : 0.0;
    _108 += _116.x;
    _116.x = min(_50.x, _78);
    _78 = max(_50.x, _78);
    _234 = _116.x < (-_116.x);
    _241 = _78 >= (-_78);
    _241 = _241 && _234;
    float _250;
    if (_241)
    {
        _250 = -_108;
    }
    else
    {
        _250 = _108;
    }
    _78 = _250;
    _50.x = _78 * 3.0;
    _262.x = sin(_50.x);
    _267 = (_78 * 2.0) + 1.69645965099334716796875;
    _262.y = sin(_267);
    mediump vec2 _281 = _262.xy * _262.xy;
    _262 = vec4(_281.x, _281.y, _262.z, _262.w);
    _267 = _262.y * _262.y;
    _267 *= _267;
    _267 *= 3.0;
    _241 = _262.x != 0.0;
    _234 = _FakeSpecularCornerPower != 0.0;
    _234 = _241 && _234;
    if (_234)
    {
        _50.x = dot(-_50.yz, -_50.yz);
        _50.x = inversesqrt(_50.x);
        vec2 _325 = _50.xx * (-_50.yz);
        _50 = vec4(_325.x, _50.y, _50.z, _325.y);
        _116.x = min(abs(_50.x), abs(_50.w));
        _136.x = max(abs(_50.x), abs(_50.w));
        _136.x = 1.0 / _136.x;
        _116.x = _136.x * _116.x;
        _136.x = _116.x * _116.x;
        _361.x = (_136.x * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
        _361.x = (_136.x * _361.x) + 0.1801410019397735595703125;
        _361.x = (_136.x * _361.x) + (-0.33029949665069580078125);
        _136.x = (_136.x * _361.x) + 0.999866008758544921875;
        _361.x = _136.x * _116.x;
        _394 = abs(_50.x) < abs(_50.w);
        _361.x = (_361.x * (-2.0)) + 1.57079637050628662109375;
        float _408;
        if (_394)
        {
            _408 = _361.x;
        }
        else
        {
            _408 = 0.0;
        }
        _361.x = _408;
        _116.x = (_116.x * _136.x) + _361.x;
        _425.x = _50.x < (-_50.x);
        _136.x = _425.x ? (-3.1415927410125732421875) : 0.0;
        _116.x = _136.x + _116.x;
        _136.x = min(_50.x, _50.w);
        _361.x = max(_50.x, _50.w);
        _425.x = _136.x < (-_136.x);
        _175 = _361.x >= (-_361.x);
        _425.x = _175 && _425.x;
        float _475;
        if (_425.x)
        {
            _475 = -_116.x;
        }
        else
        {
            _475 = _116.x;
        }
        _116.x = _475;
        _425 = greaterThanEqual(_116.xxxx, vec4(0.0, 1.57079601287841796875, -3.1415920257568359375, -3.1415920257568359375)).xyz;
        _494 = lessThan(_116.xxxx, vec4(1.57079601287841796875, 3.1415920257568359375, -1.57079601287841796875, 0.0)).xyz;
        _208.x = _425.x && _494.x;
        _208.y = _425.y && _494.y;
        _208.z = _425.z && _494.z;
        bvec2 _529 = bvec2(_208.z);
        _361 = vec2(_529.x ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).x : vec2(0.314999997615814208984375, -0.439999997615814208984375).x, _529.y ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).y : vec2(0.314999997615814208984375, -0.439999997615814208984375).y);
        vec2 _534;
        if (_208.y)
        {
            _534 = vec2(-0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _534 = _361;
        }
        _136 = _534;
        vec2 _544;
        if (_208.x)
        {
            _544 = vec2(0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _544 = _136;
        }
        _116 = _544;
        _361.x = dot(_116, _116);
        _361.x = inversesqrt(_361.x);
        _116 = _361.xx * _116;
        _50.x = dot(_50.xw, _116);
        _50.x += (-0.582111895084381103515625);
        _50.x = clamp(_50.x, 0.0, 1.0);
        _50.x *= 2.3929851055145263671875;
        _50.x = log2(_50.x);
        _50.x *= _FakeSpecularCornerPower;
        _50.x = exp2(_50.x);
        _596.x = (-_FakeSpecularNotCornerOffset) + 1.0;
        _50.x = (_50.x * _596.x) + _FakeSpecularNotCornerOffset;
        _108 = _50.x * _FakeSpecularIntensity;
        _116.x = (_50.x * 2.094394683837890625) + 1.69645965099334716796875;
        _116.x = sin(_116.x);
        _116.x *= _116.x;
        _116.x *= _116.x;
        _116.x *= _116.x;
        _116.x *= 3.0;
        _650 = _108;
        _652 = _116.x;
    }
    else
    {
        _650 = _FakeSpecularIntensity;
        _652 = 0.0;
    }
    _596.x = max(_652, _267);
    _596.x += _FakeSpecularMaskScale;
    _596.y = _262.x * _650;
    _674 = (_262.x * 0.25) + _FakeSpecularPower;
    _674 += (-0.25);
    _686.x = dot(-_50.yz, -_50.yz);
    _686.x = inversesqrt(_686.x);
    _686 = (-_50.yz) * _686.xx;
    _705.x = min(abs(_686.y), abs(_686.x));
    _714 = max(abs(_686.y), abs(_686.x));
    _714 = 1.0 / _714;
    _705.x = _714 * _705.x;
    _714 = _705.x * _705.x;
    _735.x = (_714 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _735.x = (_714 * _735.x) + 0.1801410019397735595703125;
    _735.x = (_714 * _735.x) + (-0.33029949665069580078125);
    _714 = (_714 * _735.x) + 0.999866008758544921875;
    _735.x = _714 * _705.x;
    _762 = abs(_686.y) < abs(_686.x);
    _735.x = (_735.x * (-2.0)) + 1.57079637050628662109375;
    float _777;
    if (_762)
    {
        _777 = _735.x;
    }
    else
    {
        _777 = 0.0;
    }
    _775.x = _777;
    _775.x = (_705.x * _714) + _775.x;
    _793 = _686.y < (-_686.y);
    _800 = _793 ? (-3.1415927410125732421875) : 0.0;
    _775.x = _800 + _775.x;
    _800 = min(_686.y, _686.x);
    _813 = max(_686.y, _686.x);
    _793 = _800 < (-_800);
    _823 = _813 >= (-_813);
    _793 = _823 && _793;
    float _832;
    if (_793)
    {
        _832 = -_775.x;
    }
    else
    {
        _832 = _775.x;
    }
    _775.x = _832;
    _843.x = sin(_775.x);
    _848 = cos(_775.x);
    _852.x = -_843.x;
    vec2 _862 = _858 + vec2(-0.5);
    _775 = vec3(_862.x, _775.y, _862.y);
    _852.y = _848;
    _867.x = dot(_852.yx, _775.xz);
    _852.z = _843.x;
    _867.y = dot(_852.zy, _775.xz);
    _883 = _867.xy / _596.xx;
    vec2 _894 = _883 + vec2(0.5);
    vs_TEXCOORD4 = vec4(_894.x, _894.y, vs_TEXCOORD4.z, vs_TEXCOORD4.w);
    _897 = _FakeSpecularCornerPower2 != 0.0;
    _241 = _241 && _897;
    if (_241)
    {
        _241 = abs(_686.x) < abs(_686.y);
        float _916;
        if (_241)
        {
            _916 = _735.x;
        }
        else
        {
            _916 = 0.0;
        }
        _78 = _916;
        _78 = (_705.x * _714) + _78;
        _929 = _686.x < (-_686.x);
        _705.x = _929 ? (-3.1415927410125732421875) : 0.0;
        _78 += _705.x;
        float _944;
        if (_793)
        {
            _944 = -_78;
        }
        else
        {
            _944 = _78;
        }
        _78 = _944;
        _952 = greaterThanEqual(vec4(_78), vec4(0.0, 1.57079601287841796875, -3.1415920257568359375, 0.0)).xyz;
        _958 = lessThan(vec4(_78), vec4(1.57079601287841796875, 3.1415920257568359375, -1.57079601287841796875, 0.0)).xyz;
        _952.x = _952.x && _958.x;
        _952.y = _952.y && _958.y;
        _952.z = _952.z && _958.z;
        bvec2 _983 = bvec2(_952.z);
        _705 = vec2(_983.x ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).x : vec2(0.314999997615814208984375, -0.439999997615814208984375).x, _983.y ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).y : vec2(0.314999997615814208984375, -0.439999997615814208984375).y);
        vec2 _987;
        if (_952.y)
        {
            _987 = vec2(-0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _987 = _705;
        }
        _705 = _987;
        vec2 _995;
        if (_952.x)
        {
            _995 = vec2(0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _995 = _705;
        }
        _705 = _995;
        _78 = dot(_705, _705);
        _78 = inversesqrt(_78);
        _705 = vec2(_78) * _705;
        _78 = dot(_686, _705);
        _78 += (-0.582111895084381103515625);
        _78 = clamp(_78, 0.0, 1.0);
        _78 *= 2.3929851055145263671875;
        _78 = log2(_78);
        _78 *= _FakeSpecularCornerPower2;
        _78 = exp2(_78);
        _596.x = (-_FakeSpecularNotCornerOffset2) + 1.0;
        _78 = (_78 * _596.x) + _FakeSpecularNotCornerOffset2;
        _686.x = _78 * _FakeSpecularIntensity2;
        _78 = (_78 * 2.094394683837890625) + 1.69645965099334716796875;
        _78 = sin(_78);
        _78 *= _78;
        _78 *= _78;
        _78 *= _78;
        _78 *= 3.0;
        _1062 = _686.x;
        _1065 = _78;
    }
    else
    {
        _1062 = _FakeSpecularIntensity2;
        _1065 = 0.0;
    }
    _267 = max(_1065, _267);
    _267 += _FakeSpecularMaskScale2;
    _596.x = _262.x * _1062;
    mediump vec2 _1084 = _596 * vec2(0.5);
    _262 = vec4(_262.x, _262.y, _1084.x, _1084.y);
    _262.x = (_262.x * 0.25) + _FakeSpecularPower2;
    _262.x += (-0.25);
    vec2 _1103 = _867.xy / vec2(_267);
    _735 = vec3(_1103.x, _735.y, _1103.y);
    vec2 _1109 = _735.xz + vec2(0.5);
    vs_TEXCOORD5 = vec4(_1109.x, _1109.y, vs_TEXCOORD5.z, vs_TEXCOORD5.w);
    vs_TEXCOORD2 = (_ObjectToWorld[3].xyz * _11.www) + _9.xyz;
    _867.x = dot(_1124, _WorldToObject[0].xyz);
    _867.y = dot(_1124, _WorldToObject[1].xyz);
    _867.z = dot(_1124, _WorldToObject[2].xyz);
    _735.x = dot(_867, _867);
    _735.x = inversesqrt(_735.x);
    vs_TEXCOORD3 = _735.xxx * _867;
    _843.x = cos(_RampMaskRotation);
    _843.y = sin(-_RampMaskRotation);
    vec2 _1176 = _775.xz * vec2(vec2(_RampMaskScale, _RampMaskScale));
    _735 = vec3(_1176.x, _735.y, _1176.y);
    _735.x = dot(_843, _735.xz);
    _735.x += 0.5;
    float _1195;
    if (_UseSimpleRampMaskAndRotation != 0)
    {
        _1195 = _735.x;
    }
    else
    {
        _1195 = 0.0;
    }
    vs_TEXCOORD6 = _1195;
    _843.x = cos(_RampMaskRotation2);
    _843.y = sin(-_RampMaskRotation2);
    vec2 _1218 = _775.xz * vec2(_RampMaskScale2);
    _735 = vec3(_1218.x, _1218.y, _735.z);
    _735.x = dot(_843, _735.xy);
    _735.x += 0.5;
    float _1235;
    if (_UseSimpleRampMaskAndRotation2 != 0)
    {
        _1235 = _735.x;
    }
    else
    {
        _1235 = 0.0;
    }
    vs_TEXCOORD7 = _1235;
    gl_Position = _44;
    vs_TEXCOORD0 = _858;
    vs_TEXCOORD4.z = _262.w;
    vs_TEXCOORD4.w = _674;
    vs_TEXCOORD5 = vec4(vs_TEXCOORD5.x, vs_TEXCOORD5.y, _262.zx.x, _262.zx.y);
}
