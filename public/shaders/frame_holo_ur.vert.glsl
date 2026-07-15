precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform mediump float _RampMaskRotation;
uniform mediump float _RampMaskScale;
uniform int _UseSimpleRampMaskAndRotation;
uniform mediump float _FakeSpecularMaskScale;
uniform mediump float _FakeSpecularIntensity;
uniform mediump float _FakeSpecularPower;
uniform mediump float _FakeSpecularCornerPower;
uniform mediump float _FakeSpecularNotCornerOffset;

in vec3 position;
in vec2 uv;
out vec4 vs_TEXCOORD4;
out vec3 vs_TEXCOORD2;
in vec3 normal;
out vec3 vs_TEXCOORD3;
out float vs_TEXCOORD5;
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
mediump vec3 _263;
mediump float _268;
bool _447;
bvec3 _477;
vec2 _504;
mediump float _564;
mediump float _599;
mediump float _602;
float _663;
vec3 _683;
bool _710;
bool _740;
mediump vec2 _794;
mediump float _799;
mediump vec3 _803;

void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _809 = uv;
    vec3 _853 = normal;
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
    _263.x = sin(_50.x);
    _268 = (_78 * 2.0) + 1.69645965099334716796875;
    _263.y = sin(_268);
    mediump vec2 _282 = _263.xy * _263.xy;
    _263 = vec3(_282.x, _282.y, _263.z);
    _268 = _263.y * _263.y;
    _268 *= _268;
    _268 *= 3.0;
    _241 = _263.x != 0.0;
    _234 = _FakeSpecularCornerPower != 0.0;
    _241 = _241 && _234;
    if (_241)
    {
        _78 = dot(-_50.yz, -_50.yz);
        _78 = inversesqrt(_78);
        vec2 _323 = vec2(_78) * (-_50.yz);
        _50 = vec4(_323.x, _50.y, _50.z, _323.y);
        _78 = min(abs(_50.x), abs(_50.w));
        _116.x = max(abs(_50.x), abs(_50.w));
        _116.x = 1.0 / _116.x;
        _78 *= _116.x;
        _116.x = _78 * _78;
        _136.x = (_116.x * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
        _136.x = (_116.x * _136.x) + 0.1801410019397735595703125;
        _136.x = (_116.x * _136.x) + (-0.33029949665069580078125);
        _116.x = (_116.x * _136.x) + 0.999866008758544921875;
        _136.x = _78 * _116.x;
        _175 = abs(_50.x) < abs(_50.w);
        _136.x = (_136.x * (-2.0)) + 1.57079637050628662109375;
        float _398;
        if (_175)
        {
            _398 = _136.x;
        }
        else
        {
            _398 = 0.0;
        }
        _136.x = _398;
        _78 = (_78 * _116.x) + _136.x;
        _208.x = _50.x < (-_50.x);
        _116.x = _208.x ? (-3.1415927410125732421875) : 0.0;
        _78 += _116.x;
        _116.x = min(_50.x, _50.w);
        _136.x = max(_50.x, _50.w);
        _208.x = _116.x < (-_116.x);
        _447 = _136.x >= (-_136.x);
        _208.x = _447 && _208.x;
        float _461;
        if (_208.x)
        {
            _461 = -_78;
        }
        else
        {
            _461 = _78;
        }
        _78 = _461;
        _208 = greaterThanEqual(vec4(_78), vec4(0.0, 1.57079601287841796875, -3.1415920257568359375, 0.0)).xyz;
        _477 = lessThan(vec4(_78), vec4(1.57079601287841796875, 3.1415920257568359375, -1.57079601287841796875, 0.0)).xyz;
        _208.x = _208.x && _477.x;
        _208.y = _208.y && _477.y;
        _208.z = _208.z && _477.z;
        bvec2 _513 = bvec2(_208.z);
        _504 = vec2(_513.x ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).x : vec2(0.314999997615814208984375, -0.439999997615814208984375).x, _513.y ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).y : vec2(0.314999997615814208984375, -0.439999997615814208984375).y);
        vec2 _518;
        if (_208.y)
        {
            _518 = vec2(-0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _518 = _504;
        }
        _136 = _518;
        vec2 _528;
        if (_208.x)
        {
            _528 = vec2(0.314999997615814208984375, 0.439999997615814208984375);
        }
        else
        {
            _528 = _136;
        }
        _116 = _528;
        _78 = dot(_116, _116);
        _78 = inversesqrt(_78);
        _116 = vec2(_78) * _116;
        _78 = dot(_50.xw, _116);
        _78 += (-0.582111895084381103515625);
        _78 = clamp(_78, 0.0, 1.0);
        _78 *= 2.3929851055145263671875;
        _78 = log2(_78);
        _78 *= _FakeSpecularCornerPower;
        _78 = exp2(_78);
        _564 = (-_FakeSpecularNotCornerOffset) + 1.0;
        _78 = (_78 * _564) + _FakeSpecularNotCornerOffset;
        _50.x = _78 * _FakeSpecularIntensity;
        _78 = (_78 * 2.094394683837890625) + 1.69645965099334716796875;
        _78 = sin(_78);
        _78 *= _78;
        _78 *= _78;
        _78 *= _78;
        _78 *= 3.0;
        _599 = _50.x;
        _602 = _78;
    }
    else
    {
        _599 = _FakeSpecularIntensity;
        _602 = 0.0;
    }
    _268 = max(_602, _268);
    _268 += _FakeSpecularMaskScale;
    _564 = _263.x * _599;
    _263.z = _564 * 0.5;
    _263.x = (_263.x * 0.25) + _FakeSpecularPower;
    _263.x += (-0.25);
    _116.x = dot(-_50.yz, -_50.yz);
    _116.x = inversesqrt(_116.x);
    _116 = (-_50.yz) * _116.xx;
    _504.x = min(abs(_116.y), abs(_116.x));
    _663 = max(abs(_116.y), abs(_116.x));
    _663 = 1.0 / _663;
    _504.x = _663 * _504.x;
    _663 = _504.x * _504.x;
    _683.x = (_663 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _683.x = (_663 * _683.x) + 0.1801410019397735595703125;
    _683.x = (_663 * _683.x) + (-0.33029949665069580078125);
    _663 = (_663 * _683.x) + 0.999866008758544921875;
    _683.x = _663 * _504.x;
    _710 = abs(_116.y) < abs(_116.x);
    _683.x = (_683.x * (-2.0)) + 1.57079637050628662109375;
    float _724;
    if (_710)
    {
        _724 = _683.x;
    }
    else
    {
        _724 = 0.0;
    }
    _683.x = _724;
    _504.x = (_504.x * _663) + _683.x;
    _740 = _116.y < (-_116.y);
    _663 = _740 ? (-3.1415927410125732421875) : 0.0;
    _504.x = _663 + _504.x;
    _663 = min(_116.y, _116.x);
    _116.x = max(_116.y, _116.x);
    _447 = _663 < (-_663);
    _208.x = _116.x >= (-_116.x);
    _208.x = _208.x && _447;
    float _783;
    if (_208.x)
    {
        _783 = -_504.x;
    }
    else
    {
        _783 = _504.x;
    }
    _116.x = _783;
    _794.x = sin(_116.x);
    _799 = cos(_116.x);
    _803.x = -_794.x;
    _116 = _809 + vec2(-0.5);
    _803.y = _799;
    _683.x = dot(_803.yx, _116);
    _803.z = _794.x;
    _683.y = dot(_803.zy, _116);
    _504 = _683.xy / vec2(_268);
    vec2 _838 = _504 + vec2(0.5);
    vs_TEXCOORD4 = vec4(_838.x, _838.y, vs_TEXCOORD4.z, vs_TEXCOORD4.w);
    vs_TEXCOORD2 = (_ObjectToWorld[3].xyz * _11.www) + _9.xyz;
    _683.x = dot(_853, _WorldToObject[0].xyz);
    _683.y = dot(_853, _WorldToObject[1].xyz);
    _683.z = dot(_853, _WorldToObject[2].xyz);
    _504.x = dot(_683, _683);
    _504.x = inversesqrt(_504.x);
    vs_TEXCOORD3 = _504.xxx * _683;
    _794.x = cos(_RampMaskRotation);
    _794.y = sin(-_RampMaskRotation);
    _116 *= vec2(vec2(_RampMaskScale, _RampMaskScale));
    _116.x = dot(_794, _116);
    _116.x += 0.5;
    float _920;
    if (_UseSimpleRampMaskAndRotation != 0)
    {
        _920 = _116.x;
    }
    else
    {
        _920 = 0.0;
    }
    vs_TEXCOORD5 = _920;
    gl_Position = _44;
    vs_TEXCOORD4 = vec4(vs_TEXCOORD4.x, vs_TEXCOORD4.y, _263.zx.x, _263.zx.y);
    vs_TEXCOORD0 = _809;
}
