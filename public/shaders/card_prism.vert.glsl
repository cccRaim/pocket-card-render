precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform float uTime;
uniform float _ExpandScale;
uniform float _ExpandTiming;
uniform float _ExpandAlphaPower;
uniform float _CenterMoveIntensity;
uniform float _RotateSpeed;
uniform float _ShiftTiming;
uniform int _UseRotate;
in vec2 uv1;
out vec4 vs_TEXCOORD1;
in vec3 position;
out vec2 vs_TEXCOORD0;
in vec2 uv;
vec4 _9;
mediump float _47;
mediump float _56;
mediump vec2 _67;
float _82;
vec4 _107;
bool _121;
bool _144;
bool _167;
float _179;
int _231;
int _237;
mediump float _315;
mediump float _319;
mediump vec3 _324;
vec3 _333;

void main()
{
    vec4 _302 = vec4(position, 1.0);
    vec2 _422 = uv;
    vec2 _248 = uv1;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9.x = dot(-_ObjectToWorld[2].xyz, -_ObjectToWorld[2].xyz);
    _9.x = inversesqrt(_9.x);
    vec3 _44 = _9.xxx * (-_ObjectToWorld[2].xyz);
    _9 = vec4(_44.x, _44.y, _44.z, _9.w);
    _47 = dot(_9.xy, _9.xy);
    _47 = sqrt(_47);
    _56 = max(abs(_9.z), _47);
    _56 = 1.0 / _56;
    _67.x = min(abs(_9.z), _47);
    _56 *= _67.x;
    _67.x = _56 * _56;
    _82 = (_67.x * 0.02083509974181652069091796875) + (-0.08513300120830535888671875);
    _82 = (_67.x * _82) + 0.1801410019397735595703125;
    _82 = (_67.x * _82) + (-0.33029949665069580078125);
    _82 = (_67.x * _82) + 0.999866008758544921875;
    _107.x = _82 * _56;
    _107.x = (_107.x * (-2.0)) + 1.57079637050628662109375;
    _121 = abs(_9.z) < _47;
    float _129;
    if (_121)
    {
        _129 = _107.x;
    }
    else
    {
        _129 = 0.0;
    }
    _107.x = _129;
    _82 = (_56 * _82) + _107.x;
    _144 = _9.z < (-_9.z);
    _107.x = _144 ? (-3.1415927410125732421875) : 0.0;
    _82 += _107.x;
    _56 = min(_9.z, _47);
    _47 = max(_9.z, _47);
    _167 = _47 >= (-_47);
    _144 = _56 < (-_56);
    _167 = _167 && _144;
    float _181;
    if (_167)
    {
        _181 = -_82;
    }
    else
    {
        _181 = _82;
    }
    _179 = _181;
    _47 = _179 * 3.0;
    _47 = sin(_47);
    _47 *= _47;
    _47 /= _ExpandTiming;
    _47 = min(_47, 1.0);
    _167 = 0.5 >= _47;
    _47 = inversesqrt(_47);
    _47 = 1.0 / _47;
    _47 += (-1.5);
    _47 *= 3.1415920257568359375;
    _47 = sin(_47);
    _47 = abs(_47) * abs(_47);
    int _228 = _UseRotate;
    mediump int mp_copy_228 = _228;
    _56 = float(mp_copy_228);
    _231 = int((0.5 < _56) ? 4294967295u : 0u);
    _237 = _167 ? 0 : _231;
    _56 = (_47 * _47) + (-1.0);
    vec2 _259 = _248 * vec2(vec2(_ExpandScale, _ExpandScale));
    _107 = vec4(_259.x, _259.y, _107.z, _107.w);
    _67 = (_9.xy * vec2(vec2(_CenterMoveIntensity, _CenterMoveIntensity))) + _107.xy;
    vs_TEXCOORD1 = vec4(vs_TEXCOORD1.x, vs_TEXCOORD1.y, _9.xy.x, _9.xy.y);
    vec2 _286 = _67 + (-_248);
    _9 = vec4(_286.x, _286.y, _9.z, _9.w);
    vec2 _296 = (_107.xy * vec2(_56)) + _9.xy;
    _9 = vec4(_296.x, _296.y, _9.z, _9.w);
    vec2 _305 = _9.xy + _302.xy;
    _107 = vec4(_305.x, _305.y, _107.z, _107.w);
    _9.x = (uTime * 0.05) * _RotateSpeed;
    _315 = sin(_9.x);
    _319 = cos(_9.x);
    _324.x = -_315;
    _324.y = _319;
    _324.z = _315;
    _333.y = dot(_324.zy, _107.xy);
    _333.x = dot(_324.yx, _107.xy);
    _333.z = _302.z;
    _107.z = _302.z;
    vec3 _356;
    if (_237 != 0)
    {
        _356 = _333;
    }
    else
    {
        _356 = _107.xyz;
    }
    _9 = vec4(_356.x, _356.y, _356.z, _9.w);
    _107 = _9.yyyy * _ObjectToWorld[1];
    _107 = (_ObjectToWorld[0] * _9.xxxx) + _107;
    _9 = (_ObjectToWorld[2] * _9.zzzz) + _107;
    _9 += _ObjectToWorld[3];
    _107 = _9.yyyy * _ViewProjection[1];
    _107 = (_ViewProjection[0] * _9.xxxx) + _107;
    _107 = (_ViewProjection[2] * _9.zzzz) + _107;
    gl_Position = (_ViewProjection[3] * _9.wwww) + _107;
    vs_TEXCOORD0 = _422;
    _56 = ((-_47) * _47) + 1.0;
    _47 *= _47;
    _47 = log2(_47);
    _47 *= _ShiftTiming;
    vs_TEXCOORD1.x = exp2(_47);
    _47 = log2(_56);
    _47 *= _ExpandAlphaPower;
    _47 = exp2(_47);
    _47 = (-_47) + 1.0;
    vs_TEXCOORD1.y = _47;
}
