precision mediump float;
precision highp int;

uniform float _ColorIntensity;
uniform float _AdjustAlphaIntensity;
uniform int _ColoringMethod;
uniform float _ShiftU;
uniform float _ShiftV;
uniform int _ShiftUOffsetByTilt;
uniform float _ShiftUOffsetIntensity;
uniform int _ShiftVOffsetByTilt;
uniform float _ShiftVOffsetIntensity;
uniform int _OkLabBlend;
uniform float _EmissiveIntensity;

uniform mediump sampler2D _29;

in highp vec2 vs_TEXCOORD0;
in highp vec4 vs_TEXCOORD1;
layout(location = 0) out highp vec4 _349;
layout(location = 1) out highp vec4 _361;
bool _8;
vec4 _25;
vec4 _36;
highp vec2 _40;
highp float _55;
highp vec2 _96;
vec4 _101;
highp vec4 _112;
highp vec3 _132;
highp vec3 _172;
vec3 _186;
highp vec3 _247;
bvec3 _266;
highp vec3 _275;

void main()
{
    _8 = _ColoringMethod == 1;
    if (_8)
    {
        _25 = texture(_29, vs_TEXCOORD0);
        _36 = _25;
    }
    else
    {
        _40 = vs_TEXCOORD1.xx * vec2(_ShiftU, _ShiftV);
        _55 = float(_ShiftUOffsetByTilt);
        _55 *= vs_TEXCOORD1.z;
        _40.x = (_55 * _ShiftUOffsetIntensity) + _40.x;
        _55 = float(_ShiftVOffsetByTilt);
        _55 *= vs_TEXCOORD1.w;
        _40.y = (_55 * _ShiftVOffsetIntensity) + _40.y;
        _96 = (-_40) + vs_TEXCOORD0;
        _101.x = texture(_29, _96).x;
        _101.y = texture(_29, vs_TEXCOORD0).y;
        highp vec2 _115 = _40 + vs_TEXCOORD0;
        _112 = vec4(_115.x, _115.y, _112.z, _112.w);
        _101.z = texture(_29, _112.xy).z;
        _40.x = _101.y + _101.x;
        _132.x = _40.x + 0.001000000047497451305389404296875;
        _132.x = _101.y / _132.x;
        _132 = (_132.xxx * vec3(0.24023759365081787109375, -0.458823502063751220703125, 0.05362083017826080322265625)) + vec3(0.63154184818267822265625, 0.22490324079990386962890625, 0.1258028447628021240234375);
        _40.x = _101.z + _40.x;
        _112.x = _40.x + 0.001000000047497451305389404296875;
        _112.x = _101.z / _112.x;
        _172 = (-_132) + vec3(0.45901286602020263671875, -0.032378457486629486083984375, -0.3116199970245361328125);
        _132 = (_112.xxx * _172) + _132;
        _186 = _132 * vec3(_ColorIntensity);
        _112.x = dot(_186, vec3(1.0, 0.3963377773761749267578125, 0.21580375730991363525390625));
        _112.y = dot(_186, vec3(1.0, -0.1055613458156585693359375, -0.06385417282581329345703125));
        _112.z = dot(_186, vec3(1.0, -0.089484177529811859130859375, -1.2914855480194091796875));
        _132 = _112.xyz * _112.xyz;
        _132 = _112.xyz * _132;
        _112.x = dot(_132, vec3(4.076741695404052734375, -3.30771160125732421875, 0.2309699356555938720703125));
        _112.y = dot(_132, vec3(-1.26843798160552978515625, 2.60975742340087890625, -0.341319382190704345703125));
        _112.z = dot(_132, vec3(-0.0041960864327847957611083984375, -0.70341861248016357421875, 1.7076146602630615234375));
        _132 = _112.xyz * vec3(12.9200000762939453125);
        _247 = log2(_112.xyz);
        _247 *= vec3(0.4166666567325592041015625);
        _247 = exp2(_247);
        _247 = (_247 * vec3(1.05499994754791259765625)) + vec3(-0.054999999701976776123046875);
        _266 = greaterThanEqual(_112.xyzx, vec4(0.003130800090730190277099609375, 0.003130800090730190277099609375, 0.003130800090730190277099609375, 0.0)).xyz;
        _275.x = float(_266.x);
        _275.y = float(_266.y);
        _275.z = float(_266.z);
        highp vec3 _293 = ((-_112.xyz) * vec3(12.9200000762939453125)) + _247;
        _112 = vec4(_293.x, _293.y, _293.z, _112.w);
        highp vec3 _301 = (_275 * _112.xyz) + _132;
        _112 = vec4(_301.x, _301.y, _301.z, _112.w);
        _40.x *= 0.333000004291534423828125;
        _112.w = _40.x * _AdjustAlphaIntensity;
        _101.w = _112.w;
        bvec4 _324 = bvec4(_OkLabBlend != 0);
        _36 = vec4(_324.x ? _112.x : _101.x, _324.y ? _112.y : _101.y, _324.z ? _112.z : _101.z, _324.w ? _112.w : _101.w);
    }
    _40.x = _36.w * vs_TEXCOORD1.y;
    highp vec3 _336 = _40.xxx * _36.xyz;
    _36 = vec4(_336.x, _336.y, _336.z, _36.w);
    vec3 _345 = _36.xyz * vec3(_EmissiveIntensity);
    _101 = vec4(_345.x, _345.y, _345.z, _101.w);
    _349 = vec4(_36.xyz.x, _36.xyz.y, _36.xyz.z, _349.w);
    _349.w = _40.x;
    _101.w = _EmissiveIntensity;
    _361 = _101;
}
