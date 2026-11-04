precision mediump float;
precision highp int;
uniform int _IconRTypeAdditiveLayer;
uniform int _IconLTypeAdditiveLayer;
uniform float _AlphaBlend;
uniform highp float _TextureSwitch;
uniform int _FrontType;
uniform mediump sampler2D _13;
uniform mediump sampler2D _29;
uniform mediump sampler2D _139;
uniform mediump sampler2D _148;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _287;
layout(location = 1) out highp vec4 _296;
vec4 _9;
vec3 _22;
vec4 _28;
vec4 _54;
highp vec4 _57;
highp vec4 _73;
highp vec4 _92;
float _109;
vec4 _168;
highp vec4 _183;
highp vec4 _247;
highp vec4 _268;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main() {


    _9 = texture(_13, pcrStoredUv( vs_TEXCOORD0));
    _22 = _9.www * _9.xyz;
    _28 = texture(_29, pcrStoredUv( vs_TEXCOORD0));
    switch (_IconRTypeAdditiveLayer)
    {
        case 0:
        {
            vec3 _51 = (_28.xyz * _28.www) + _22;
            _28 = vec4(_51.x, _51.y, _51.z, _28.w);
            _54 = _28;
            break;
        }
        case 1:
        {
            vec3 _64 = (_28.xyz * _28.www) + _22;
            _57 = vec4(_64.x, _64.y, _64.z, _57.w);
            _57.w = _9.w;
            highp vec3 _82 = (_9.xyz * _9.www) + (-_57.xyz);
            _73 = vec4(_82.x, _82.y, _82.z, _73.w);
            _73.w = _9.w + (-_57.w);
            _92 = (_9.wwww * _73) + _57;
            _54 = _92;
            break;
        }
        default:
        {
            _22 = (_28.xyz * _28.www) + (-_22);
            _109 = (-_9.w) + _28.w;
            _22 *= _28.www;
            vec3 _126 = (_9.xyz * _9.www) + _22;
            _54 = vec4(_126.x, _126.y, _126.z, _54.w);
            _54.w = (_28.w * _109) + _9.w;
            break;
        }
    }
    _9 = texture(_139, pcrStoredUv( vs_TEXCOORD0));
    _22 = _9.www * _9.xyz;
    _28 = texture(_148, pcrStoredUv( vs_TEXCOORD0));
    switch (_IconLTypeAdditiveLayer)
    {
        case 0:
        {
            vec3 _165 = (_28.xyz * _28.www) + _22;
            _28 = vec4(_165.x, _165.y, _165.z, _28.w);
            _168 = _28;
            break;
        }
        case 1:
        {
            vec3 _177 = (_28.xyz * _28.www) + _22;
            _73 = vec4(_177.x, _177.y, _177.z, _73.w);
            _73.w = _9.w;
            highp vec3 _192 = (_9.xyz * _9.www) + (-_73.xyz);
            _183 = vec4(_192.x, _192.y, _192.z, _183.w);
            _183.w = _9.w + (-_73.w);
            _57 = (_9.wwww * _183) + _73;
            _168 = _57;
            break;
        }
        default:
        {
            _22 = (_28.xyz * _28.www) + (-_22);
            _109 = (-_9.w) + _28.w;
            _22 *= _28.www;
            vec3 _234 = (_9.xyz * _9.www) + _22;
            _168 = vec4(_234.x, _234.y, _234.z, _168.w);
            _168.w = (_28.w * _109) + _9.w;
            break;
        }
    }
    _247.x = float(_FrontType);
    _247.x += _TextureSwitch;
    _247.x = clamp(_247.x, 0.0, 1.0);
    _268 = (-_54) + _168;
    _247 = (_247.xxxx * _268) + _54;
    _54.x = _247.w * _AlphaBlend;
    _287 = vec4(_247.xyz.x, _247.xyz.y, _247.xyz.z, _287.w);
    _287.w = _54.x;
    _296 = vec4(vec3(0.0).x, vec3(0.0).y, vec3(0.0).z, _296.w);
    _296.w = _247.w;
}
