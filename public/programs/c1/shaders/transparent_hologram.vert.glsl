precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;

in vec3 position;
out vec3 vs_TEXCOORD1;
out vec4 vs_TEXCOORD0;
in vec2 uv;
in vec3 normal;
out vec3 vs_TEXCOORD2;
in vec4 tangent;
out vec3 vs_TEXCOORD3;
out vec3 vs_TEXCOORD4;
vec4 _9;
vec4 _44;
float _137;
vec3 _204;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main()
{
    highp vec3 pcrUnityInput_position = vec3(-position.x, position.yz);
    highp vec3 pcrUnityInput_normal = vec3(-normal.x, normal.yz);
    highp vec4 pcrUnityInput_tangent = vec4(-tangent.x, tangent.yz, -tangent.w);
    highp vec2 pcrUnityInput_uv = vec2(uv.x, 1.0 - uv.y);
    highp mat4 pcrUnityInput_modelMatrix = pcrUnityFromThreeWorld * modelMatrix * pcrUnityFromGlbObject;
    highp mat4 pcrUnityInput_viewMatrix = viewMatrix * pcrUnityFromThreeWorld;
    vec4 _11 = vec4(pcrUnityInput_position, 1.0);
    vec2 _99 = pcrUnityInput_uv;
    vec3 _115 = pcrUnityInput_normal;
    vec4 _155 = pcrUnityInput_tangent;
    mat4 _ObjectToWorld = pcrUnityInput_modelMatrix;
    mat4 _WorldToObject = inverse(pcrUnityInput_modelMatrix);
    mat4 _ViewProjection = projectionMatrix * pcrUnityInput_viewMatrix;
    _9 = _11.yyyy * _ObjectToWorld[1];
    _9 = (_ObjectToWorld[0] * _11.xxxx) + _9;
    _9 = (_ObjectToWorld[2] * _11.zzzz) + _9;
    _44 = _9 + _ObjectToWorld[3];
    vs_TEXCOORD1 = (_ObjectToWorld[3].xyz * _11.www) + _9.xyz;
    _9 = _44.yyyy * _ViewProjection[1];
    _9 = (_ViewProjection[0] * _44.xxxx) + _9;
    _9 = (_ViewProjection[2] * _44.zzzz) + _9;
    _9 = (_ViewProjection[3] * _44.wwww) + _9;
    gl_Position = _9;
    vs_TEXCOORD0 = vec4(_99.x, _99.y, vs_TEXCOORD0.z, vs_TEXCOORD0.w);
    vec2 _111 = (_11.xy * vec2(1.26984119415283203125, 0.90909087657928466796875)) + vec2(0.5);
    vs_TEXCOORD0 = vec4(vs_TEXCOORD0.x, vs_TEXCOORD0.y, _111.x, _111.y);
    _9.x = dot(_115, _WorldToObject[0].xyz);
    _9.y = dot(_115, _WorldToObject[1].xyz);
    _9.z = dot(_115, _WorldToObject[2].xyz);
    _137 = dot(_9.xyz, _9.xyz);
    _137 = inversesqrt(_137);
    vec3 _149 = vec3(_137) * _9.xyz;
    _9 = vec4(_149.x, _149.y, _149.z, _9.w);
    vs_TEXCOORD2 = _9.xyz;
    vec3 _161 = _155.yyy * _ObjectToWorld[1].xyz;
    _44 = vec4(_161.x, _161.y, _161.z, _44.w);
    vec3 _172 = (_ObjectToWorld[0].xyz * _155.xxx) + _44.xyz;
    _44 = vec4(_172.x, _172.y, _172.z, _44.w);
    vec3 _183 = (_ObjectToWorld[2].xyz * _155.zzz) + _44.xyz;
    _44 = vec4(_183.x, _183.y, _183.z, _44.w);
    _137 = dot(_44.xyz, _44.xyz);
    _137 = inversesqrt(_137);
    vec3 _197 = vec3(_137) * _44.xyz;
    _44 = vec4(_197.x, _197.y, _197.z, _44.w);
    vs_TEXCOORD3 = _44.xyz;
    _204 = _9.zxy * _44.yzx;
    vec3 _217 = (_9.yzx * _44.zxy) + (-_204);
    _9 = vec4(_217.x, _217.y, _217.z, _9.w);
    vec3 _224 = _9.xyz * _155.www;
    _9 = vec4(_224.x, _224.y, _224.z, _9.w);
    _137 = dot(_9.xyz, _9.xyz);
    _137 = inversesqrt(_137);
    vs_TEXCOORD4 = vec3(_137) * _9.xyz;

}
