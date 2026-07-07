precision highp float;
precision highp int;

in vec3 position;
in vec3 normal;
in vec2 uv;
in vec4 tangent;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
uniform vec3 cameraPosition;
uniform float uDepthOffset;
out vec2 vs_TEXCOORD0;
out vec3 vs_TEXCOORD1;

void main()
{
    vs_TEXCOORD0 = uv;
    vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vec3 n = normalize(normal);
    vec3 t = normalize(tangent.xyz);
    vec3 b = normalize(cross(n, t) * tangent.w);
    vec3 viewObj = normalize(camObj);
    vs_TEXCOORD1 = vec3(dot(t, viewObj), dot(b, viewObj), dot(n, viewObj));
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    mvPosition.z -= uDepthOffset;
    gl_Position = projectionMatrix * mvPosition;
}
