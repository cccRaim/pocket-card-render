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

in vec3 position;
out vec3 vs_TEXCOORD1;
in vec3 normal;
out vec3 vs_TEXCOORD2;
in vec2 uv;
out vec4 vs_TEXCOORD3;
out vec2 vs_TEXCOORD0;
vec4 _9;
vec4 _44;
vec4 _50;
float _113;
vec2 _165;
vec2 _189;
bool _229;
bvec3 _264;
bool _293;
bool _300;
mediump vec3 _327;
mediump float _331;
bool _523;
bvec3 _556;
bvec3 _564;
mediump float _666;
mediump float _718;
mediump float _720;
vec2 _755;
float _774;
float _782;
vec2 _798;
bool _824;
bool _852;
bool _875;
mediump float _903;
mediump float _907;
mediump vec3 _911;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _916 = uv;
    vec3 _90 = normal;
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
    vs_TEXCOORD1 = (_ObjectToWorld[3].xyz * _11.www) + _9.xyz;
    _9.x = dot(_90, _WorldToObject[0].xyz);
    _9.y = dot(_90, _WorldToObject[1].xyz);
    _9.z = dot(_90, _WorldToObject[2].xyz);
    _113 = dot(_9.xyz, _9.xyz);
    _113 = inversesqrt(_113);
    vs_TEXCOORD2 = vec3(_113) * _9.xyz;
    _9.x = dot(-_ObjectToWorld[2].xyz, -_ObjectToWorld[2].xyz);
    _9.x = inversesqrt(_9.x);
    vec3 _147 = _9.xxx * (-_ObjectToWorld[2].zxy);
    _9 = vec4(_147.x, _147.y, _147.z, _9.w);
    _113 = dot(_9.yz, _9.yz);
    _113 = sqrt(_113);
    _50.x = min(abs(_9.x), _113);
    _165.x = max(abs(_9.x), _113);
    _165.x = 1.0 / _165.x;
    _50.x = _165.x * _50.x;
    _165.x = _50.x * _50.x;
    _189.x = (_165.x * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _189.x = (_165.x * _189.x) + 0.1801410019397735595703125;
    _189.x = (_165.x * _189.x) + (-0.33029949665069580078125);
    _165.x = (_165.x * _189.x) + 0.999866008758544921875;
    _189.x = _165.x * _50.x;
    _229 = abs(_9.x) < _113;
    _189.x = (_189.x * (-2.0)) + 1.57079637050628662109375;
    float _244;
    if (_229)
    {
        _244 = _189.x;
    }
    else
    {
        _244 = 0.0;
    }
    _189.x = _244;
    _50.x = (_50.x * _165.x) + _189.x;
    _264.x = _9.x < (-_9.x);
    _165.x = _264.x ? (-3.1415927410125732421875) : 0.0;
    _50.x = _165.x + _50.x;
    _165.x = min(_9.x, _113);
    _9.x = max(_9.x, _113);
    _293 = _165.x < (-_165.x);
    _300 = _9.x >= (-_9.x);
    _300 = _300 && _293;
    float _311;
    if (_300)
    {
        _311 = -_50.x;
    }
    else
    {
        _311 = _50.x;
    }
    _9.x = _311;
    _113 = _9.x * 3.0;
    _327.x = sin(_113);
    _331 = (_9.x * 2.0) + 1.69645965099334716796875;
    _327.y = sin(_331);
    mediump vec2 _345 = _327.xy * _327.xy;
    _327 = vec3(_345.x, _345.y, _327.z);
    _331 = _327.y * _327.y;
    _331 *= _331;
    _331 *= 3.0;
    _300 = _327.x != 0.0;
    _293 = _FakeSpecularCornerPower != 0.0;
    _300 = _293 && _300;
    if (_300)
    {
        _9.x = dot(-_9.yz, -_9.yz);
        _9.x = inversesqrt(_9.x);
        vec2 _389 = _9.xx * (-_9.yz);
        _9 = vec4(_389.x, _9.y, _9.z, _389.y);
        _50.x = min(abs(_9.x), abs(_9.w));
        _165.x = max(abs(_9.x), abs(_9.w));
        _165.x = 1.0 / _165.x;
        _50.x = _165.x * _50.x;
        _165.x = _50.x * _50.x;
        _189.x = (_165.x * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
        _189.x = (_165.x * _189.x) + 0.1801410019397735595703125;
        _189.x = (_165.x * _189.x) + (-0.33029949665069580078125);
        _165.x = (_165.x * _189.x) + 0.999866008758544921875;
        _189.x = _165.x * _50.x;
        _229 = abs(_9.x) < abs(_9.w);
        _189.x = (_189.x * (-2.0)) + 1.57079637050628662109375;
        float _470;
        if (_229)
        {
            _470 = _189.x;
        }
        else
        {
            _470 = 0.0;
        }
        _189.x = _470;
        _50.x = (_50.x * _165.x) + _189.x;
        _264.x = _9.x < (-_9.x);
        _165.x = _264.x ? (-3.1415927410125732421875) : 0.0;
        _50.x = _165.x + _50.x;
        _165.x = min(_9.x, _9.w);
        _189.x = max(_9.x, _9.w);
        _264.x = _165.x < (-_165.x);
        _523 = _189.x >= (-_189.x);
        _264.x = _523 && _264.x;
        float _537;
        if (_264.x)
        {
            _537 = -_50.x;
        }
        else
        {
            _537 = _50.x;
        }
        _50.x = _537;
        _264 = greaterThanEqual(_50.xxxx, vec4(0.0, 1.57079601287841796875, -3.1415920257568359375, -3.1415920257568359375)).xyz;
        _556 = lessThan(_50.xxxx, vec4(1.57079601287841796875, 3.1415920257568359375, -1.57079601287841796875, 0.0)).xyz;
        _564.x = _264.x && _556.x;
        _564.y = _264.y && _556.y;
        _564.z = _264.z && _556.z;
        bvec2 _591 = bvec2(_564.z);
        _189 = vec2(_591.x ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).x : vec2(0.314999997615814208984375, -0.439999997615814208984375).x, _591.y ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).y : vec2(0.314999997615814208984375, -0.439999997615814208984375).y);
        vec2 _596;
        if (_564.y)
        {
            _596 = vec2(-0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _596 = _189;
        }
        _165 = _596;
        vec2 _606;
        if (_564.x)
        {
            _606 = vec2(0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _606 = _165;
        }
        _50 = vec4(_606.x, _606.y, _50.z, _50.w);
        _189.x = dot(_50.xy, _50.xy);
        _189.x = inversesqrt(_189.x);
        vec2 _629 = _189.xx * _50.xy;
        _50 = vec4(_629.x, _629.y, _50.z, _50.w);
        _9.x = dot(_9.xw, _50.xy);
        _9.x += (-0.582111895084381103515625);
        _9.x = clamp(_9.x, 0.0, 1.0);
        _9.x *= 2.3929851055145263671875;
        _9.x = log2(_9.x);
        _9.x *= _FakeSpecularCornerPower;
        _9.x = exp2(_9.x);
        _666 = (-_FakeSpecularNotCornerOffset) + 1.0;
        _9.x = (_9.x * _666) + _FakeSpecularNotCornerOffset;
        _113 = _9.x * _FakeSpecularIntensity;
        _50.x = (_9.x * 2.094394683837890625) + 1.69645965099334716796875;
        _50.x = sin(_50.x);
        _50.x *= _50.x;
        _50.x *= _50.x;
        _50.x *= _50.x;
        _50.x *= 3.0;
        _718 = _113;
        _720 = _50.x;
    }
    else
    {
        _718 = _FakeSpecularIntensity;
        _720 = 0.0;
    }
    _331 = max(_720, _331);
    _331 += _FakeSpecularMaskScale;
    _666 = _327.x * _718;
    _327.z = _666 * 0.5;
    _327.x = (_327.x * 0.25) + _FakeSpecularPower;
    _327.x += (-0.25);
    _755.x = dot(-_9.yz, -_9.yz);
    _755.x = inversesqrt(_755.x);
    _755 = (-_9.yz) * _755.xx;
    _774 = min(abs(_755.y), abs(_755.x));
    _782 = max(abs(_755.y), abs(_755.x));
    _782 = 1.0 / _782;
    _774 = _782 * _774;
    _782 = _774 * _774;
    _798.x = (_782 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _798.x = (_782 * _798.x) + 0.1801410019397735595703125;
    _798.x = (_782 * _798.x) + (-0.33029949665069580078125);
    _782 = (_782 * _798.x) + 0.999866008758544921875;
    _798.x = _782 * _774;
    _824 = abs(_755.y) < abs(_755.x);
    _798.x = (_798.x * (-2.0)) + 1.57079637050628662109375;
    float _838;
    if (_824)
    {
        _838 = _798.x;
    }
    else
    {
        _838 = 0.0;
    }
    _798.x = _838;
    _774 = (_774 * _782) + _798.x;
    _852 = _755.y < (-_755.y);
    _782 = _852 ? (-3.1415927410125732421875) : 0.0;
    _774 = _782 + _774;
    _782 = min(_755.y, _755.x);
    _755.x = max(_755.y, _755.x);
    _875 = _782 < (-_782);
    _556.x = _755.x >= (-_755.x);
    _556.x = _556.x && _875;
    float _894;
    if (_556.x)
    {
        _894 = -_774;
    }
    else
    {
        _894 = _774;
    }
    _755.x = _894;
    _903 = sin(_755.x);
    _907 = cos(_755.x);
    _911.x = -_903;
    _755 = _916 + vec2(-0.5);
    _911.y = _907;
    _798.x = dot(_911.yx, _755);
    _911.z = _903;
    _798.y = dot(_911.zy, _755);
    _755 = _798 / vec2(_331);
    vec2 _943 = _755 + vec2(0.5);
    vs_TEXCOORD3 = vec4(_943.x, _943.y, vs_TEXCOORD3.z, vs_TEXCOORD3.w);
    gl_Position = _44;
    vs_TEXCOORD3 = vec4(vs_TEXCOORD3.x, vs_TEXCOORD3.y, _327.zx.x, _327.zx.y);
    vs_TEXCOORD0 = _916;
}
