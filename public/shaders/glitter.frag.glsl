precision mediump float;
precision highp int;

uniform highp vec4 _FlowParams[2];
uniform highp float _FadeDuration;
uniform highp float _FlowAPower;
uniform highp float _FlowBPower;
uniform vec4 _LightColor;
uniform highp float _LightTime;
uniform highp float _EmitThreshold;
uniform mediump sampler2D _13;
uniform mediump sampler2D _205;
uniform mediump sampler2D _404;
uniform mediump sampler2D _644;
uniform mediump sampler2D _690;
uniform mediump sampler2D _843;

in highp vec4 vs_TEXCOORD0;
in highp vec4 vs_TEXCOORD1;
layout(location = 0) out highp vec4 _1090;
layout(location = 1) out highp vec4 _1092;
vec4 _9;
highp vec4 _24;
highp vec2 _55;
highp vec4 _62;
highp vec2 _76;
highp vec4 _95;
highp vec2 _104;
highp vec4 _133;
vec4 _204;
bool _214;
bool _237;
vec4 _247;
vec4 _254;
highp float _284;
highp vec4 _287;
bool _303;
float _317;
bool _333;
highp float _337;
vec2 _435;
highp float _461;
bool _465;
bool _616;
bool _695;
highp float _710;
bool _714;
vec4 _722;
vec2 _872;
highp float _898;

void main()
{
    vec2 _21 = texture(_13, vs_TEXCOORD0.zw).xy;
    _9 = vec4(_21.x, _21.y, _9.z, _9.w);
    vec2 _29 = _9.xy + vec2(-0.5);
    _24 = vec4(_29.x, _29.y, _24.z, _24.w);
    highp vec2 _51 = _24.xy * vec2(vec2(_FlowAPower, _FlowAPower));
    _24 = vec4(_51.x, _51.y, _24.z, _24.w);
    _55 = fract(_FlowParams[0].xy);
    highp vec2 _68 = _FlowParams[0].xy + vec2(0.5);
    _62 = vec4(_68.x, _68.y, _62.z, _62.w);
    highp vec2 _73 = fract(_62.xy);
    _62 = vec4(_73.x, _73.y, _62.z, _62.w);
    _76 = (_24.xy * _55.xx) + vs_TEXCOORD0.xy;
    highp vec2 _92 = (_24.xy * _62.xx) + vs_TEXCOORD0.xy;
    _24 = vec4(_92.x, _92.y, _24.z, _24.w);
    _95.x = (-_FadeDuration) + 0.5;
    _104 = (-_55) + vec2(0.5);
    _55.x = (-_95.x) + 0.5;
    _104 = (-_95.xx) + abs(_104);
    _55.x = 1.0 / _55.x;
    _104 = _55.xx * _104;
    _104 = clamp(_104, vec2(0.0), vec2(1.0));
    highp vec2 _140 = (_104 * vec2(-2.0)) + vec2(3.0);
    _133 = vec4(_140.x, _140.y, _133.z, _133.w);
    _104 *= _104;
    _104 = ((-_133.xy) * _104) + vec2(1.0);
    highp vec2 _156 = (-_62.xy) + vec2(0.5);
    _133 = vec4(_156.x, _156.y, _133.z, _133.w);
    highp vec2 _165 = (-_95.xx) + abs(_133.xy);
    _95 = vec4(_165.x, _95.y, _95.z, _165.y);
    highp vec2 _172 = _55.xx * _95.xw;
    _95 = vec4(_172.x, _95.y, _95.z, _172.y);
    highp vec2 _179 = clamp(_95.xw, vec2(0.0), vec2(1.0));
    _95 = vec4(_179.x, _95.y, _95.z, _179.y);
    highp vec2 _185 = (_95.xw * vec2(-2.0)) + vec2(3.0);
    _133 = vec4(_185.x, _185.y, _133.z, _133.w);
    highp vec2 _192 = _95.xw * _95.xw;
    _95 = vec4(_192.x, _95.y, _95.z, _192.y);
    highp vec2 _201 = ((-_133.xy) * _95.xw) + vec2(1.0);
    _95 = vec4(_201.x, _95.y, _95.z, _201.y);
    vec2 _209 = texture(_205, _76).xy;
    _204 = vec4(_209.x, _209.y, _204.z, _204.w);
    _214 = _204.x != 0.0;
    if (_214)
    {
        _55.x = fract(_204.x);
        _62.x = _55.x + (-_FlowParams[0].z);
        _133.x = _LightTime * 0.5;
        _237 = abs(_62.x) < _133.x;
        if (_237)
        {
            _247 = _204.yyyy * _LightColor;
            _254.x = (-_204.y) + 1.0;
            _62.x = abs(_62.x) / _133.x;
            _62.x = (-_62.x) + 1.0;
            _62.x *= _62.x;
            _237 = _62.x >= _254.x;
            _284 = float(_237);
            _287 = vec4(_284) * _247;
            _247 = _287;
        }
        else
        {
            _284 = _FlowParams[0].z + (-1.0);
            _284 = _55.x + (-_284);
            _303 = abs(_284) < _133.x;
            if (_303)
            {
                _254 = _204.yyyy * _LightColor;
                _317 = (-_204.y) + 1.0;
                _284 = abs(_284) / _133.x;
                _284 = (-_284) + 1.0;
                _284 *= _284;
                _333 = _284 >= _317;
                _337 = float(_333);
                _287 = _254 * vec4(_337);
                _247 = _287;
            }
            else
            {
                _337 = _FlowParams[0].z + 1.0;
                _55.x += (-_337);
                _333 = abs(_55.x) < _133.x;
                if (_333)
                {
                    _254 = _204.yyyy * _LightColor;
                    _317 = (-_204.y) + 1.0;
                    _55.x = abs(_55.x) / _133.x;
                    _55.x = (-_55.x) + 1.0;
                    _55.x *= _55.x;
                    _214 = _55.x >= _317;
                    _55.x = float(_214);
                    _287 = _55.xxxx * _254;
                    _247 = _287;
                }
                else
                {
                    _254 = texture(_404, _76);
                    _254 = _204.yyyy * _254;
                    _317 = (-_204.y) + 1.0;
                    _214 = _EmitThreshold >= _317;
                    _55.x = float(_214);
                    _287 = _55.xxxx * _254;
                    _247 = _287;
                }
            }
        }
    }
    else
    {
        _247.x = 0.0;
        _247.y = 0.0;
        _247.z = 0.0;
        _247.w = 0.0;
    }
    _435 = texture(_205, _24.xy).xy;
    _214 = _435.x != 0.0;
    if (_214)
    {
        _55.x = _435.x + 0.5;
        _55.x = fract(_55.x);
        _337 = _55.x + (-_FlowParams[0].z);
        _461 = _LightTime * 0.5;
        _465 = abs(_337) < _461;
        if (_465)
        {
            _204 = _435.yyyy * _LightColor;
            _317 = (-_435.y) + 1.0;
            _337 = abs(_337) / _461;
            _337 = (-_337) + 1.0;
            _337 *= _337;
            _333 = _337 >= _317;
            _337 = float(_333);
            _133 = _204 * vec4(_337);
            _204 = _133;
        }
        else
        {
            _337 = _FlowParams[0].z + (-1.0);
            _337 = _55.x + (-_337);
            _465 = abs(_337) < _461;
            if (_465)
            {
                _254 = _435.yyyy * _LightColor;
                _317 = (-_435.y) + 1.0;
                _337 = abs(_337) / _461;
                _337 = (-_337) + 1.0;
                _337 *= _337;
                _333 = _337 >= _317;
                _337 = float(_333);
                _133 = _254 * vec4(_337);
                _204 = _133;
            }
            else
            {
                _337 = _FlowParams[0].z + 1.0;
                _55.x += (-_337);
                _333 = abs(_55.x) < _461;
                if (_333)
                {
                    _254 = _435.yyyy * _LightColor;
                    _317 = (-_435.y) + 1.0;
                    _55.x = abs(_55.x) / _461;
                    _55.x = (-_55.x) + 1.0;
                    _55.x *= _55.x;
                    _214 = _55.x >= _317;
                    _55.x = float(_214);
                    _133 = _55.xxxx * _254;
                    _204 = _133;
                }
                else
                {
                    _254 = texture(_404, _24.xy);
                    _254 = _435.yyyy * _254;
                    _317 = (-_435.y) + 1.0;
                    _616 = _EmitThreshold >= _317;
                    _24.x = float(_616);
                    _133 = _24.xxxx * _254;
                    _204 = _133;
                }
            }
        }
    }
    else
    {
        _204.x = 0.0;
        _204.y = 0.0;
        _204.z = 0.0;
        _204.w = 0.0;
    }
    _133 = _95.xxxx * _204;
    _133 = (_247 * _104.xxxx) + _133;
    vec2 _650 = texture(_644, vs_TEXCOORD1.zw).xy;
    _9 = vec4(_650.x, _650.y, _9.z, _9.w);
    vec2 _655 = _9.xy + vec2(-0.5);
    _24 = vec4(_655.x, _655.y, _24.z, _24.w);
    highp vec2 _669 = _24.xy * vec2(vec2(_FlowBPower, _FlowBPower));
    _24 = vec4(_669.x, _669.y, _24.z, _24.w);
    _55 = (_24.xy * _55.yy) + vs_TEXCOORD1.xy;
    highp vec2 _687 = (_24.xy * _62.yy) + vs_TEXCOORD1.xy;
    _24 = vec4(_687.x, _687.y, _24.z, _24.w);
    _435 = texture(_690, _55).xy;
    _695 = _435.x != 0.0;
    if (_695)
    {
        _337 = fract(_435.x);
        _461 = _337 + (-_FlowParams[0].z);
        _710 = _LightTime * 0.5;
        _714 = abs(_461) < _710;
        if (_714)
        {
            _722 = _435.yyyy * _LightColor;
            _247.x = (-_435.y) + 1.0;
            _461 = abs(_461) / _710;
            _461 = (-_461) + 1.0;
            _461 *= _461;
            _695 = _461 >= _247.x;
            _461 = float(_695);
            _62 = _722 * vec4(_461);
            _722 = _62;
        }
        else
        {
            _461 = _FlowParams[0].z + (-1.0);
            _461 = (-_461) + _337;
            _714 = abs(_461) < _710;
            if (_714)
            {
                _247 = _435.yyyy * _LightColor;
                _317 = (-_435.y) + 1.0;
                _461 = abs(_461) / _710;
                _461 = (-_461) + 1.0;
                _461 *= _461;
                _695 = _461 >= _317;
                _461 = float(_695);
                _62 = _247 * vec4(_461);
                _722 = _62;
            }
            else
            {
                _461 = _FlowParams[0].z + 1.0;
                _337 = (-_461) + _337;
                _695 = abs(_337) < _710;
                if (_695)
                {
                    _247 = _435.yyyy * _LightColor;
                    _317 = (-_435.y) + 1.0;
                    _337 = abs(_337) / _710;
                    _337 = (-_337) + 1.0;
                    _337 *= _337;
                    _333 = _337 >= _317;
                    _337 = float(_333);
                    _62 = _247 * vec4(_337);
                    _722 = _62;
                }
                else
                {
                    _247 = texture(_843, _55);
                    _247 = _435.yyyy * _247;
                    _317 = (-_435.y) + 1.0;
                    _214 = _EmitThreshold >= _317;
                    _55.x = float(_214);
                    _62 = _55.xxxx * _247;
                    _722 = _62;
                }
            }
        }
    }
    else
    {
        _722.x = 0.0;
        _722.y = 0.0;
        _722.z = 0.0;
        _722.w = 0.0;
    }
    _872 = texture(_690, _24.xy).xy;
    _333 = _872.x != 0.0;
    if (_333)
    {
        _55.x = _872.x + 0.5;
        _55.x = fract(_55.x);
        _337 = _55.x + (-_FlowParams[0].z);
        _898 = _LightTime * 0.5;
        _695 = abs(_337) < _898;
        if (_695)
        {
            _247 = _872.yyyy * _LightColor;
            _317 = (-_872.y) + 1.0;
            _337 = abs(_337) / _898;
            _337 = (-_337) + 1.0;
            _337 *= _337;
            _333 = _337 >= _317;
            _337 = float(_333);
            _287 = _247 * vec4(_337);
            _247 = _287;
        }
        else
        {
            _337 = _FlowParams[0].z + (-1.0);
            _337 = _55.x + (-_337);
            _695 = abs(_337) < _898;
            if (_695)
            {
                _254 = _872.yyyy * _LightColor;
                _317 = (-_872.y) + 1.0;
                _337 = abs(_337) / _898;
                _337 = (-_337) + 1.0;
                _337 *= _337;
                _333 = _337 >= _317;
                _337 = float(_333);
                _287 = _254 * vec4(_337);
                _247 = _287;
            }
            else
            {
                _337 = _FlowParams[0].z + 1.0;
                _55.x += (-_337);
                _333 = abs(_55.x) < _898;
                if (_333)
                {
                    _254 = _872.yyyy * _LightColor;
                    _317 = (-_872.y) + 1.0;
                    _55.x = abs(_55.x) / _898;
                    _55.x = (-_55.x) + 1.0;
                    _55.x *= _55.x;
                    _214 = _55.x >= _317;
                    _55.x = float(_214);
                    _287 = _55.xxxx * _254;
                    _247 = _287;
                }
                else
                {
                    _254 = texture(_843, _24.xy);
                    _254 = _872.yyyy * _254;
                    _317 = (-_872.y) + 1.0;
                    _616 = _EmitThreshold >= _317;
                    _24.x = float(_616);
                    _287 = _24.xxxx * _254;
                    _247 = _287;
                }
            }
        }
    }
    else
    {
        _247.x = 0.0;
        _247.y = 0.0;
        _247.z = 0.0;
        _247.w = 0.0;
    }
    _24 = _95.wwww * _247;
    _24 = (_722 * _104.yyyy) + _24;
    _317 = (-_24.w) + 1.0;
    _9 = (_133 * vec4(_317)) + _24;
    _1090 = _9;
    _1092 = vec4(0.0);
}
