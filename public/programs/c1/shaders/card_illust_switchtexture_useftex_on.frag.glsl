precision mediump float;
precision highp int;
uniform int _IconRTypeAdditiveLayer;
uniform int _IconLTypeAdditiveLayer;
uniform int _FTypeAdditiveLayer;
uniform float _AlphaBlend;
uniform highp float _TextureSwitch;
uniform mediump sampler2D _13;
uniform mediump sampler2D _30;
uniform mediump sampler2D _151;
uniform mediump sampler2D _160;
uniform mediump sampler2D _259;
uniform mediump sampler2D _268;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _416;
layout(location = 1) out highp vec4 _425;
vec4 _9;
vec4 _20;
vec4 _29;
vec4 _56;
highp vec4 _59;
highp vec4 _76;
highp vec4 _95;
vec3 _116;
vec3 _125;
highp vec4 _212;
float _229;
vec4 _288;
highp vec4 _303;
highp vec4 _367;
highp vec4 _380;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main() {


    _9 = texture(_13, pcrStoredUv( vs_TEXCOORD0));
    vec3 _26 = _9.www * _9.xyz;
    _20 = vec4(_26.x, _26.y, _26.z, _20.w);
    _29 = texture(_30, pcrStoredUv( vs_TEXCOORD0));
    switch (_IconRTypeAdditiveLayer)
    {
        case 0:
        {
            vec3 _53 = (_29.xyz * _29.www) + _20.xyz;
            _29 = vec4(_53.x, _53.y, _53.z, _29.w);
            _56 = _29;
            break;
        }
        case 1:
        {
            vec3 _67 = (_29.xyz * _29.www) + _20.xyz;
            _59 = vec4(_67.x, _67.y, _67.z, _59.w);
            _59.w = _9.w;
            highp vec3 _85 = (_9.xyz * _9.www) + (-_59.xyz);
            _76 = vec4(_85.x, _85.y, _85.z, _76.w);
            _76.w = _9.w + (-_59.w);
            _95 = (_9.wwww * _76) + _59;
            _56 = _95;
            break;
        }
        default:
        {
            vec3 _112 = (_29.xyz * _29.www) + (-_20.xyz);
            _20 = vec4(_112.x, _112.y, _112.z, _20.w);
            _116.x = (-_9.w) + _29.w;
            _125 = _20.xyz * _29.www;
            vec3 _137 = (_9.xyz * _9.www) + _125;
            _56 = vec4(_137.x, _137.y, _137.z, _56.w);
            _56.w = (_29.w * _116.x) + _9.w;
            break;
        }
    }
    _9 = texture(_151, pcrStoredUv( vs_TEXCOORD0));
    _116 = _9.www * _9.xyz;
    _20 = texture(_160, pcrStoredUv( vs_TEXCOORD0));
    switch (_IconLTypeAdditiveLayer)
    {
        case 0:
        {
            vec3 _177 = (_20.xyz * _20.www) + _116;
            _20 = vec4(_177.x, _177.y, _177.z, _20.w);
            _29 = _20;
            break;
        }
        case 1:
        {
            vec3 _188 = (_20.xyz * _20.www) + _116;
            _59 = vec4(_188.x, _188.y, _188.z, _59.w);
            _59.w = _9.w;
            highp vec3 _202 = (_9.xyz * _9.www) + (-_59.xyz);
            _76 = vec4(_202.x, _202.y, _202.z, _76.w);
            _76.w = _9.w + (-_59.w);
            _212 = (_9.wwww * _76) + _59;
            _29 = _212;
            break;
        }
        default:
        {
            _116 = (_20.xyz * _20.www) + (-_116);
            _229 = (-_9.w) + _20.w;
            _116 = _20.www * _116;
            vec3 _246 = (_9.xyz * _9.www) + _116;
            _29 = vec4(_246.x, _246.y, _246.z, _29.w);
            _29.w = (_20.w * _229) + _9.w;
            break;
        }
    }
    _9 = texture(_259, pcrStoredUv( vs_TEXCOORD0));
    _116 = _9.www * _9.xyz;
    _20 = texture(_268, pcrStoredUv( vs_TEXCOORD0));
    switch (_FTypeAdditiveLayer)
    {
        case 0:
        {
            vec3 _285 = (_20.xyz * _20.www) + _116;
            _20 = vec4(_285.x, _285.y, _285.z, _20.w);
            _288 = _20;
            break;
        }
        case 1:
        {
            vec3 _297 = (_20.xyz * _20.www) + _116;
            _76 = vec4(_297.x, _297.y, _297.z, _76.w);
            _76.w = _9.w;
            highp vec3 _312 = (_9.xyz * _9.www) + (-_76.xyz);
            _303 = vec4(_312.x, _312.y, _312.z, _303.w);
            _303.w = _9.w + (-_76.w);
            _59 = (_9.wwww * _303) + _76;
            _288 = _59;
            break;
        }
        default:
        {
            _116 = (_20.xyz * _20.www) + (-_116);
            _229 = (-_9.w) + _20.w;
            _116 = _20.www * _116;
            vec3 _354 = (_9.xyz * _9.www) + _116;
            _288 = vec4(_354.x, _354.y, _354.z, _288.w);
            _288.w = (_20.w * _229) + _9.w;
            break;
        }
    }
    _367.x = _TextureSwitch + 1.0;
    _367.x = clamp(_367.x, 0.0, 1.0);
    _380 = (-_56) + _288;
    _367 = (_367.xxxx * _380) + _56;
    _76.x = _TextureSwitch;
    _76.x = clamp(_76.x, 0.0, 1.0);
    _380 = (-_367) + _29;
    _367 = (_76.xxxx * _380) + _367;
    _56.x = _367.w * _AlphaBlend;
    _416 = vec4(_367.xyz.x, _367.xyz.y, _367.xyz.z, _416.w);
    _416.w = _56.x;
    _425 = vec4(vec3(0.0).x, vec3(0.0).y, vec3(0.0).z, _425.w);
    _425.w = _367.w;
}
