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

void main()
{
    vec4 viewPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
    viewPosition.z -= _DepthOffset;
    gl_Position = projectionMatrix * viewPosition;
    vs_TEXCOORD0 = (uv * _MainTex_ST.xy) + _MainTex_ST.zw;
    vec3 normalizedNormal = normalize(normal);
    vec3 normalizedTangent = normalize(tangent.xyz);
    vec3 bitangent = cross(normalizedNormal, normalizedTangent) * tangent.w;
    vec3 cameraObject = normalize((inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz);
    vs_TEXCOORD1 = vec3(
        dot(tangent.xyz, cameraObject),
        -dot(bitangent, cameraObject),
        dot(normal, cameraObject)
    );
}
