precision mediump float;
precision highp int;

uniform highp float _AlphaThreshold;

uniform mediump sampler2D _12;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out vec4 _46;
highp float _8;
bool _25;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main()
{

    _8 = texture(_12, pcrStoredUv( vs_TEXCOORD0)).x;
    _25 = _8 < _AlphaThreshold;
    if ((int(_25) * (-1)) != 0)
    {
        discard;
    }
    _46 = vec4(_8);
}
