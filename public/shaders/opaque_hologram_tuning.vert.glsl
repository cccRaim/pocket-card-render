precision highp float;
precision highp int;

in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
out vec2 vs_TEXCOORD0;
out vec3 vs_TEXCOORD1;
out vec3 vs_TEXCOORD2;

void main()
{
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vs_TEXCOORD0 = uv;
    vs_TEXCOORD1 = worldPosition.xyz;
    vs_TEXCOORD2 = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
