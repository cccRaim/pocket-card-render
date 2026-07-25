precision mediump float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp vec3 _DarknessColor;
uniform highp float _DarknessOffset;
uniform mediump sampler2D _242;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _267;
layout(location = 1) out highp vec4 _276;
highp vec3 _9;
vec3 _44;
vec3 _56;
float _70;
highp float _114;
bool _127;
bool _146;
bool _179;
vec4 _238;

highp vec3 pcrUnityObjectToWorldAxisZ(highp mat4 threeModelMatrix)
{
    return vec3(threeModelMatrix[2].x, threeModelMatrix[2].y, -threeModelMatrix[2].z);
}

void main()
{
    _9.x = dot(-pcrUnityObjectToWorldAxisZ(modelMatrix), -pcrUnityObjectToWorldAxisZ(modelMatrix));
    _9.x = inversesqrt(_9.x);
    _9 = _9.xxx * (-pcrUnityObjectToWorldAxisZ(modelMatrix));
    _44.x = dot(_9.xy, _9.xy);
    _44.x = sqrt(_44.x);
    _56.x = max(abs(_9.z), _44.x);
    _56.x = 1.0 / _56.x;
    _70 = min(abs(_9.z), _44.x);
    _56.x *= _70;
    _70 = _56.x * _56.x;
    _9.x = (_70 * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _9.x = (_70 * _9.x) + 0.1801410019397735595703125;
    _9.x = (_70 * _9.x) + (-0.33029949665069580078125);
    _9.x = (_70 * _9.x) + 0.999866008758544921875;
    _114 = _9.x * _56.x;
    _114 = (_114 * (-2.0)) + 1.57079637050628662109375;
    _127 = abs(_9.z) < _44.x;
    _114 = _127 ? _114 : 0.0;
    _9.x = (_56.x * _9.x) + _114;
    _146 = _9.z < (-_9.z);
    _114 = _146 ? (-3.1415927410125732421875) : 0.0;
    _9.x = _114 + _9.x;
    _56.x = min(_9.z, _44.x);
    _44.x = max(_9.z, _44.x);
    _146 = _44.x >= (-_44.x);
    _179 = _56.x < (-_56.x);
    _146 = _146 && _179;
    highp float _191;
    if (_146)
    {
        _191 = -_9.x;
    }
    else
    {
        _191 = _9.x;
    }
    _9.x = _191;
    _9.x *= 3.0;
    _44.x = sin(_9.x);
    _44.x *= _44.x;
    _56.x = -_DarknessOffset;
    _56.x = clamp(_56.x, 0.0, 1.0);
    _56.x = (-_56.x) + 1.0;
    _44.x *= _56.x;
    _238 = texture(_242, vs_TEXCOORD0);
    _56 = (_238.xyz * _DarknessColor) + (-_238.xyz);
    _44 = (_44.xxx * _56) + _238.xyz;
    _267.w = _238.w;
    _267 = vec4(_44.x, _44.y, _44.z, _267.w);
    _276 = vec4(0.0);
}
