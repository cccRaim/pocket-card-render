precision highp float;
precision highp int;

in vec3 position;
in vec3 normal;
in vec4 tangent;
in vec2 uv;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform float _DepthOffset;
uniform highp vec4 _MainTex_ST;
out mediump vec2 vs_TEXCOORD0;
out mediump vec3 vs_TEXCOORD1;

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
    highp vec3 pcrUnityInput_cameraPosition = vec3(cameraPosition.xy, -cameraPosition.z);
    vec4 viewPosition = pcrUnityInput_viewMatrix * pcrUnityInput_modelMatrix * vec4(pcrUnityInput_position, 1.0);
    viewPosition.z -= _DepthOffset;
    gl_Position = projectionMatrix * viewPosition;
    vs_TEXCOORD0 = (pcrUnityInput_uv * _MainTex_ST.xy) + _MainTex_ST.zw;
    vec3 normalizedNormal = normalize(pcrUnityInput_normal);
    vec3 normalizedTangent = normalize(pcrUnityInput_tangent.xyz);
    vec3 bitangent = cross(normalizedNormal, normalizedTangent) * pcrUnityInput_tangent.w;
    vec3 cameraObject = normalize((inverse(pcrUnityInput_modelMatrix) * vec4(pcrUnityInput_cameraPosition, 1.0)).xyz);
    vs_TEXCOORD1 = vec3(
        dot(pcrUnityInput_tangent.xyz, cameraObject),
        dot(bitangent, cameraObject),
        dot(pcrUnityInput_normal, cameraObject)
    );
}
