precision mediump float;
precision highp int;

uniform mediump sampler2D _DownSampling1Tex;
uniform mediump sampler2D _DownSampling2Tex;
uniform mediump sampler2D _DownSampling3Tex;
uniform mediump sampler2D _DownSampling4Tex;
uniform mediump sampler2D _DownSampling5Tex;
uniform mediump sampler2D _DownSampling6Tex;
uniform mediump sampler2D _DownSampling7Tex;

in highp vec3 vUv;
layout(location = 0) out vec4 outColor;
highp float _8;
int _21;
bool _26;
vec3 _34;
vec3 _46;
bool _119;
vec3 _126;

void main()
{
    _8 = vUv.z + 0.5;
    _21 = int(_8);
    _26 = _21 == 1;
    if (_26)
    {
        _34 = texture(_DownSampling1Tex, vUv.xy).xyz;
        _46 = _34;
    }
    else
    {
        _26 = _21 == 2;
        if (_26)
        {
            _34 = texture(_DownSampling2Tex, vUv.xy).xyz;
            _46 = _34;
        }
        else
        {
            _26 = _21 == 3;
            if (_26)
            {
                _34 = texture(_DownSampling3Tex, vUv.xy).xyz;
                _46 = _34;
            }
            else
            {
                _26 = _21 == 4;
                if (_26)
                {
                    _34 = texture(_DownSampling4Tex, vUv.xy).xyz;
                    _46 = _34;
                }
                else
                {
                    _26 = _21 == 5;
                    if (_26)
                    {
                        _34 = texture(_DownSampling5Tex, vUv.xy).xyz;
                        _46 = _34;
                    }
                    else
                    {
                        _26 = _21 == 6;
                        if (_26)
                        {
                            _34 = texture(_DownSampling6Tex, vUv.xy).xyz;
                            _46 = _34;
                        }
                        else
                        {
                            _119 = _21 == 7;
                            if (_119)
                            {
                                _126 = texture(_DownSampling7Tex, vUv.xy).xyz;
                                _46 = _126;
                            }
                            else
                            {
                                _46.x = 0.0;
                                _46.y = 0.0;
                                _46.z = 0.0;
                            }
                        }
                    }
                }
            }
        }
    }
    outColor = vec4(_46.x, _46.y, _46.z, outColor.w);
    outColor.w = 1.0;
}
