precision highp float;
precision highp int;

uniform highp vec3 cameraPosition;
uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform mediump float _FakeCameraHeight;
uniform mediump float _Height;
uniform mediump float _HeightPower;
uniform mediump float _Scale;
uniform int _UseUv2;
uniform mediump float _FakeSpecularMaskScale;
uniform mediump float _FakeSpecularIntensity;
uniform mediump float _FakeSpecularPower;
uniform mediump float _FakeSpecularCornerPower;
uniform mediump float _FakeSpecularNotCornerOffset;

in vec3 position;
in vec3 normal;
out vec3 vs_TEXCOORD3;
in vec4 tangent;
in vec2 uv;
in vec2 uv2;
out vec4 vs_TEXCOORD4;
out vec2 vs_TEXCOORD0;
out vec2 vs_TEXCOORD1;
vec4 _9;
vec4 _50;
float _101;
mediump vec3 _132;
vec4 _149;
vec4 _208;
vec3 _248;
mediump vec3 _266;
mediump float _284;
mediump vec2 _292;
vec2 _318;
vec2 _353;
vec4 _394;
float _432;
float _439;
bool _487;
bool _518;
bool _542;
bool _547;
bool _602;
bvec3 _745;
bvec3 _777;
mediump float _945;
mediump float _947;
float _1004;
float _1012;
float _1028;
bool _1047;
bool _1066;
mediump float _1116;
mediump float _1120;
mediump vec3 _1124;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _78 = normal;
    vec4 _133 = tangent;
    vec2 _320 = uv;
    vec2 _356 = uv2;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9 = _11.yyyy * _ObjectToWorld[1];
    _9 = (_ObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (_ObjectToWorld[2] * _11.zzzz) + _9;
    _9 += _ObjectToWorld[3];
    _50 = _9.yyyy * _ViewProjection[1];
    _50 = (_ViewProjection[0] * _9.xxxx) + _50;
    _50 = (_ViewProjection[2] * _9.zzzz) + _50;
    _9 = (_ViewProjection[3] * _9.wwww) + _50;
    _50.x = dot(_78, _WorldToObject[0].xyz);
    _50.y = dot(_78, _WorldToObject[1].xyz);
    _50.z = dot(_78, _WorldToObject[2].xyz);
    _101 = dot(_50.xyz, _50.xyz);
    _101 = inversesqrt(_101);
    vs_TEXCOORD3 = vec3(_101) * _50.xyz;
    _50.x = dot(_78, _78);
    _50.x = inversesqrt(_50.x);
    vec3 _128 = _50.xxx * _78.zxy;
    _50 = vec4(_128.x, _128.y, _128.z, _50.w);
    _132.x = dot(_133.xyz, _133.xyz);
    _132.x = inversesqrt(_132.x);
    _132 = _132.xxx * _133.yzx;
    vec3 _153 = _50.xyz * _132;
    _149 = vec4(_153.x, _153.y, _153.z, _149.w);
    vec3 _164 = (_50.zxy * _132.yzx) + (-_149.xyz);
    _50 = vec4(_164.x, _164.y, _164.z, _50.w);
    vec3 _171 = _50.xyz * _133.www;
    _50 = vec4(_171.x, _171.y, _171.z, _50.w);
    vec3 _181 = cameraPosition.yyy * _WorldToObject[1].xyz;
    _149 = vec4(_181.x, _181.y, _181.z, _149.w);
    vec3 _193 = (_WorldToObject[0].xyz * cameraPosition.xxx) + _149.xyz;
    _149 = vec4(_193.x, _193.y, _193.z, _149.w);
    vec3 _205 = (_WorldToObject[2].xyz * cameraPosition.zzz) + _149.xyz;
    _149 = vec4(_205.x, _205.y, _205.z, _149.w);
    vec3 _214 = _149.xyz + _WorldToObject[3].xyz;
    _208 = vec4(_214.x, _214.y, _214.z, _208.w);
    _208.w = _208.y + _FakeCameraHeight;
    vec3 _231 = _208.xwz + (-_11.xyz);
    _149 = vec4(_231.x, _231.y, _231.z, _149.w);
    _101 = dot(_149.xyz, _149.xyz);
    _101 = inversesqrt(_101);
    vec3 _245 = vec3(_101) * _149.xyz;
    _149 = vec4(_245.x, _245.y, _245.z, _149.w);
    _248.x = dot(_133.xyz, _149.xyz);
    _248.y = dot(_50.xyz, _149.xyz);
    _248.z = dot(_78, _149.xyz);
    _266.x = _HeightPower * 0.5;
    _266.x = (_Height * _HeightPower) + (-_266.x);
    _284 = dot(_248, _248);
    _284 = inversesqrt(_284);
    _292 = _248.xy * vec2(_284);
    _50.x = (_248.z * _284) + 0.4199999868869781494140625;
    vec2 _308 = _292 / _50.xx;
    _50 = vec4(_308.x, _308.y, _50.z, _50.w);
    vec2 _315 = _50.xy * _266.xx;
    _50 = vec4(_315.x, _315.y, _50.z, _50.w);
    _318 = (_320 * vec2(2.0)) + vec2(-1.0);
    _318 /= vec2(vec2(_Scale, _Scale));
    vec2 _344 = (_318 * vec2(0.5)) + _50.xy;
    _50 = vec4(_50.x, _50.y, _344.x, _344.y);
    _149.x = float(_UseUv2);
    _353 = (-_320) + _356;
    vec2 _364 = (_149.xx * _353) + _320;
    _149 = vec4(_364.x, _364.y, _149.z, _149.w);
    vec2 _370 = (_149.xy * vec2(2.0)) + vec2(-1.0);
    _149 = vec4(_370.x, _370.y, _149.z, _149.w);
    vec2 _383 = _149.xy / vec2(vec2(_Scale, _Scale));
    _149 = vec4(_383.x, _383.y, _149.z, _149.w);
    vec2 _391 = (_149.xy * vec2(0.5)) + _50.xy;
    _50 = vec4(_391.x, _391.y, _50.z, _50.w);
    _394 = _50.zwxy + vec4(0.5);
    _50.x = dot(-_ObjectToWorld[2].xyz, -_ObjectToWorld[2].xyz);
    _50.x = inversesqrt(_50.x);
    vec3 _419 = _50.xxx * (-_ObjectToWorld[2].zxy);
    _149 = vec4(_419.x, _419.y, _419.z, _149.w);
    _50.x = dot(_149.yz, _149.yz);
    _50.x = sqrt(_50.x);
    _432 = min(abs(_149.x), _50.x);
    _439 = max(abs(_149.x), _50.x);
    _439 = 1.0 / _439;
    _432 *= _439;
    _439 = _432 * _432;
    _248.x = (_439 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _248.x = (_439 * _248.x) + 0.1801410019397735595703125;
    _248.x = (_439 * _248.x) + (-0.33029949665069580078125);
    _439 = (_439 * _248.x) + 0.999866008758544921875;
    _248.x = _432 * _439;
    _487 = abs(_149.x) < _50.x;
    _248.x = (_248.x * (-2.0)) + 1.57079637050628662109375;
    float _503;
    if (_487)
    {
        _503 = _248.x;
    }
    else
    {
        _503 = 0.0;
    }
    _248.x = _503;
    _432 = (_432 * _439) + _248.x;
    _518 = _149.x < (-_149.x);
    _439 = _518 ? (-3.1415927410125732421875) : 0.0;
    _432 += _439;
    _439 = min(_149.x, _50.x);
    _50.x = max(_149.x, _50.x);
    _542 = _439 < (-_439);
    _547 = _50.x >= (-_50.x);
    _547 = _547 && _542;
    float _558;
    if (_547)
    {
        _558 = -_432;
    }
    else
    {
        _558 = _432;
    }
    _50.x = _558;
    _432 = _50.x * 3.0;
    _266.x = sin(_432);
    _284 = (_50.x * 2.0) + 1.69645965099334716796875;
    _266.y = sin(_284);
    mediump vec2 _586 = _266.xy * _266.xy;
    _266 = vec3(_586.x, _586.y, _266.z);
    _284 = _266.y * _266.y;
    _284 *= _284;
    _284 *= 3.0;
    _547 = _266.x != 0.0;
    _602 = _FakeSpecularCornerPower != 0.0;
    _547 = _602 && _547;
    if (_547)
    {
        _50.x = dot(-_149.yz, -_149.yz);
        _50.x = inversesqrt(_50.x);
        vec2 _630 = _50.xx * (-_149.yz);
        _50 = vec4(_630.x, _630.y, _50.z, _50.w);
        _149.x = min(abs(_50.x), abs(_50.y));
        _439 = max(abs(_50.x), abs(_50.y));
        _439 = 1.0 / _439;
        _149.x = _439 * _149.x;
        _439 = _149.x * _149.x;
        _248.x = (_439 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
        _248.x = (_439 * _248.x) + 0.1801410019397735595703125;
        _248.x = (_439 * _248.x) + (-0.33029949665069580078125);
        _439 = (_439 * _248.x) + 0.999866008758544921875;
        _248.x = _439 * _149.x;
        _487 = abs(_50.x) < abs(_50.y);
        _248.x = (_248.x * (-2.0)) + 1.57079637050628662109375;
        float _699;
        if (_487)
        {
            _699 = _248.x;
        }
        else
        {
            _699 = 0.0;
        }
        _248.x = _699;
        _149.x = (_149.x * _439) + _248.x;
        _518 = _50.x < (-_50.x);
        _439 = _518 ? (-3.1415927410125732421875) : 0.0;
        _149.x = _439 + _149.x;
        _439 = min(_50.x, _50.y);
        _248.x = max(_50.x, _50.y);
        _518 = _439 < (-_439);
        _745.x = _248.x >= (-_248.x);
        _518 = _518 && _745.x;
        float _758;
        if (_518)
        {
            _758 = -_149.x;
        }
        else
        {
            _758 = _149.x;
        }
        _149.x = _758;
        _745 = greaterThanEqual(_149.xxxx, vec4(0.0, 1.57079601287841796875, -3.1415920257568359375, 0.0)).xyz;
        _777 = lessThan(_149.xxxx, vec4(1.57079601287841796875, 3.1415920257568359375, -1.57079601287841796875, 0.0)).xyz;
        _745.x = _745.x && _777.x;
        _745.y = _745.y && _777.y;
        _745.z = _745.z && _777.z;
        bvec2 _811 = bvec2(_745.z);
        vec2 _812 = vec2(_811.x ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).x : vec2(0.314999997615814208984375, -0.439999997615814208984375).x, _811.y ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).y : vec2(0.314999997615814208984375, -0.439999997615814208984375).y);
        _149 = vec4(_812.x, _149.y, _149.z, _812.y);
        vec2 _818;
        if (_745.y)
        {
            _818 = vec2(-0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _818 = _149.xw;
        }
        _149 = vec4(_818.x, _149.y, _149.z, _818.y);
        vec2 _831;
        if (_745.x)
        {
            _831 = vec2(0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _831 = _149.xw;
        }
        _149 = vec4(_831.x, _149.y, _149.z, _831.y);
        _248.x = dot(_149.xw, _149.xw);
        _248.x = inversesqrt(_248.x);
        vec2 _855 = _149.xw * _248.xx;
        _149 = vec4(_855.x, _149.y, _149.z, _855.y);
        _50.x = dot(_50.xy, _149.xw);
        _50.x += (-0.582111895084381103515625);
        _50.x = clamp(_50.x, 0.0, 1.0);
        _50.x *= 2.3929851055145263671875;
        _50.x = log2(_50.x);
        _50.x *= _FakeSpecularCornerPower;
        _50.x = exp2(_50.x);
        _292.x = (-_FakeSpecularNotCornerOffset) + 1.0;
        _50.x = (_50.x * _292.x) + _FakeSpecularNotCornerOffset;
        _432 = _50.x * _FakeSpecularIntensity;
        _149.x = (_50.x * 2.094394683837890625) + 1.69645965099334716796875;
        _149.x = sin(_149.x);
        _149.x *= _149.x;
        _149.x *= _149.x;
        _149.x *= _149.x;
        _149.x *= 3.0;
        _945 = _432;
        _947 = _149.x;
    }
    else
    {
        _945 = _FakeSpecularIntensity;
        _947 = 0.0;
    }
    _284 = max(_947, _284);
    _284 += _FakeSpecularMaskScale;
    _292.x = _266.x * _945;
    _266.z = _292.x * 0.5;
    _266.x = (_266.x * 0.25) + _FakeSpecularPower;
    _266.x += (-0.25);
    _248.x = dot(-_149.yz, -_149.yz);
    _248.x = inversesqrt(_248.x);
    vec2 _1001 = (-_149.yz) * _248.xx;
    _248 = vec3(_1001.x, _1001.y, _248.z);
    _1004 = min(abs(_248.y), abs(_248.x));
    _1012 = max(abs(_248.y), abs(_248.x));
    _1012 = 1.0 / _1012;
    _1004 = _1012 * _1004;
    _1012 = _1004 * _1004;
    _1028 = (_1012 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _1028 = (_1012 * _1028) + 0.1801410019397735595703125;
    _1028 = (_1012 * _1028) + (-0.33029949665069580078125);
    _1012 = (_1012 * _1028) + 0.999866008758544921875;
    _1028 = _1012 * _1004;
    _1047 = abs(_248.y) < abs(_248.x);
    _1028 = (_1028 * (-2.0)) + 1.57079637050628662109375;
    _1028 = _1047 ? _1028 : 0.0;
    _1004 = (_1004 * _1012) + _1028;
    _1066 = _248.y < (-_248.y);
    _1012 = _1066 ? (-3.1415927410125732421875) : 0.0;
    _1004 = _1012 + _1004;
    _1012 = min(_248.y, _248.x);
    _248.x = max(_248.y, _248.x);
    _487 = _1012 < (-_1012);
    _745.x = _248.x >= (-_248.x);
    _745.x = _745.x && _487;
    float _1107;
    if (_745.x)
    {
        _1107 = -_1004;
    }
    else
    {
        _1107 = _1004;
    }
    _248.x = _1107;
    _1116 = sin(_248.x);
    _1120 = cos(_248.x);
    _1124.x = -_1116;
    _1124.y = _1120;
    _248.x = dot(_1124.yx, _50.zw);
    _1124.z = _1116;
    _248.y = dot(_1124.zy, _50.zw);
    vec2 _1148 = _248.xy / vec2(_284);
    _248 = vec3(_1148.x, _1148.y, _248.z);
    vec2 _1155 = _248.xy + vec2(0.5);
    vs_TEXCOORD4 = vec4(_1155.x, _1155.y, vs_TEXCOORD4.z, vs_TEXCOORD4.w);
    gl_Position = _9;
    vs_TEXCOORD4 = vec4(vs_TEXCOORD4.x, vs_TEXCOORD4.y, _266.zx.x, _266.zx.y);
    vs_TEXCOORD0 = _394.xy;
    vs_TEXCOORD1 = _394.zw;
}
