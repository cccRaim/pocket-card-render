precision highp float;
precision highp int;

uniform highp float uTime;
uniform highp mat4 modelMatrix;
uniform highp mat4 projectionMatrix;
uniform highp mat4 viewMatrix;
uniform mediump float _TexScale;
uniform int _TexPixelsX;
uniform int _TexPixelsY;
uniform highp float _ScaleX;
uniform highp float _ScaleY;
uniform int _IsBack;
uniform mediump vec4 _BaseColor;
uniform mediump float _BaseColorRGBIntensity;
uniform mediump float _TiltThreshold;
uniform mediump float _TiltPower;
uniform highp float _CornerPower;
uniform mediump float _NotCornerOffset;
uniform highp float _FlickerAnimSpeed;
uniform highp float _TiltFlickerAnimSpeed;
uniform highp float _FlickerTimeDelay;
uniform highp float _FlickResultIntensityLowestPoint;
uniform highp float _ShouldDoFlicker;

uniform mediump sampler2D _288;

out vec2 vs_TEXCOORD0;
layout(location = 1) in vec2 uv;
out mediump vec4 vs_TEXCOORD1;
layout(location = 0) in vec3 position;
mediump vec3 _9;
vec3 _31;
bool _59;
float _97;
vec4 _104;
vec2 _142;
float _168;
bool _199;
bool _223;
bool _257;
vec4 _278;
float _307;
vec2 _349;
bool _381;
bvec3 _412;
bool _447;
bvec3 _477;
vec2 _503;
mediump float _584;
vec3 _598;
bool _695;
bool _700;
mediump float _728;

highp vec3 pcrUnityObjectToWorldAxisZ(highp mat4 threeModelMatrix)
{
    return vec3(threeModelMatrix[2].x, threeModelMatrix[2].y, -threeModelMatrix[2].z);
}

void main()
{
    vec4 _915 = vec4(position, 1.0);
    vec2 _81 = uv;
    vec4 _Time = vec4(uTime * 0.05, uTime, uTime * 2.0, uTime * 3.0);
    _9 = _BaseColor.xyz * vec3(_BaseColorRGBIntensity);
    _31.x = dot(-pcrUnityObjectToWorldAxisZ(modelMatrix), -pcrUnityObjectToWorldAxisZ(modelMatrix));
    _31.x = inversesqrt(_31.x);
    _31 = _31.xxx * (-pcrUnityObjectToWorldAxisZ(modelMatrix));
    _59 = _31.z >= 0.0;
    if (_59)
    {
        gl_Position = vec4(0.0);
        vs_TEXCOORD0 = _81;
        vs_TEXCOORD1.w = _BaseColor.w;
        vs_TEXCOORD1 = vec4(_9.x, _9.y, _9.z, vs_TEXCOORD1.w);
        return;
    }
    _97 = dot(_31.xy, _31.xy);
    _104.x = inversesqrt(_97);
    vec2 _112 = _31.xy * _104.xx;
    _31 = vec3(_112.x, _112.y, _31.z);
    vec2 _121;
    if (_IsBack != 0)
    {
        _121 = _31.xy;
    }
    else
    {
        _121 = -_31.xy;
    }
    _31 = vec3(_121.x, _121.y, _31.z);
    _104.x = min(abs(_31.x), abs(_31.y));
    _142.x = max(abs(_31.x), abs(_31.y));
    _142.x = 1.0 / _142.x;
    _104.x = _142.x * _104.x;
    _142.x = _104.x * _104.x;
    _168 = (_142.x * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _168 = (_142.x * _168) + 0.1801410019397735595703125;
    _168 = (_142.x * _168) + (-0.33029949665069580078125);
    _142.x = (_142.x * _168) + 0.999866008758544921875;
    _168 = _142.x * _104.x;
    _199 = abs(_31.x) < abs(_31.y);
    _168 = (_168 * (-2.0)) + 1.57079637050628662109375;
    _168 = _199 ? _168 : 0.0;
    _104.x = (_104.x * _142.x) + _168;
    _223 = _31.x < (-_31.x);
    _142.x = _223 ? (-3.1415927410125732421875) : 0.0;
    _104.x = _142.x + _104.x;
    _142.x = min(_31.x, _31.y);
    _168 = max(_31.x, _31.y);
    _223 = _142.x < (-_142.x);
    _257 = _168 >= (-_168);
    _223 = _257 && _223;
    float _267;
    if (_223)
    {
        _267 = -_104.x;
    }
    else
    {
        _267 = _104.x;
    }
    _104.x = _267;
    _278.x = _104.x * 0.1591549813747406005859375;
    _278.y = 0.0;
    _142 = textureLod(_288, _278.xy, 0.0).xy;
    _142 += vec2(-0.5);
    _142 *= vec2(_ScaleX, _ScaleY);
    _307 = dot(_31.xy, _31.xy);
    _307 = inversesqrt(_307);
    vec2 _319 = _31.xy * vec2(_307);
    _31 = vec3(_319.x, _319.y, _31.z);
    _307 = min(abs(_31.x), abs(_31.y));
    _278.x = max(abs(_31.x), abs(_31.y));
    _278.x = 1.0 / _278.x;
    _307 *= _278.x;
    _278.x = _307 * _307;
    _349.x = (_278.x * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _349.x = (_278.x * _349.x) + 0.1801410019397735595703125;
    _349.x = (_278.x * _349.x) + (-0.33029949665069580078125);
    _278.x = (_278.x * _349.x) + 0.999866008758544921875;
    _349.x = _307 * _278.x;
    _381 = abs(_31.x) < abs(_31.y);
    _349.x = (_349.x * (-2.0)) + 1.57079637050628662109375;
    float _395;
    if (_381)
    {
        _395 = _349.x;
    }
    else
    {
        _395 = 0.0;
    }
    _349.x = _395;
    _307 = (_307 * _278.x) + _349.x;
    _412.x = _31.x < (-_31.x);
    _278.x = _412.x ? (-3.1415927410125732421875) : 0.0;
    _307 += _278.x;
    _278.x = min(_31.x, _31.y);
    _349.x = max(_31.x, _31.y);
    _412.x = _278.x < (-_278.x);
    _447 = _349.x >= (-_349.x);
    _412.x = _447 && _412.x;
    float _461;
    if (_412.x)
    {
        _461 = -_307;
    }
    else
    {
        _461 = _307;
    }
    _307 = _461;
    _412 = greaterThanEqual(vec4(_307), vec4(0.0, 1.57079601287841796875, -3.1415920257568359375, 0.0)).xyz;
    _477 = lessThan(vec4(_307), vec4(1.57079601287841796875, 3.1415920257568359375, -1.57079601287841796875, 0.0)).xyz;
    _412.x = _412.x && _477.x;
    _412.y = _412.y && _477.y;
    _412.z = _412.z && _477.z;
    bvec2 _512 = bvec2(_412.z);
    _503 = vec2(_512.x ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).x : vec2(0.314999997615814208984375, -0.439999997615814208984375).x, _512.y ? vec2(-0.314999997615814208984375, -0.439999997615814208984375).y : vec2(0.314999997615814208984375, -0.439999997615814208984375).y);
    vec2 _516;
    if (_412.y)
    {
        _516 = vec2(-0.314999997615814208984375, 0.439999997615814208984375);
    }
    else
    {
        _516 = _503;
    }
    _349 = _516;
    vec2 _526;
    if (_412.x)
    {
        _526 = vec2(0.314999997615814208984375, 0.439999997615814208984375);
    }
    else
    {
        _526 = _349;
    }
    _278 = vec4(_526.x, _526.y, _278.z, _278.w);
    _307 = dot(_278.xy, _278.xy);
    _307 = inversesqrt(_307);
    vec2 _546 = vec2(_307) * _278.xy;
    _278 = vec4(_546.x, _546.y, _278.z, _278.w);
    _31.x = dot(_31.xy, _278.xy);
    _31.x += (-0.582111895084381103515625);
    _31.x = clamp(_31.x, 0.0, 1.0);
    _31.x *= 2.3929851055145263671875;
    _31.x = log2(_31.x);
    _31.x *= _CornerPower;
    _31.x = exp2(_31.x);
    _584 = (-_NotCornerOffset) + 1.0;
    _31.x = (_31.x * _584) + _NotCornerOffset;
    _598.x = sqrt(_97);
    _97 = min(abs(_31.z), _598.x);
    _307 = max(abs(_31.z), _598.x);
    _307 = 1.0 / _307;
    _97 *= _307;
    _307 = _97 * _97;
    _278.x = (_307 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _278.x = (_307 * _278.x) + 0.1801410019397735595703125;
    _278.x = (_307 * _278.x) + (-0.33029949665069580078125);
    _307 = (_307 * _278.x) + 0.999866008758544921875;
    _278.x = _97 * _307;
    _447 = abs(_31.z) < _598.x;
    _278.x = (_278.x * (-2.0)) + 1.57079637050628662109375;
    float _659;
    if (_447)
    {
        _659 = _278.x;
    }
    else
    {
        _659 = 0.0;
    }
    _278.x = _659;
    _97 = (_97 * _307) + _278.x;
    _199 = _31.z < (-_31.z);
    _307 = _199 ? (-3.1415927410125732421875) : 0.0;
    _97 += _307;
    _307 = min(_31.z, _598.x);
    _598.x = max(_31.z, _598.x);
    _695 = _307 < (-_307);
    _700 = _598.x >= (-_598.x);
    _700 = _700 && _695;
    float _711;
    if (_700)
    {
        _711 = -_97;
    }
    else
    {
        _711 = _97;
    }
    _598.x = _711;
    _598.x *= 3.0;
    _584 = sin(_598.x);
    _728 = (-_TiltThreshold) + 1.0;
    _584 = (_584 * _584) + (-_TiltThreshold);
    _728 = 1.0 / _728;
    _584 *= _728;
    _584 = clamp(_584, 0.0, 1.0);
    _728 = (_584 * (-2.0)) + 3.0;
    _584 *= _584;
    _584 *= _728;
    _584 = log2(_584);
    _584 *= _TiltPower;
    _584 = exp2(_584);
    _31.x = _584 * _31.x;
    _278 = _142.yyyy * modelMatrix[1];
    _278 = (modelMatrix[0] * _142.xxxx) + _278;
    _278 += modelMatrix[3];
    _598 = _278.yyy * viewMatrix[1].xyz;
    _598 = (viewMatrix[0].xyz * _278.xxx) + _598;
    _598 = (viewMatrix[2].xyz * _278.zzz) + _598;
    _598 = (viewMatrix[3].xyz * _278.www) + _598;
    _223 = any(notEqual(vec4(0.0), vec4(_ShouldDoFlicker)));
    _104.x = (_104.x * _TiltFlickerAnimSpeed) + _Time.y;
    _104.x += _FlickerTimeDelay;
    _168 = _104.x * _FlickerAnimSpeed;
    _168 = sin(_168);
    _168 = max(_168, 0.0);
    _307 = (-_FlickResultIntensityLowestPoint) + 1.0;
    _168 = (_168 * _307) + _FlickResultIntensityLowestPoint;
    _104.x *= 0.64370000362396240234375;
    _104.x = sin(_104.x);
    _104.x = max(_104.x, 0.0);
    _104.x = (_104.x * _307) + _FlickResultIntensityLowestPoint;
    _104.x += _168;
    _104.x *= 0.5;
    _104.x = clamp(_104.x, 0.0, 1.0);
    _104.x = _31.x * _104.x;
    float _904;
    if (_223)
    {
        _904 = _104.x;
    }
    else
    {
        _904 = _31.x;
    }
    _31.x = _904;
    _104.x = _915.x * _TexScale;
    vec2 _932 = vec2(ivec2(_TexPixelsY, _TexPixelsX));
    _278 = vec4(_932.x, _932.y, _278.z, _278.w);
    _307 = _278.x * _915.y;
    _307 /= _278.y;
    _104.w = _307 * _TexScale;
    vec2 _953 = _31.xx * _104.xw;
    _104 = vec4(_953.x, _953.y, _104.z, _104.w);
    _104.z = 0.0;
    _598 += _104.xyz;
    _104 = _598.yyyy * projectionMatrix[1];
    _104 = (projectionMatrix[0] * _598.xxxx) + _104;
    _104 = (projectionMatrix[2] * _598.zzzz) + _104;
    gl_Position = _104 + projectionMatrix[3];
    _31 = _9 * _31.xxx;
    vs_TEXCOORD0 = _81;
    vs_TEXCOORD1 = vec4(_31.x, _31.y, _31.z, vs_TEXCOORD1.w);
    vs_TEXCOORD1.w = _BaseColor.w;
}
