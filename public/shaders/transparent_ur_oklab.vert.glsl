precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform mediump float _FakeSpecularMaskScale;
uniform mediump float _FakeSpecularIntensity;
uniform mediump float _FakeSpecularPower;
uniform mediump float _FakeSpecularCornerPower;
uniform mediump float _FakeSpecularNotCornerOffset;
uniform mediump float _FakeSpecularMaskScale_Outline;
uniform mediump float _FakeSpecularIntensity_Outline;
uniform mediump float _FakeSpecularPower_Outline;

in vec3 position;
out vec3 vs_TEXCOORD1;
in vec3 normal;
out vec3 vs_TEXCOORD2;
out vec4 vs_TEXCOORD6;
out vec4 vs_TEXCOORD7;
out vec2 vs_TEXCOORD0;
in vec2 uv;
out vec2 vs_TEXCOORD5;
vec4 _9;
vec4 _44;
vec4 _50;
float _122;
vec2 _167;
float _174;
vec2 _193;
bool _227;
bool _259;
bool _283;
bool _288;
mediump vec4 _314;
mediump float _318;
vec2 _401;
bool _433;
bvec3 _464;
bvec3 _528;
vec2 _554;
mediump float _613;
mediump float _648;
mediump float _651;
mediump float _669;
vec2 _681;
vec2 _700;
float _709;
float _729;
bool _749;
vec3 _761;
bool _774;
float _781;
float _794;
bool _804;
mediump float _824;
mediump float _828;
mediump vec3 _832;
vec2 _849;
bool _906;
bvec3 _932;
bvec3 _937;
float _1031;
mediump float _1055;
mediump float _1057;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _99 = normal;
    vec2 _1098 = uv;
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
    vec2 _83 = _11.xy + vec2(0.393750011920928955078125, 0.550000011920928955078125);
    _50 = vec4(_83.x, _83.y, _50.z, _50.w);
    vs_TEXCOORD1 = (_ObjectToWorld[3].xyz * _11.www) + _9.xyz;
    _9.x = dot(_99, _WorldToObject[0].xyz);
    _9.y = dot(_99, _WorldToObject[1].xyz);
    _9.z = dot(_99, _WorldToObject[2].xyz);
    _122 = dot(_9.xyz, _9.xyz);
    _122 = inversesqrt(_122);
    vs_TEXCOORD2 = vec3(_122) * _9.xyz;
    _9.x = dot(-_ObjectToWorld[2].xyz, -_ObjectToWorld[2].xyz);
    _9.x = inversesqrt(_9.x);
    vec3 _156 = _9.xxx * (-_ObjectToWorld[2].zxy);
    _9 = vec4(_156.x, _156.y, _156.z, _9.w);
    _122 = dot(_9.yz, _9.yz);
    _122 = sqrt(_122);
    _167.x = min(abs(_9.x), _122);
    _174 = max(abs(_9.x), _122);
    _174 = 1.0 / _174;
    _167.x = _174 * _167.x;
    _174 = _167.x * _167.x;
    _193.x = (_174 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _193.x = (_174 * _193.x) + 0.1801410019397735595703125;
    _193.x = (_174 * _193.x) + (-0.33029949665069580078125);
    _174 = (_174 * _193.x) + 0.999866008758544921875;
    _193.x = _174 * _167.x;
    _227 = abs(_9.x) < _122;
    _193.x = (_193.x * (-2.0)) + 1.57079637050628662109375;
    float _242;
    if (_227)
    {
        _242 = _193.x;
    }
    else
    {
        _242 = 0.0;
    }
    _193.x = _242;
    _167.x = (_167.x * _174) + _193.x;
    _259 = _9.x < (-_9.x);
    _174 = _259 ? (-3.1415927410125732421875) : 0.0;
    _167.x = _174 + _167.x;
    _174 = min(_9.x, _122);
    _9.x = max(_9.x, _122);
    _283 = _174 < (-_174);
    _288 = _9.x >= (-_9.x);
    _288 = _288 && _283;
    float _299;
    if (_288)
    {
        _299 = -_167.x;
    }
    else
    {
        _299 = _167.x;
    }
    _9.x = _299;
    _122 = _9.x * 3.0;
    _314.x = sin(_122);
    _318 = (_9.x * 2.0) + 1.69645965099334716796875;
    _314.y = sin(_318);
    mediump vec2 _332 = _314.xy * _314.xy;
    _314 = vec4(_332.x, _332.y, _314.z, _314.w);
    _318 = _314.y * _314.y;
    _318 *= _318;
    _318 *= 3.0;
    _288 = _314.x != 0.0;
    _283 = _FakeSpecularCornerPower != 0.0;
    _283 = _283 && _288;
    if (_283)
    {
        _122 = dot(-_9.yz, -_9.yz);
        _122 = inversesqrt(_122);
        _167 = vec2(_122) * (-_9.yz);
        _122 = min(abs(_167.x), abs(_167.y));
        _193.x = max(abs(_167.x), abs(_167.y));
        _193.x = 1.0 / _193.x;
        _122 *= _193.x;
        _193.x = _122 * _122;
        _401.x = (_193.x * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
        _401.x = (_193.x * _401.x) + 0.1801410019397735595703125;
        _401.x = (_193.x * _401.x) + (-0.33029949665069580078125);
        _193.x = (_193.x * _401.x) + 0.999866008758544921875;
        _401.x = _122 * _193.x;
        _433 = abs(_167.x) < abs(_167.y);
        _401.x = (_401.x * (-2.0)) + 1.57079637050628662109375;
        float _447;
        if (_433)
        {
            _447 = _401.x;
        }
        else
        {
            _447 = 0.0;
        }
        _401.x = _447;
        _122 = (_122 * _193.x) + _401.x;
        _464.x = _167.x < (-_167.x);
        _193.x = _464.x ? (-3.1415927410125732421875) : 0.0;
        _122 += _193.x;
        _193.x = min(_167.x, _167.y);
        _401.x = max(_167.x, _167.y);
        _464.x = _193.x < (-_193.x);
        _227 = _401.x >= (-_401.x);
        _464.x = _227 && _464.x;
        float _512;
        if (_464.x)
        {
            _512 = -_122;
        }
        else
        {
            _512 = _122;
        }
        _122 = _512;
        _464 = greaterThanEqual(vec4(_122), vec4(0.0, 1.57079601287841796875, -3.1415920257568359375, 0.0)).xyz;
        _528 = lessThan(vec4(_122), vec4(1.57079601287841796875, 3.1415920257568359375, -1.57079601287841796875, 0.0)).xyz;
        _464.x = _464.x && _528.x;
        _464.y = _464.y && _528.y;
        _464.z = _464.z && _528.z;
        bvec2 _563 = bvec2(_464.z);
        _554 = vec2(_563.x ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).x : vec2(0.314999997615814208984375, -0.439999997615814208984375).x, _563.y ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).y : vec2(0.314999997615814208984375, -0.439999997615814208984375).y);
        vec2 _568;
        if (_464.y)
        {
            _568 = vec2(-0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _568 = _554;
        }
        _401 = _568;
        vec2 _578;
        if (_464.x)
        {
            _578 = vec2(0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _578 = _401;
        }
        _193 = _578;
        _122 = dot(_193, _193);
        _122 = inversesqrt(_122);
        _193 = vec2(_122) * _193;
        _122 = dot(_167, _193);
        _122 += (-0.582111895084381103515625);
        _122 = clamp(_122, 0.0, 1.0);
        _122 *= 2.3929851055145263671875;
        _122 = log2(_122);
        _122 *= _FakeSpecularCornerPower;
        _122 = exp2(_122);
        _613 = (-_FakeSpecularNotCornerOffset) + 1.0;
        _122 = (_122 * _613) + _FakeSpecularNotCornerOffset;
        _167.x = _122 * _FakeSpecularIntensity;
        _122 = (_122 * 2.094394683837890625) + 1.69645965099334716796875;
        _122 = sin(_122);
        _122 *= _122;
        _122 *= _122;
        _122 *= _122;
        _122 *= 3.0;
        _648 = _167.x;
        _651 = _122;
    }
    else
    {
        _648 = _FakeSpecularIntensity;
        _651 = 0.0;
    }
    _613 = max(_651, _318);
    _613 += _FakeSpecularMaskScale;
    _314.w = _314.x * _648;
    _669 = (_314.x * 0.25) + _FakeSpecularPower;
    _669 += (-0.25);
    _681.x = dot(-_9.yz, -_9.yz);
    _681.x = inversesqrt(_681.x);
    _681 = (-_9.yz) * _681.xx;
    _700.x = min(abs(_681.y), abs(_681.x));
    _709 = max(abs(_681.y), abs(_681.x));
    _709 = 1.0 / _709;
    _700.x = _709 * _700.x;
    _709 = _700.x * _700.x;
    _729 = (_709 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _729 = (_709 * _729) + 0.1801410019397735595703125;
    _729 = (_709 * _729) + (-0.33029949665069580078125);
    _709 = (_709 * _729) + 0.999866008758544921875;
    _729 = _709 * _700.x;
    _749 = abs(_681.y) < abs(_681.x);
    _729 = (_729 * (-2.0)) + 1.57079637050628662109375;
    _761.x = _749 ? _729 : 0.0;
    _761.x = (_700.x * _709) + _761.x;
    _774 = _681.y < (-_681.y);
    _781 = _774 ? (-3.1415927410125732421875) : 0.0;
    _761.x = _781 + _761.x;
    _781 = min(_681.y, _681.x);
    _794 = max(_681.y, _681.x);
    _774 = _781 < (-_781);
    _804 = _794 >= (-_794);
    _774 = _804 && _774;
    float _813;
    if (_774)
    {
        _813 = -_761.x;
    }
    else
    {
        _813 = _761.x;
    }
    _761.x = _813;
    _824 = sin(_761.x);
    _828 = cos(_761.x);
    _832.x = -_824;
    vec2 _844 = (_50.xy * vec2(1.26984119415283203125, 0.90909087657928466796875)) + vec2(-0.5);
    _761 = vec3(_844.x, _761.y, _844.y);
    _832.y = _828;
    _849.x = dot(_832.yx, _761.xz);
    _832.z = _824;
    _849.y = dot(_832.zy, _761.xz);
    vec2 _867 = _849 / vec2(_613);
    _761 = vec3(_867.x, _761.y, _867.y);
    vec2 _876 = _761.xz + vec2(0.5);
    vs_TEXCOORD6 = vec4(_876.x, _876.y, vs_TEXCOORD6.z, vs_TEXCOORD6.w);
    _749 = _FakeSpecularPower_Outline != 0.0;
    _749 = _288 && _749;
    if (_749)
    {
        _749 = abs(_681.x) < abs(_681.y);
        _729 = _749 ? _729 : 0.0;
        _700.x = (_700.x * _709) + _729;
        _906 = _681.x < (-_681.x);
        _709 = _906 ? (-3.1415927410125732421875) : 0.0;
        _700.x = _709 + _700.x;
        float _921;
        if (_774)
        {
            _921 = -_700.x;
        }
        else
        {
            _921 = _700.x;
        }
        _700.x = _921;
        _932 = greaterThanEqual(_700.xxxx, vec4(0.0, 1.57079601287841796875, -3.1415920257568359375, 0.0)).xyz;
        _937 = lessThan(_700.xxxx, vec4(1.57079601287841796875, 3.1415920257568359375, -1.57079601287841796875, 0.0)).xyz;
        _932.x = _932.x && _937.x;
        _932.y = _932.y && _937.y;
        _932.z = _932.z && _937.z;
        bvec2 _962 = bvec2(_932.z);
        _700 = vec2(_962.x ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).x : vec2(0.314999997615814208984375, -0.439999997615814208984375).x, _962.y ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).y : vec2(0.314999997615814208984375, -0.439999997615814208984375).y);
        vec2 _966;
        if (_932.y)
        {
            _966 = vec2(-0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _966 = _700;
        }
        _700 = _966;
        vec2 _974;
        if (_932.x)
        {
            _974 = vec2(0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _974 = _700;
        }
        _700 = _974;
        _729 = dot(_700, _700);
        _729 = inversesqrt(_729);
        _700 *= vec2(_729);
        _681.x = dot(_681, _700);
        _681.x += (-0.582111895084381103515625);
        _681.x = clamp(_681.x, 0.0, 1.0);
        _681.x *= 2.3929851055145263671875;
        _681.x = log2(_681.x);
        _681.x *= _FakeSpecularPower_Outline;
        _681.x = exp2(_681.x);
        _613 = (-_FakeSpecularNotCornerOffset) + 1.0;
        _681.x = (_681.x * _613) + _FakeSpecularNotCornerOffset;
        _1031 = _681.x * _FakeSpecularIntensity_Outline;
        _729 = (_681.x * 2.094394683837890625) + 1.69645965099334716796875;
        _729 = sin(_729);
        _729 *= _729;
        _729 *= _729;
        _729 *= _729;
        _729 *= 3.0;
        _1055 = _1031;
        _1057 = _729;
    }
    else
    {
        _1055 = _FakeSpecularIntensity_Outline;
        _1057 = 0.0;
    }
    _318 = max(_318, _1057);
    _318 += _FakeSpecularMaskScale_Outline;
    _314.x *= _1055;
    mediump vec2 _1077 = _314.xw * vec2(0.5);
    _314 = vec4(_1077.x, _314.y, _314.z, _1077.y);
    _849 /= vec2(_318);
    vec2 _1086 = _849 + vec2(0.5);
    vs_TEXCOORD7 = vec4(_1086.x, _1086.y, vs_TEXCOORD7.z, vs_TEXCOORD7.w);
    gl_Position = _44;
    vs_TEXCOORD0 = _1098;
    vs_TEXCOORD5 = (_11.xy * vec2(1.26984119415283203125, 0.90909087657928466796875)) + vec2(0.5);
    vs_TEXCOORD6.z = _314.w;
    vs_TEXCOORD6.w = _669;
    vs_TEXCOORD7.z = _314.x;
    vs_TEXCOORD7.w = _669;
}
