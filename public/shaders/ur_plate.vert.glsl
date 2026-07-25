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
in vec2 uv1;
out vec3 vs_TEXCOORD4;
out vec4 vs_TEXCOORD5;
out vec2 vs_TEXCOORD0;
out vec2 vs_TEXCOORD1;
vec4 _9;
vec4 _45;
vec4 _51;
float _102;
mediump vec3 _130;
vec3 _147;
vec4 _195;
vec3 _227;
mediump vec3 _242;
mediump float _260;
mediump vec2 _268;
vec2 _293;
vec4 _370;
float _421;
bool _473;
bool _505;
bool _529;
bool _534;
bvec3 _733;
bvec3 _765;
mediump float _933;
mediump float _935;
float _992;
float _1000;
bool _1041;
bool _1069;
mediump float _1119;
mediump float _1123;
mediump vec3 _1127;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _79 = normal;
    vec4 _131 = tangent;
    vec2 _295 = uv;
    vec2 _329 = uv1;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9 = _11.yyyy * _ObjectToWorld[1];
    _9 = (_ObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (_ObjectToWorld[2] * _11.zzzz) + _9;
    _45 = _9 + _ObjectToWorld[3];
    _51 = _45.yyyy * _ViewProjection[1];
    _51 = (_ViewProjection[0] * _45.xxxx) + _51;
    _51 = (_ViewProjection[2] * _45.zzzz) + _51;
    _45 = (_ViewProjection[3] * _45.wwww) + _51;
    _51.x = dot(_79, _WorldToObject[0].xyz);
    _51.y = dot(_79, _WorldToObject[1].xyz);
    _51.z = dot(_79, _WorldToObject[2].xyz);
    _102 = dot(_51.xyz, _51.xyz);
    _102 = inversesqrt(_102);
    vs_TEXCOORD3 = vec3(_102) * _51.xyz;
    _102 = dot(_79, _79);
    _102 = inversesqrt(_102);
    vec3 _126 = vec3(_102) * _79.zxy;
    _51 = vec4(_126.x, _126.y, _126.z, _51.w);
    _130.x = dot(_131.xyz, _131.xyz);
    _130.x = inversesqrt(_130.x);
    _130 = _130.xxx * _131.yzx;
    _147 = _51.xyz * _130;
    vec3 _159 = (_51.zxy * _130.yzx) + (-_147);
    _51 = vec4(_159.x, _159.y, _159.z, _51.w);
    vec3 _166 = _51.xyz * _131.www;
    _51 = vec4(_166.x, _166.y, _166.z, _51.w);
    _147 = cameraPosition.yyy * _WorldToObject[1].xyz;
    _147 = (_WorldToObject[0].xyz * cameraPosition.xxx) + _147;
    _147 = (_WorldToObject[2].xyz * cameraPosition.zzz) + _147;
    vec3 _200 = _147 + _WorldToObject[3].xyz;
    _195 = vec4(_200.x, _200.y, _200.z, _195.w);
    _195.w = _195.y + _FakeCameraHeight;
    _147 = _195.xwz + (-_11.xyz);
    _102 = dot(_147, _147);
    _102 = inversesqrt(_102);
    _147 = vec3(_102) * _147;
    _227.x = dot(_131.xyz, _147);
    _227.y = dot(_51.xyz, _147);
    _227.z = dot(_79, _147);
    _242.x = _HeightPower * 0.5;
    _242.x = (_Height * _HeightPower) + (-_242.x);
    _260 = dot(_227, _227);
    _260 = inversesqrt(_260);
    _268 = _227.xy * vec2(_260);
    _102 = (_227.z * _260) + 0.4199999868869781494140625;
    mediump vec2 _283 = _268 / vec2(_102);
    _51 = vec4(_283.x, _283.y, _51.z, _51.w);
    vec2 _290 = _51.xy * _242.xx;
    _51 = vec4(_290.x, _290.y, _51.z, _51.w);
    _293 = (_295 * vec2(2.0)) + vec2(-1.0);
    _293 /= vec2(vec2(_Scale, _Scale));
    vec2 _319 = (_293 * vec2(0.5)) + _51.xy;
    _51 = vec4(_51.x, _51.y, _319.x, _319.y);
    _102 = float(_UseUv2);
    vec2 _331 = (-_295) + _329;
    _147 = vec3(_331.x, _331.y, _147.z);
    vec2 _340 = (vec2(_102) * _147.xy) + _295;
    _147 = vec3(_340.x, _340.y, _147.z);
    vec2 _346 = (_147.xy * vec2(2.0)) + vec2(-1.0);
    _147 = vec3(_346.x, _346.y, _147.z);
    vec2 _359 = _147.xy / vec2(vec2(_Scale, _Scale));
    _147 = vec3(_359.x, _359.y, _147.z);
    vec2 _367 = (_147.xy * vec2(0.5)) + _51.xy;
    _51 = vec4(_367.x, _367.y, _51.z, _51.w);
    _370 = _51.zwxy + vec4(0.5);
    vs_TEXCOORD4 = (_ObjectToWorld[3].xyz * _11.www) + _9.xyz;
    _9.x = dot(-_ObjectToWorld[2].xyz, -_ObjectToWorld[2].xyz);
    _9.x = inversesqrt(_9.x);
    vec3 _405 = _9.xxx * (-_ObjectToWorld[2].zxy);
    _9 = vec4(_405.x, _405.y, _405.z, _9.w);
    _102 = dot(_9.yz, _9.yz);
    _102 = sqrt(_102);
    _51.x = min(abs(_9.x), _102);
    _421 = max(abs(_9.x), _102);
    _421 = 1.0 / _421;
    _51.x = _421 * _51.x;
    _421 = _51.x * _51.x;
    _147.x = (_421 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _147.x = (_421 * _147.x) + 0.1801410019397735595703125;
    _147.x = (_421 * _147.x) + (-0.33029949665069580078125);
    _421 = (_421 * _147.x) + 0.999866008758544921875;
    _147.x = _421 * _51.x;
    _473 = abs(_9.x) < _102;
    _147.x = (_147.x * (-2.0)) + 1.57079637050628662109375;
    float _488;
    if (_473)
    {
        _488 = _147.x;
    }
    else
    {
        _488 = 0.0;
    }
    _147.x = _488;
    _51.x = (_51.x * _421) + _147.x;
    _505 = _9.x < (-_9.x);
    _421 = _505 ? (-3.1415927410125732421875) : 0.0;
    _51.x = _421 + _51.x;
    _421 = min(_9.x, _102);
    _9.x = max(_9.x, _102);
    _529 = _421 < (-_421);
    _534 = _9.x >= (-_9.x);
    _534 = _534 && _529;
    float _545;
    if (_534)
    {
        _545 = -_51.x;
    }
    else
    {
        _545 = _51.x;
    }
    _9.x = _545;
    _102 = _9.x * 3.0;
    _242.x = sin(_102);
    _260 = (_9.x * 2.0) + 1.69645965099334716796875;
    _242.y = sin(_260);
    mediump vec2 _575 = _242.xy * _242.xy;
    _242 = vec3(_575.x, _575.y, _242.z);
    _260 = _242.y * _242.y;
    _260 *= _260;
    _260 *= 3.0;
    _534 = _242.x != 0.0;
    _529 = _FakeSpecularCornerPower != 0.0;
    _534 = _529 && _534;
    if (_534)
    {
        _9.x = dot(-_9.yz, -_9.yz);
        _9.x = inversesqrt(_9.x);
        vec2 _618 = _9.xx * (-_9.yz);
        _9 = vec4(_618.x, _9.y, _9.z, _618.y);
        _51.x = min(abs(_9.x), abs(_9.w));
        _421 = max(abs(_9.x), abs(_9.w));
        _421 = 1.0 / _421;
        _51.x = _421 * _51.x;
        _421 = _51.x * _51.x;
        _147.x = (_421 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
        _147.x = (_421 * _147.x) + 0.1801410019397735595703125;
        _147.x = (_421 * _147.x) + (-0.33029949665069580078125);
        _421 = (_421 * _147.x) + 0.999866008758544921875;
        _147.x = _421 * _51.x;
        _473 = abs(_9.x) < abs(_9.w);
        _147.x = (_147.x * (-2.0)) + 1.57079637050628662109375;
        float _687;
        if (_473)
        {
            _687 = _147.x;
        }
        else
        {
            _687 = 0.0;
        }
        _147.x = _687;
        _51.x = (_51.x * _421) + _147.x;
        _505 = _9.x < (-_9.x);
        _421 = _505 ? (-3.1415927410125732421875) : 0.0;
        _51.x = _421 + _51.x;
        _421 = min(_9.x, _9.w);
        _147.x = max(_9.x, _9.w);
        _505 = _421 < (-_421);
        _733.x = _147.x >= (-_147.x);
        _505 = _505 && _733.x;
        float _746;
        if (_505)
        {
            _746 = -_51.x;
        }
        else
        {
            _746 = _51.x;
        }
        _51.x = _746;
        _733 = greaterThanEqual(_51.xxxx, vec4(0.0, 1.57079601287841796875, -3.1415920257568359375, 0.0)).xyz;
        _765 = lessThan(_51.xxxx, vec4(1.57079601287841796875, 3.1415920257568359375, -1.57079601287841796875, 0.0)).xyz;
        _733.x = _733.x && _765.x;
        _733.y = _733.y && _765.y;
        _733.z = _733.z && _765.z;
        bvec2 _799 = bvec2(_733.z);
        vec2 _800 = vec2(_799.x ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).x : vec2(0.314999997615814208984375, -0.439999997615814208984375).x, _799.y ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).y : vec2(0.314999997615814208984375, -0.439999997615814208984375).y);
        _51 = vec4(_800.x, _800.y, _51.z, _51.w);
        vec2 _806;
        if (_733.y)
        {
            _806 = vec2(-0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _806 = _51.xy;
        }
        _51 = vec4(_806.x, _806.y, _51.z, _51.w);
        vec2 _819;
        if (_733.x)
        {
            _819 = vec2(0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _819 = _51.xy;
        }
        _51 = vec4(_819.x, _819.y, _51.z, _51.w);
        _147.x = dot(_51.xy, _51.xy);
        _147.x = inversesqrt(_147.x);
        vec2 _843 = _51.xy * _147.xx;
        _51 = vec4(_843.x, _843.y, _51.z, _51.w);
        _9.x = dot(_9.xw, _51.xy);
        _9.x += (-0.582111895084381103515625);
        _9.x = clamp(_9.x, 0.0, 1.0);
        _9.x *= 2.3929851055145263671875;
        _9.x = log2(_9.x);
        _9.x *= _FakeSpecularCornerPower;
        _9.x = exp2(_9.x);
        _268.x = (-_FakeSpecularNotCornerOffset) + 1.0;
        _9.x = (_9.x * _268.x) + _FakeSpecularNotCornerOffset;
        _102 = _9.x * _FakeSpecularIntensity;
        _51.x = (_9.x * 2.094394683837890625) + 1.69645965099334716796875;
        _51.x = sin(_51.x);
        _51.x *= _51.x;
        _51.x *= _51.x;
        _51.x *= _51.x;
        _51.x *= 3.0;
        _933 = _102;
        _935 = _51.x;
    }
    else
    {
        _933 = _FakeSpecularIntensity;
        _935 = 0.0;
    }
    _260 = max(_935, _260);
    _260 += _FakeSpecularMaskScale;
    _268.x = _242.x * _933;
    _242.z = _268.x * 0.5;
    _242.x = (_242.x * 0.25) + _FakeSpecularPower;
    _242.x += (-0.25);
    _147.x = dot(-_9.yz, -_9.yz);
    _147.x = inversesqrt(_147.x);
    vec2 _989 = (-_9.yz) * _147.xx;
    _147 = vec3(_989.x, _989.y, _147.z);
    _992 = min(abs(_147.y), abs(_147.x));
    _1000 = max(abs(_147.y), abs(_147.x));
    _1000 = 1.0 / _1000;
    _992 = _1000 * _992;
    _1000 = _992 * _992;
    _227.x = (_1000 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _227.x = (_1000 * _227.x) + 0.1801410019397735595703125;
    _227.x = (_1000 * _227.x) + (-0.33029949665069580078125);
    _1000 = (_1000 * _227.x) + 0.999866008758544921875;
    _227.x = _1000 * _992;
    _1041 = abs(_147.y) < abs(_147.x);
    _227.x = (_227.x * (-2.0)) + 1.57079637050628662109375;
    float _1055;
    if (_1041)
    {
        _1055 = _227.x;
    }
    else
    {
        _1055 = 0.0;
    }
    _227.x = _1055;
    _992 = (_992 * _1000) + _227.x;
    _1069 = _147.y < (-_147.y);
    _1000 = _1069 ? (-3.1415927410125732421875) : 0.0;
    _992 = _1000 + _992;
    _1000 = min(_147.y, _147.x);
    _147.x = max(_147.y, _147.x);
    _473 = _1000 < (-_1000);
    _733.x = _147.x >= (-_147.x);
    _733.x = _733.x && _473;
    float _1110;
    if (_733.x)
    {
        _1110 = -_992;
    }
    else
    {
        _1110 = _992;
    }
    _147.x = _1110;
    _1119 = sin(_147.x);
    _1123 = cos(_147.x);
    _1127.x = -_1119;
    _1127.y = _1123;
    _147.x = dot(_1127.yx, _51.zw);
    _1127.z = _1119;
    _147.y = dot(_1127.zy, _51.zw);
    vec2 _1151 = _147.xy / vec2(_260);
    _147 = vec3(_1151.x, _1151.y, _147.z);
    vec2 _1158 = _147.xy + vec2(0.5);
    vs_TEXCOORD5 = vec4(_1158.x, _1158.y, vs_TEXCOORD5.z, vs_TEXCOORD5.w);
    gl_Position = _45;
    vs_TEXCOORD5 = vec4(vs_TEXCOORD5.x, vs_TEXCOORD5.y, _242.zx.x, _242.zx.y);
    vs_TEXCOORD0 = _370.xy;
    vs_TEXCOORD1 = _370.zw;
}
