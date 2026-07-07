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
uniform float _FakeCameraHeight;
uniform float _Height;
uniform float _HeightPower;
uniform float _Scale;
out vec2 vs_TEXCOORD0;

void main()
{
    vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    camObj.y += _FakeCameraHeight;
    vec3 viewObj = normalize(camObj - position);
    vec3 n = normalize(normal);
    vec3 t = normalize(tangent.xyz);
    vec3 b = normalize(cross(n, t) * tangent.w);
    vec3 tv = normalize(vec3(dot(t, viewObj), dot(b, viewObj), dot(n, viewObj)));
    vec2 off = (tv.xy / (tv.z + 0.41999998688697815)) * (_HeightPower * (_Height - 0.5));
    vs_TEXCOORD0 = (((uv * 2.0) - 1.0) / _Scale) * 0.5 + off + 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
