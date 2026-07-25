precision mediump float;
precision highp int;

uniform highp float _HomographyMatrix[9];

uniform mediump sampler2D _DynamicUITex;

in highp vec2 vHomographyUv;
layout(location = 0) out highp vec4 outColor;
layout(location = 1) out highp vec4 outAux;
highp float _8;
highp float _42;
highp vec2 _63;
vec4 sampled;
float inverseAlpha;

void main()
{
    _8 = vHomographyUv.y * _HomographyMatrix[1];
    _8 = (_HomographyMatrix[0] * vHomographyUv.x) + _8;
    _8 += _HomographyMatrix[2];
    _42 = vHomographyUv.y * _HomographyMatrix[7];
    _42 = (_HomographyMatrix[6] * vHomographyUv.x) + _42;
    _42 += _HomographyMatrix[8];
    _63.x = _8 / _42;
    _8 = vHomographyUv.y * _HomographyMatrix[4];
    _8 = (_HomographyMatrix[3] * vHomographyUv.x) + _8;
    _8 += _HomographyMatrix[5];
    _63.y = _8 / _42;
    sampled = texture(_DynamicUITex, _63);
    inverseAlpha = (-sampled.w) + 1.0;
    outColor = vec4(sampled.xyz.x, sampled.xyz.y, sampled.xyz.z, outColor.w);
    outColor.w = inverseAlpha;
    outAux = vec4(0.0);
}
